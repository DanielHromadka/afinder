// The Docker area: talks to the Docker Engine API over its local socket (named pipe on Windows), with plain
// HTTP and no client library. Compose has no engine API, so its commands run the docker CLI with an
// argument array. Logs, stats, pulls and engine events stream to the window that asked until it stops
// them or goes away. Imported lazily, only once the area is shown.

import { execFile, spawn } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import {
  COMPOSE_ACTIONS,
  CONTAINER_ACTIONS,
  isContainerRef,
  isImageRef,
  isProjectName,
  LogDecoder,
  mapContainer,
  mapPorts,
  parseDockerHost,
  PRUNE_KINDS,
  socketCandidates,
  splitImageRef,
  statsPoint,
  cpuPercent,
  memUsage,
  type ComposeAction,
  type ContainerAction,
  type DockerContainer,
  type DockerDiskUsage,
  type DockerEndpoint,
  type DockerImage,
  type DockerInspect,
  type DockerLogLine,
  type DockerNetwork,
  type DockerPruneKind,
  type DockerStatus,
  type DockerStreamEvent,
  type DockerUsage,
  type DockerVolume,
  type RawContainer,
  type RawStats
} from '@shared/docker'
import { t } from '@shared/i18n'
import { IPC } from '@shared/types'
import { validatePath } from './fileSystem'
import { isVirtual } from './vfs'

const isWindows = process.platform === 'win32'
/** Compose file names compose itself looks for, in its order. */
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
/** Lines kept per log flush; a container spewing faster is shown in batches, not line by line. */
const LOG_FLUSH_MS = 120

// ---- the engine connection ---------------------------------------------------------------------

let endpoint: Promise<DockerEndpoint | null> | null = null

const describe = (e: DockerEndpoint): string => ('socketPath' in e ? e.socketPath : `${e.host}:${e.port}`)

/** DOCKER_HOST (AFINDER_DOCKER_HOST for the smoke test) when set, else the first usual socket that answers. */
function resolve(fresh = false): Promise<DockerEndpoint | null> {
  if (!endpoint || fresh) {
    endpoint = (async () => {
      const configured = process.env.AFINDER_DOCKER_HOST ?? process.env.DOCKER_HOST
      if (configured) {
        const e = parseDockerHost(configured)
        return e && (await ping(e)) ? e : null
      }
      for (const socketPath of socketCandidates(process.platform, os.homedir(), typeof process.getuid === 'function' ? process.getuid() : null)) {
        if (!isWindows && !(await access(socketPath).then(() => true, () => false))) continue
        if (await ping({ socketPath })) return { socketPath }
      }
      return null
    })()
  }
  return endpoint
}

function ping(e: DockerEndpoint): Promise<boolean> {
  return raw(e, 'GET', '/_ping', undefined, 1500).then((r) => r.status === 200, () => false)
}

interface RawResponse {
  status: number
  body: Buffer
}

function raw(e: DockerEndpoint, method: string, p: string, body?: unknown, timeout = 30_000): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = http.request(
      { ...e, method, path: p, timeout, headers: { Host: 'docker', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error(t('docker.timeout'))))
    req.on('error', reject)
    req.end(payload)
  })
}

/** A request to the engine; its error message (`{"message": …}`) becomes the thrown error. */
async function api<T>(method: string, p: string, body?: unknown, timeout?: number): Promise<T> {
  let e = await resolve()
  if (!e) e = await resolve(true)
  if (!e) throw new Error(t('docker.notRunning'))
  let res: RawResponse
  try {
    res = await raw(e, method, p, body, timeout)
  } catch (err) {
    endpoint = null // the engine may have stopped or moved; look again next time
    throw err
  }
  const text = res.body.toString('utf8')
  if (res.status >= 400) {
    let message = text
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text
    } catch {
      // Not JSON: keep the text.
    }
    throw new Error(message.trim() || `HTTP ${res.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

const q = (params: Record<string, string | number | boolean | object>): string =>
  '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`).join('&')

function ref(id: unknown): string {
  if (!isContainerRef(id)) throw new Error(t('docker.invalid'))
  return encodeURIComponent(id)
}

function imageRef(id: unknown): string {
  if (!isImageRef(id)) throw new Error(t('docker.invalid'))
  return encodeURIComponent(id)
}

// ---- status and the desktop app ----------------------------------------------------------------

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false)

/** The desktop app that runs the engine here, when one is installed. */
async function desktopApp(): Promise<string | null> {
  if (process.platform === 'darwin') {
    for (const name of ['Docker', 'OrbStack']) {
      for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
        const app = path.join(dir, `${name}.app`)
        if (await exists(app)) return app
      }
    }
    return null
  }
  if (isWindows) {
    const exe = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe')
    return (await exists(exe)) ? exe : null
  }
  return null
}

let cli: Promise<string | null> | null = null

/** The docker CLI (for compose): apps started from the Dock have no shell PATH, so the usual places first. */
function dockerCli(): Promise<string | null> {
  cli ??= (async () => {
    const home = os.homedir()
    const candidates = isWindows
      ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe')]
      : ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker', `${home}/.orbstack/bin/docker`, `${home}/.rd/bin/docker`, '/usr/bin/docker']
    for (const c of candidates) if (await exists(c)) return c
    return new Promise((done) => execFile('docker', ['--version'], { timeout: 5000 }, (err) => done(err ? null : 'docker')))
  })()
  return cli
}

export async function status(): Promise<DockerStatus> {
  const e = await resolve(true)
  const desktop = await desktopApp()
  if (!e) return { state: desktop || (await dockerCli()) ? 'stopped' : 'missing', host: null, desktop: desktop && path.basename(desktop).replace(/\.(app|exe)$/, '') }
  const [version, info] = await Promise.all([
    api<{ Version?: string; Os?: string }>('GET', '/version'),
    api<{ Name?: string; OperatingSystem?: string; NCPU?: number; MemTotal?: number; Containers?: number; ContainersRunning?: number; Images?: number }>('GET', '/info')
  ])
  return {
    state: 'running',
    host: describe(e),
    version: version.Version,
    os: info.OperatingSystem ?? version.Os,
    name: info.Name,
    cpus: info.NCPU,
    memory: info.MemTotal,
    running: info.ContainersRunning,
    containers: info.Containers,
    images: info.Images,
    desktop: null
  }
}

/** Starts Docker Desktop (or OrbStack) when the engine is down. */
export async function startDesktop(): Promise<void> {
  const app = await desktopApp()
  if (!app) throw new Error(t('docker.noDesktop'))
  if (process.platform === 'darwin') {
    await new Promise<void>((done, fail) => execFile('/usr/bin/open', ['-a', app], (err) => (err ? fail(err) : done())))
    return
  }
  spawn(app, [], { detached: true, stdio: 'ignore' }).unref()
}

// ---- containers --------------------------------------------------------------------------------

export async function containers(): Promise<DockerContainer[]> {
  return (await api<RawContainer[]>('GET', `/containers/json${q({ all: true })}`)).map(mapContainer)
}

/** Last CPU counters per container: one-shot readings carry no previous sample of their own. */
const lastCpu = new Map<string, { total: number; system: number }>()

/** CPU and memory of the running containers, for the list. */
export async function usage(): Promise<DockerUsage[]> {
  const running = (await api<RawContainer[]>('GET', '/containers/json')).map((c) => c.Id)
  const out = await Promise.all(
    running.map(async (id) => {
      try {
        const s = await api<RawStats>('GET', `/containers/${ref(id)}/stats${q({ stream: false, 'one-shot': true })}`, undefined, 10_000)
        const cpu = cpuPercent(s, lastCpu.get(id))
        lastCpu.set(id, { total: s.cpu_stats?.cpu_usage?.total_usage ?? 0, system: s.cpu_stats?.system_cpu_usage ?? 0 })
        return { id, cpu, mem: memUsage(s), memLimit: s.memory_stats?.limit ?? 0 }
      } catch {
        return null // stopped in the meantime
      }
    })
  )
  for (const id of lastCpu.keys()) if (!running.includes(id)) lastCpu.delete(id)
  return out.filter((u): u is DockerUsage => u !== null)
}

export async function action(id: unknown, act: unknown): Promise<void> {
  if (!CONTAINER_ACTIONS.includes(act as ContainerAction)) throw new Error(t('docker.invalid'))
  if (act === 'remove') await api('DELETE', `/containers/${ref(id)}${q({ force: true })}`)
  else await api('POST', `/containers/${ref(id)}/${act}`, undefined, 120_000)
}

interface RawInspect {
  Id: string
  Name?: string
  Path?: string
  Args?: string[]
  Created?: string
  State?: { StartedAt?: string; FinishedAt?: string; ExitCode?: number; Running?: boolean; Health?: { Status?: string } }
  Config?: { Image?: string; Env?: string[] | null; Labels?: Record<string, string> | null; Tty?: boolean }
  HostConfig?: { RestartPolicy?: { Name?: string; MaximumRetryCount?: number } }
  Mounts?: { Type?: string; Source?: string; Destination?: string; RW?: boolean; Name?: string }[]
  NetworkSettings?: {
    Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> | null
    Networks?: Record<string, { IPAddress?: string; Gateway?: string; MacAddress?: string }>
  }
}

const realTime = (s: string | undefined): string | null => (s && !s.startsWith('0001-') ? s : null)

export async function inspect(id: unknown): Promise<DockerInspect> {
  const c = await api<RawInspect>('GET', `/containers/${ref(id)}/json`)
  const ports = Object.entries(c.NetworkSettings?.Ports ?? {}).flatMap(([key, binds]) => {
    const [port, type] = key.split('/')
    return (binds ?? [{}]).map((b) => ({ PrivatePort: Number(port), PublicPort: b.HostPort ? Number(b.HostPort) : undefined, IP: b.HostIp, Type: type }))
  })
  const policy = c.HostConfig?.RestartPolicy
  return {
    id: c.Id,
    name: (c.Name ?? '').replace(/^\//, ''),
    image: c.Config?.Image ?? '',
    command: [c.Path, ...(c.Args ?? [])].filter(Boolean).join(' '),
    created: c.Created ?? '',
    started: realTime(c.State?.StartedAt),
    finished: c.State?.Running ? null : realTime(c.State?.FinishedAt),
    exitCode: c.State?.Running ? null : (c.State?.ExitCode ?? null),
    health: c.State?.Health?.Status ?? null,
    restartPolicy: policy?.Name ? (policy.MaximumRetryCount ? `${policy.Name}:${policy.MaximumRetryCount}` : policy.Name) : 'no',
    tty: c.Config?.Tty === true,
    env: c.Config?.Env ?? [],
    mounts: (c.Mounts ?? []).map((m) => ({ type: m.Type ?? '', source: m.Source ?? '', destination: m.Destination ?? '', rw: m.RW !== false, name: m.Name ?? null })),
    networks: Object.entries(c.NetworkSettings?.Networks ?? {}).map(([name, n]) => ({ name, ip: n.IPAddress ?? '', gateway: n.Gateway ?? '', mac: n.MacAddress ?? '' })),
    ports: mapPorts(ports),
    labels: c.Config?.Labels ?? {}
  }
}

/** The console command that opens a shell in the container (bash when it has one); the id is validated. */
export function shellCommand(id: unknown): string {
  if (!isContainerRef(id)) throw new Error(t('docker.invalid'))
  return `docker exec -it ${id} sh -c 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'`
}

// ---- images, volumes, networks, disk -----------------------------------------------------------

interface RawImage {
  Id: string
  RepoTags?: string[] | null
  RepoDigests?: string[] | null
  Size?: number
  Created?: number
}

export async function images(): Promise<DockerImage[]> {
  const [list, used] = await Promise.all([api<RawImage[]>('GET', '/images/json'), api<RawContainer[]>('GET', `/containers/json${q({ all: true })}`)])
  return list.map((i) => {
    const tags = (i.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>')
    return {
      id: i.Id,
      tags: tags.length ? tags : (i.RepoDigests ?? []).filter((d) => !d.startsWith('<none>')).map((d) => d.replace(/@.*/, '@…')),
      size: i.Size ?? 0,
      created: (i.Created ?? 0) * 1000,
      containers: used.filter((c) => c.ImageID === i.Id).length,
      dangling: tags.length === 0
    }
  })
}

export async function removeImage(id: unknown, force: unknown): Promise<void> {
  await api('DELETE', `/images/${imageRef(id)}${q({ force: force === true })}`)
}

export async function volumes(): Promise<DockerVolume[]> {
  const [res, used] = await Promise.all([
    api<{ Volumes?: { Name: string; Driver?: string; Mountpoint?: string; CreatedAt?: string }[] | null }>('GET', '/volumes'),
    containers()
  ])
  return (res.Volumes ?? []).map((v) => ({
    name: v.Name,
    driver: v.Driver ?? '',
    mountpoint: v.Mountpoint ?? '',
    created: v.CreatedAt ?? null,
    usedBy: used.filter((c) => c.volumes.includes(v.Name)).map((c) => c.name)
  }))
}

export async function removeVolume(name: unknown): Promise<void> {
  await api('DELETE', `/volumes/${imageRef(name)}`)
}

const BUILTIN_NETWORKS = ['bridge', 'host', 'none']

export async function networks(): Promise<DockerNetwork[]> {
  const [list, used] = await Promise.all([api<{ Id: string; Name: string; Driver?: string; Scope?: string }[]>('GET', '/networks'), containers()])
  return list.map((n) => ({
    id: n.Id,
    name: n.Name,
    driver: n.Driver ?? '',
    scope: n.Scope ?? '',
    containers: used.filter((c) => c.networks.includes(n.Name)).map((c) => c.name),
    builtin: BUILTIN_NETWORKS.includes(n.Name)
  }))
}

export async function removeNetwork(id: unknown): Promise<void> {
  await api('DELETE', `/networks/${imageRef(id)}`)
}

interface RawDf {
  Images?: { Size?: number; Containers?: number }[] | null
  Containers?: { SizeRw?: number; State?: string }[] | null
  Volumes?: { UsageData?: { Size?: number; RefCount?: number } }[] | null
  BuildCache?: { Size?: number; InUse?: boolean; Shared?: boolean }[] | null
}

/** What `docker system df` shows: how much each kind takes and how much a prune would free. */
export async function diskUsage(): Promise<DockerDiskUsage> {
  const df = await api<RawDf>('GET', '/system/df', undefined, 120_000)
  const row = <T>(list: T[] | null | undefined, size: (x: T) => number, free: (x: T) => boolean): { count: number; size: number; reclaimable: number } => ({
    count: (list ?? []).length,
    size: (list ?? []).reduce((n, x) => n + Math.max(0, size(x)), 0),
    reclaimable: (list ?? []).filter(free).reduce((n, x) => n + Math.max(0, size(x)), 0)
  })
  return {
    images: row(df.Images, (i) => i.Size ?? 0, (i) => (i.Containers ?? 0) <= 0),
    containers: row(df.Containers, (c) => c.SizeRw ?? 0, (c) => c.State !== 'running' && c.State !== 'paused'),
    volumes: row(df.Volumes, (v) => v.UsageData?.Size ?? 0, (v) => (v.UsageData?.RefCount ?? 0) === 0),
    buildCache: row(df.BuildCache, (b) => b.Size ?? 0, (b) => !b.InUse && !b.Shared)
  }
}

/** Removes what nothing uses; returns the bytes freed (0 where the engine does not say). */
export async function prune(kind: unknown): Promise<number> {
  if (!PRUNE_KINDS.includes(kind as DockerPruneKind)) throw new Error(t('docker.invalid'))
  const route: Record<DockerPruneKind, string> = {
    containers: '/containers/prune',
    // Unused images, not only dangling ones, as the reclaimable figure counts them.
    images: `/images/prune${q({ filters: { dangling: ['false'] } })}`,
    // Named volumes too: since API 1.42 a bare prune spares them, yet they are what takes the space.
    volumes: `/volumes/prune${q({ filters: { all: ['true'] } })}`,
    networks: '/networks/prune',
    buildCache: '/build/prune'
  }
  const res = await api<{ SpaceReclaimed?: number } | null>('POST', route[kind as DockerPruneKind], undefined, 600_000)
  return res?.SpaceReclaimed ?? 0
}

// ---- compose -----------------------------------------------------------------------------------

function runCli(args: string[], cwd: string): Promise<string> {
  return dockerCli().then(
    (bin) =>
      new Promise((done, fail) => {
        if (!bin) return fail(new Error(t('docker.noCli')))
        execFile(bin, args, { cwd, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH: `${process.env.PATH ?? ''}${path.delimiter}${path.dirname(bin)}` } }, (err, stdout, stderr) => {
          const out = `${stdout}${stderr}`.trim()
          if (err) fail(new Error(out.split('\n').slice(-12).join('\n') || err.message))
          else done(out)
        })
      })
  )
}

const ACTION_ARGS: Record<ComposeAction, string[]> = { up: ['up', '-d'], down: ['down'], restart: ['restart'], stop: ['stop'], pull: ['pull'] }

/** A compose command on a project the engine knows, from the directory and files its containers were made from. */
export async function compose(project: unknown, act: unknown): Promise<string> {
  if (!isProjectName(project) || !COMPOSE_ACTIONS.includes(act as ComposeAction)) throw new Error(t('docker.invalid'))
  const member = (await containers()).find((c) => c.project === project && c.workingDir)
  if (!member?.workingDir) throw new Error(t('docker.noProjectDir'))
  const files = member.configFiles.flatMap((f) => ['-f', f])
  return runCli(['compose', '-p', project, '--project-directory', member.workingDir, ...files, ...ACTION_ARGS[act as ComposeAction]], member.workingDir)
}

/** The compose file in a local folder, if it has one. */
export async function composeFile(folder: unknown): Promise<string | null> {
  const dir = validatePath(folder)
  if (await isVirtual(dir)) return null
  const names = await readdir(dir).catch(() => [] as string[])
  return COMPOSE_FILES.find((f) => names.includes(f)) ?? null
}

/** `docker compose up -d` for the compose file in a folder. */
export async function composeUp(folder: unknown): Promise<string> {
  const dir = validatePath(folder)
  const file = await composeFile(dir)
  if (!file) throw new Error(t('docker.noComposeFile'))
  return runCli(['compose', '--project-directory', dir, '-f', path.join(dir, file), 'up', '-d'], dir)
}

// ---- streams -----------------------------------------------------------------------------------

interface Stream {
  owner: WebContents
  stop(): void
}

const streams = new Map<string, Stream>()
let seq = 0

function emit(owner: WebContents, event: DockerStreamEvent): void {
  if (!owner.isDestroyed()) owner.send(IPC.dockerStream, event)
}

/** Opens a long response from the engine; `onData` gets its bytes until it ends, is stopped, or returns an error to end with. */
async function open(owner: WebContents, method: string, p: string, onData: (chunk: Buffer) => string | void, onEnd?: () => void): Promise<string> {
  const e = (await resolve()) ?? (await resolve(true))
  if (!e) throw new Error(t('docker.notRunning'))
  const id = `docker-${++seq}`
  let ended = false
  const finish = (error?: string): void => {
    if (ended) return
    ended = true
    streams.delete(id)
    onEnd?.()
    emit(owner, { id, kind: 'end', ...(error ? { error } : {}) })
  }
  await new Promise<void>((started, fail) => {
    const req = http.request({ ...e, method, path: p, headers: { Host: 'docker' } }, (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          let message = Buffer.concat(chunks).toString('utf8')
          try {
            message = (JSON.parse(message) as { message?: string }).message ?? message
          } catch {
            // Plain text.
          }
          fail(new Error(message.trim() || `HTTP ${res.statusCode}`))
        })
        return
      }
      streams.set(id, { owner, stop: () => (req.destroy(), finish()) })
      started()
      res.on('data', (chunk: Buffer) => {
        const error = onData(chunk)
        if (error) {
          req.destroy()
          finish(error)
        }
      })
      res.on('end', () => finish())
      res.on('error', (err) => finish(err.message))
    })
    req.on('error', (err) => {
      fail(err)
      finish(err.message)
    })
    req.end()
  })
  owner.once('destroyed', () => stop(owner, id))
  return id
}

export function stop(owner: WebContents, id: unknown): void {
  const s = typeof id === 'string' ? streams.get(id) : undefined
  if (s && s.owner === owner) s.stop()
}

export function dispose(): void {
  for (const s of [...streams.values()]) s.stop()
}

/** Follows a container's logs from its last `tail` lines; lines go out in batches. */
export async function logs(owner: WebContents, id: unknown, tail: unknown, timestamps: unknown): Promise<string> {
  const target = ref(id)
  const { tty } = await inspect(id)
  const decoder = new LogDecoder(tty)
  let batch: DockerLogLine[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let streamId = ''
  const flush = (): void => {
    timer = null
    if (batch.length) emit(owner, { id: streamId, kind: 'log', lines: batch })
    batch = []
  }
  const lines = typeof tail === 'number' && tail > 0 ? Math.min(Math.floor(tail), 100_000) : 'all'
  streamId = await open(
    owner,
    'GET',
    `/containers/${target}/logs${q({ follow: true, stdout: true, stderr: true, tail: lines, timestamps: timestamps === true })}`,
    (chunk) => {
      batch.push(...decoder.push(chunk))
      timer ??= setTimeout(flush, LOG_FLUSH_MS)
    },
    () => {
      batch.push(...decoder.flush())
      if (timer) clearTimeout(timer)
      flush()
    }
  )
  return streamId
}

/** The container's stats stream, about one reading a second. */
export async function stats(owner: WebContents, id: unknown): Promise<string> {
  let buffer = ''
  let prev: RawStats | null = null
  let streamId = ''
  streamId = await open(owner, 'GET', `/containers/${ref(id)}/stats${q({ stream: true })}`, (chunk) => {
    buffer += chunk.toString('utf8')
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      try {
        const s = JSON.parse(line) as RawStats
        emit(owner, { id: streamId, kind: 'stats', point: statsPoint(s, prev) })
        prev = s
      } catch {
        // A torn line; the next reading follows within a second.
      }
    }
  })
  return streamId
}

/** Pulls an image, reporting the engine's status line and the overall progress of its layers. */
export async function pull(owner: WebContents, image: unknown): Promise<string> {
  if (!isImageRef(image)) throw new Error(t('docker.invalid'))
  const { image: name, tag } = splitImageRef(image)
  const layers = new Map<string, { current: number; total: number }>()
  let buffer = ''
  let streamId = ''
  streamId = await open(owner, 'POST', `/images/create${q({ fromImage: name, tag })}`, (chunk) => {
    buffer += chunk.toString('utf8')
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      let msg: { status?: string; id?: string; error?: string; progressDetail?: { current?: number; total?: number } }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.error) return msg.error
      if (msg.id && msg.progressDetail?.total) layers.set(msg.id, { current: msg.progressDetail.current ?? 0, total: msg.progressDetail.total })
      const all = [...layers.values()]
      const total = all.reduce((n, l) => n + l.total, 0)
      emit(owner, { id: streamId, kind: 'pull', status: [msg.id, msg.status].filter(Boolean).join(': '), percent: total ? (all.reduce((n, l) => n + Math.min(l.current, l.total), 0) / total) * 100 : null })
    }
  })
  return streamId
}

/** Engine events, coalesced into "something changed" so the area reloads what it shows. */
export async function events(owner: WebContents): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let streamId = ''
  streamId = await open(
    owner,
    'GET',
    `/events${q({ filters: { type: ['container', 'image', 'volume', 'network'] } })}`,
    () => {
      timer ??= setTimeout(() => {
        timer = null
        emit(owner, { id: streamId, kind: 'changed' })
      }, 300)
    },
    () => timer && clearTimeout(timer)
  )
  return streamId
}
