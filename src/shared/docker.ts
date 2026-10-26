// The Docker area: types shared by main and the renderer, and the pure parts of talking to the Docker Engine
// API (log stream framing, stats arithmetic, compose grouping, reference checks). No Node or DOM APIs here.

export type DockerState = 'running' | 'stopped' | 'missing'

export interface DockerStatus {
  state: DockerState
  /** Where the engine answered (socket path or host), null when none did. */
  host: string | null
  version?: string
  os?: string
  name?: string
  cpus?: number
  memory?: number
  running?: number
  containers?: number
  images?: number
  /** A desktop app aFinder can start when the engine is not running (Docker Desktop, OrbStack). */
  desktop: string | null
}

export interface DockerPort {
  private: number
  public: number | null
  ip: string | null
  type: string
}

export type ContainerState = 'running' | 'paused' | 'exited' | 'created' | 'restarting' | 'removing' | 'dead'

export interface DockerContainer {
  id: string
  name: string
  image: string
  imageId: string
  state: ContainerState
  /** The engine's own words: "Up 3 hours (healthy)", "Exited (0) 2 days ago". */
  status: string
  created: number
  ports: DockerPort[]
  project: string | null
  service: string | null
  /** Compose's project directory and files, from its labels. */
  workingDir: string | null
  configFiles: string[]
  volumes: string[]
  networks: string[]
}

export interface DockerUsage {
  id: string
  cpu: number
  mem: number
  memLimit: number
}

/** One reading of a container's stats stream; rates are per second since the previous one. */
export interface DockerStatsPoint {
  cpu: number
  mem: number
  memLimit: number
  netRx: number | null
  netTx: number | null
  blkRead: number | null
  blkWrite: number | null
  pids: number
}

export interface DockerMount {
  type: string
  source: string
  destination: string
  rw: boolean
  name: string | null
}

export interface DockerInspect {
  id: string
  name: string
  image: string
  command: string
  created: string
  started: string | null
  finished: string | null
  exitCode: number | null
  health: string | null
  restartPolicy: string
  tty: boolean
  env: string[]
  mounts: DockerMount[]
  networks: { name: string; ip: string; gateway: string; mac: string }[]
  ports: DockerPort[]
  labels: Record<string, string>
}

export interface DockerImage {
  id: string
  tags: string[]
  size: number
  created: number
  containers: number
  dangling: boolean
}

export interface DockerVolume {
  name: string
  driver: string
  mountpoint: string
  created: string | null
  usedBy: string[]
}

export interface DockerNetwork {
  id: string
  name: string
  driver: string
  scope: string
  containers: string[]
  builtin: boolean
}

export interface DockerUsageRow {
  count: number
  size: number
  reclaimable: number
}

export interface DockerDiskUsage {
  images: DockerUsageRow
  containers: DockerUsageRow
  volumes: DockerUsageRow
  buildCache: DockerUsageRow
}

export const PRUNE_KINDS = ['containers', 'images', 'volumes', 'networks', 'buildCache'] as const
export type DockerPruneKind = (typeof PRUNE_KINDS)[number]

export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill', 'remove'] as const
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number]

export const COMPOSE_ACTIONS = ['up', 'down', 'restart', 'stop', 'pull'] as const
export type ComposeAction = (typeof COMPOSE_ACTIONS)[number]

export interface DockerLogLine {
  stream: 'stdout' | 'stderr'
  text: string
}

/** Pushed from main for a stream the renderer started (logs, stats, pull) and for engine events. */
export type DockerStreamEvent =
  | { id: string; kind: 'log'; lines: DockerLogLine[] }
  | { id: string; kind: 'stats'; point: DockerStatsPoint }
  | { id: string; kind: 'pull'; status: string; percent: number | null }
  | { id: string; kind: 'changed' }
  | { id: string; kind: 'end'; error?: string }

/** Container ids and names: what the engine accepts in a path segment, nothing that could leave it. */
export const isContainerRef = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(s)

/** Image references (`nginx`, `ghcr.io/org/app:1.2`, `sha256:…`, `name@sha256:…`) and volume/network names. */
export const isImageRef = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/.test(s) && !s.includes('..') && !s.includes('//')

/** Compose project names as compose itself normalizes them. */
export const isProjectName = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(s)

export const shortId = (id: string): string => id.replace(/^sha256:/, '').slice(0, 12)

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
export const stripAnsi = (s: string): string => s.replace(ANSI, '')

/** Splits `fromImage` for the pull endpoint: without a tag or digest the engine would pull every tag. */
export function splitImageRef(ref: string): { image: string; tag: string } {
  const at = ref.indexOf('@')
  if (at > 0) return { image: ref.slice(0, at), tag: ref.slice(at + 1) }
  const slash = ref.lastIndexOf('/')
  const colon = ref.lastIndexOf(':')
  return colon > slash ? { image: ref.slice(0, colon), tag: ref.slice(colon + 1) } : { image: ref, tag: 'latest' }
}

/**
 * Container logs come framed unless the container has a TTY: an 8-byte header (stream type, 3 zero bytes,
 * big-endian length) before each payload. Frames and lines both may be split across chunks, so the
 * decoder keeps what is left over and returns only whole lines.
 */
export class LogDecoder {
  private pending = new Uint8Array(0)
  private partial: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }
  private text = new TextDecoder()
  private err = new TextDecoder()

  constructor(private readonly tty: boolean) {}

  push(chunk: Uint8Array): DockerLogLine[] {
    if (this.tty) return this.lines('stdout', this.text.decode(chunk, { stream: true }))
    const data = this.pending.length ? concat(this.pending, chunk) : chunk
    const out: DockerLogLine[] = []
    let at = 0
    while (data.length - at >= 8) {
      const size = ((data[at + 4] << 24) >>> 0) + (data[at + 5] << 16) + (data[at + 6] << 8) + data[at + 7]
      if (data.length - at - 8 < size) break
      const stream = data[at] === 2 ? 'stderr' : 'stdout'
      const payload = data.subarray(at + 8, at + 8 + size)
      out.push(...this.lines(stream, (stream === 'stderr' ? this.err : this.text).decode(payload, { stream: true })))
      at += 8 + size
    }
    this.pending = data.slice(at)
    return out
  }

  /** What is left when the stream ends: a last line without a newline. */
  flush(): DockerLogLine[] {
    const out: DockerLogLine[] = []
    for (const stream of ['stdout', 'stderr'] as const) {
      if (this.partial[stream]) out.push({ stream, text: stripAnsi(this.partial[stream]) })
      this.partial[stream] = ''
    }
    return out
  }

  private lines(stream: 'stdout' | 'stderr', text: string): DockerLogLine[] {
    const parts = (this.partial[stream] + text).split(/\r?\n/)
    this.partial[stream] = parts.pop() ?? ''
    return parts.map((line) => ({ stream, text: stripAnsi(line.replace(/\r/g, '')) }))
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** The subset of the engine's stats document used here. */
export interface RawStats {
  read?: string
  pids_stats?: { current?: number }
  cpu_stats?: { cpu_usage?: { total_usage?: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number }
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number }
  memory_stats?: { usage?: number; limit?: number; stats?: Record<string, number> }
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>
  blkio_stats?: { io_service_bytes_recursive?: { op?: string; value?: number }[] | null }
}

/**
 * CPU in percent of one core, as `docker stats` shows it: the container's share of the host's CPU time
 * between two readings, times the number of CPUs. `prev` stands in for precpu_stats, which one-shot
 * readings leave empty.
 */
export function cpuPercent(s: RawStats, prev?: { total: number; system: number }): number {
  const total = s.cpu_stats?.cpu_usage?.total_usage ?? 0
  const system = s.cpu_stats?.system_cpu_usage ?? 0
  const before = prev ?? { total: s.precpu_stats?.cpu_usage?.total_usage ?? 0, system: s.precpu_stats?.system_cpu_usage ?? 0 }
  const cpuDelta = total - before.total
  const sysDelta = system - before.system
  const cpus = s.cpu_stats?.online_cpus || s.cpu_stats?.cpu_usage?.percpu_usage?.length || 1
  return before.system > 0 && sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0
}

/** Memory without the page cache, as `docker stats` counts it (cgroup v2 inactive_file, v1 total_inactive_file). */
export function memUsage(s: RawStats): number {
  const usage = s.memory_stats?.usage ?? 0
  const st = s.memory_stats?.stats ?? {}
  const cache = st.inactive_file ?? st.total_inactive_file ?? 0
  return Math.max(0, usage - (cache < usage ? cache : 0))
}

export function ioTotals(s: RawStats): { netRx: number | null; netTx: number | null; blkRead: number | null; blkWrite: number | null } {
  const nets = s.networks ? Object.values(s.networks) : null
  const blk = s.blkio_stats?.io_service_bytes_recursive ?? null
  const sum = (op: string): number => (blk ?? []).filter((e) => e.op?.toLowerCase() === op).reduce((n, e) => n + (e.value ?? 0), 0)
  return {
    netRx: nets ? nets.reduce((n, x) => n + (x.rx_bytes ?? 0), 0) : null,
    netTx: nets ? nets.reduce((n, x) => n + (x.tx_bytes ?? 0), 0) : null,
    blkRead: blk ? sum('read') : null,
    blkWrite: blk ? sum('write') : null
  }
}

/** A stats point from two consecutive readings of the stream (rates per second). */
export function statsPoint(s: RawStats, prev: RawStats | null): DockerStatsPoint {
  const now = ioTotals(s)
  const before = prev ? ioTotals(prev) : null
  const seconds = prev?.read && s.read ? (Date.parse(s.read) - Date.parse(prev.read)) / 1000 : 0
  const rate = (a: number | null, b: number | null | undefined): number | null => (a === null ? null : b === null || b === undefined || seconds <= 0 ? 0 : Math.max(0, (a - b) / seconds))
  return {
    cpu: cpuPercent(s),
    mem: memUsage(s),
    memLimit: s.memory_stats?.limit ?? 0,
    netRx: rate(now.netRx, before?.netRx),
    netTx: rate(now.netTx, before?.netTx),
    blkRead: rate(now.blkRead, before?.blkRead),
    blkWrite: rate(now.blkWrite, before?.blkWrite),
    pids: s.pids_stats?.current ?? 0
  }
}

interface RawPort {
  PrivatePort?: number
  PublicPort?: number
  IP?: string
  Type?: string
}

/** Published ports once each: the engine lists a mapping per address family (0.0.0.0 and ::). */
export function mapPorts(ports: RawPort[] | null | undefined): DockerPort[] {
  const seen = new Set<string>()
  const out: DockerPort[] = []
  for (const p of ports ?? []) {
    const key = `${p.PrivatePort}/${p.Type}/${p.PublicPort ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ private: p.PrivatePort ?? 0, public: p.PublicPort ?? null, ip: p.IP ?? null, type: p.Type ?? 'tcp' })
  }
  return out.sort((a, b) => (a.public === null ? 1 : 0) - (b.public === null ? 1 : 0) || a.private - b.private)
}

export interface RawContainer {
  Id: string
  Names?: string[]
  Image?: string
  ImageID?: string
  State?: string
  Status?: string
  Created?: number
  Ports?: RawPort[]
  Labels?: Record<string, string> | null
  Mounts?: { Type?: string; Name?: string }[]
  NetworkSettings?: { Networks?: Record<string, unknown> }
}

const STATES: ContainerState[] = ['running', 'paused', 'exited', 'created', 'restarting', 'removing', 'dead']

export function mapContainer(c: RawContainer): DockerContainer {
  const labels = c.Labels ?? {}
  const state = (STATES as string[]).includes(c.State ?? '') ? (c.State as ContainerState) : 'dead'
  return {
    id: c.Id,
    name: (c.Names?.[0] ?? shortId(c.Id)).replace(/^\//, ''),
    image: c.Image ?? '',
    imageId: c.ImageID ?? '',
    state,
    status: c.Status ?? '',
    created: (c.Created ?? 0) * 1000,
    ports: mapPorts(c.Ports),
    project: labels['com.docker.compose.project'] ?? null,
    service: labels['com.docker.compose.service'] ?? null,
    workingDir: labels['com.docker.compose.project.working_dir'] ?? null,
    configFiles: (labels['com.docker.compose.project.config_files'] ?? '').split(',').filter(Boolean),
    volumes: (c.Mounts ?? []).filter((m) => m.Type === 'volume' && m.Name).map((m) => m.Name as string),
    networks: Object.keys(c.NetworkSettings?.Networks ?? {})
  }
}

export interface ContainerGroup {
  project: string | null
  containers: DockerContainer[]
}

/** Compose projects first (by name), then the containers that belong to none; inside, by service or name. */
export function groupContainers(list: DockerContainer[]): ContainerGroup[] {
  const groups = new Map<string | null, DockerContainer[]>()
  for (const c of list) groups.set(c.project, [...(groups.get(c.project) ?? []), c])
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([project, containers]) => ({ project, containers: containers.sort((a, b) => (a.service ?? a.name).localeCompare(b.service ?? b.name)) }))
}

/** How a DOCKER_HOST value is reached: a unix socket or Windows pipe path, or a TCP host. */
export type DockerEndpoint = { socketPath: string } | { host: string; port: number }

export function parseDockerHost(value: string): DockerEndpoint | null {
  const v = value.trim()
  if (v.startsWith('unix://')) return { socketPath: v.slice(7) }
  if (v.startsWith('npipe://')) return { socketPath: v.slice(8).replace(/\//g, '\\') }
  const tcp = /^(?:tcp|http):\/\/([^:/]+)(?::(\d+))?\/?$/.exec(v)
  if (tcp) return { host: tcp[1], port: Number(tcp[2] ?? 2375) }
  return null
}

/** Sockets of the usual engines, tried in order when DOCKER_HOST is not set. */
export function socketCandidates(platform: string, home: string, uid: number | null): string[] {
  if (platform === 'win32') return ['\\\\.\\pipe\\docker_engine', '\\\\.\\pipe\\dockerDesktopLinuxEngine']
  const list = [
    `${home}/.docker/run/docker.sock`,
    '/var/run/docker.sock',
    `${home}/.orbstack/run/docker.sock`,
    `${home}/.colima/default/docker.sock`,
    `${home}/.colima/docker.sock`,
    `${home}/.rd/docker.sock`,
    `${home}/.docker/desktop/docker.sock`
  ]
  if (uid !== null) list.push(`/run/user/${uid}/docker.sock`, `/run/user/${uid}/podman/podman.sock`)
  return list
}
