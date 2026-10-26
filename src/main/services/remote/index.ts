// Remote connections mounted as folders. Each connection lives at "<userData>/Remote/<id>"; the folder
// does not exist on disk – list(), materialize() and friends serve it from the connection's provider.
// Downloads are cached in the temp folder (reused while size and date match) so previews, opening
// and copying out work on real files, exactly like members of an archive.
//
// Connections are kept in remotes.json; passwords, key passphrases and S3 secret keys are encrypted
// with the OS keychain (Electron safeStorage) and never reach the renderer.

import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, safeStorage } from 'electron'
import { t } from '@shared/i18n'
import {
  emptyConnection,
  REMOTE_ID,
  REMOTE_TYPES,
  remoteUrl,
  slugify,
  type RemoteConnection,
  type RemoteMount,
  type RemoteSecrets
} from '@shared/remote'
import { IPC, type FileEntry, type Listing } from '@shared/types'
import { ROOM_RE } from '@shared/companion/protocol'
import { isHiddenName, kindOf } from '../entries'
import type { AfinderProvider } from './afinder'
import { fsError, type RemoteItem, type RemoteProvider } from './provider'

interface Stored extends RemoteConnection {
  /** safeStorage-encrypted JSON of RemoteSecrets, base64. */
  secrets?: string
  /** Pinned SSH host key (SHA-256). */
  hostKey?: string
  /** Microsoft Graph: safeStorage-encrypted MSAL token cache, base64. */
  tokenCache?: string
}

/** A path inside a connection (or its root). */
export interface Located {
  connection: RemoteConnection
  /** Folder the connection is mounted at. */
  mount: string
  /** Segments below the connection's root folder. */
  inner: string[]
}

const IDLE_MS = 10 * 60_000

let stored: Stored[] | null = null
/** Token cache of a Graph sign-in made by "Test" in the dialog, taken over when that connection is saved. */
let pendingGraphCache: { key: string; cache: string } | null = null
const graphKey = (c: RemoteConnection): string => `${c.clientId}|${c.tenant}|${c.graphTarget}`
/** aFinder on another computer that was just paired, taken over when that connection is saved. */
let pendingComputer: { room: string; clientKey: string } | null = null
/** A pairing in progress: the code check is shown while the other computer's user confirms. */
let pairing: { abort: AbortController; done: Promise<RemoteConnection> } | null = null
const providers = new Map<string, { provider: Promise<RemoteProvider>; timer: ReturnType<typeof setTimeout> | null }>()

const file = (): string => path.join(app.getPath('userData'), 'remotes.json')
export const mountRoot = (): string => path.join(app.getPath('userData'), 'Remote')
const cacheRoot = (): string => path.join(app.getPath('temp'), 'afinder-remote')

function load(): Stored[] {
  if (stored) return stored
  try {
    const data = JSON.parse(readFileSync(file(), 'utf8')) as { connections?: Stored[] }
    stored = (data.connections ?? [])
      .filter((c) => REMOTE_ID.test(c.id) && REMOTE_TYPES.includes(c.type))
      // Connections saved by an older version lack the newer fields.
      .map((c) => ({ ...emptyConnection(c.type), ...c }))
  } catch {
    stored = []
  }
  return stored
}

function persist(): void {
  writeFileSync(file(), JSON.stringify({ connections: load() }, null, 2))
}

function publicOf(s: Stored): RemoteConnection {
  const { secrets: _secrets, hostKey: _hostKey, tokenCache: _tokenCache, ...connection } = s
  return connection
}

const encrypt = (text: string): string | undefined =>
  safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : undefined

function decrypt(value: string | undefined): string | null {
  if (!value) return null
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return null
  }
}

function secretsOf(s: Stored | undefined): RemoteSecrets {
  if (!s?.secrets) return {}
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(s.secrets, 'base64'))) as RemoteSecrets
  } catch {
    return {} // encrypted on another machine or by another user
  }
}

/** Tells every window to re-read the folder (remote folders are not watched). */
function changed(dir: string): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.dirChanged, dir)
}

function mountsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.remoteChanged)
}

// ---- connections -------------------------------------------------------------------------------

export function mounts(): RemoteMount[] {
  return load().map((s) => ({
    connection: publicOf(s),
    path: path.join(mountRoot(), s.id),
    url: remoteUrl(s),
    connected: providers.has(s.id)
  }))
}

const str = (v: unknown, max = 1024): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Only known fields with sane values come from the renderer. */
function sanitize(input: unknown): RemoteConnection {
  const c = (input ?? {}) as Record<string, unknown>
  const type = REMOTE_TYPES.find((x) => x === c.type)
  if (!type) throw new Error(t('error.invalidOption'))
  const port = Number(c.port)
  const out: RemoteConnection = {
    id: str(c.id, 41),
    name: str(c.name, 80),
    type,
    host: str(c.host, 255),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : type === 'sftp' ? 22 : 443,
    username: str(c.username, 255),
    root: str(c.root),
    sftpAuth: c.sftpAuth === 'key' || c.sftpAuth === 'agent' ? c.sftpAuth : 'password',
    keyPath: str(c.keyPath),
    bucket: str(c.bucket, 255),
    region: str(c.region, 64),
    endpoint: str(c.endpoint),
    accessKeyId: str(c.accessKeyId, 256),
    clientId: str(c.clientId, 64),
    tenant: str(c.tenant, 128) || 'organizations',
    graphTarget: c.graphTarget === 'onedrive' ? 'onedrive' : 'sharepoint',
    siteUrl: str(c.siteUrl, 2048),
    library: str(c.library, 255),
    peerRelay: type === 'afinder' ? str(c.peerRelay, 2048) : '',
    peerRoom: type === 'afinder' ? str(c.peerRoom, 43) : '',
    peerKey: type === 'afinder' ? str(c.peerKey, 43) : ''
  }
  if (!out.name) throw new Error(t('remote.error.noName'))
  if (type === 'sftp' && (!out.host || !out.username)) throw new Error(t('remote.error.noHost'))
  if (type === 'sftp' && out.sftpAuth === 'key' && !out.keyPath) throw new Error(t('remote.error.noKey'))
  // Also passed to the ssh command line (terminal): no option-like or odd values.
  if (type === 'sftp' && (!/^[A-Za-z0-9._:[\]-]+$/.test(out.host) || out.host.startsWith('-'))) throw new Error(t('remote.error.badHost'))
  if (type === 'sftp' && (!/^[^\s@:/\\]+$/.test(out.username) || out.username.startsWith('-'))) throw new Error(t('remote.error.badUser'))
  if (type === 's3' && !/^[a-z0-9][a-z0-9.-]{1,62}$/.test(out.bucket)) throw new Error(t('remote.error.badBucket'))
  if (out.endpoint && !/^https?:\/\/[^\s]+$/i.test(out.endpoint)) throw new Error(t('remote.error.badEndpoint'))
  if (type === 'afinder' && (!/^wss?:\/\/[^\s]+$/.test(out.peerRelay) || !ROOM_RE.test(out.peerRoom) || !/^[A-Za-z0-9_-]{43}$/.test(out.peerKey))) throw new Error(t('remote.error.computerUnpaired'))
  if (type === 'graph') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.clientId)) throw new Error(t('remote.error.badClientId'))
    if (!/^[A-Za-z0-9.-]+$/.test(out.tenant)) throw new Error(t('remote.error.badTenant'))
    if (out.graphTarget === 'sharepoint' && !/^https:\/\/[^\s/]+(\/\S*)?$/i.test(out.siteUrl)) throw new Error(t('remote.error.badSiteUrl'))
  }
  return out
}

function sanitizeSecrets(input: unknown): RemoteSecrets {
  const s = (input ?? {}) as Record<string, unknown>
  const out: RemoteSecrets = {}
  for (const k of ['password', 'passphrase', 'secretAccessKey'] as const) if (typeof s[k] === 'string' && s[k]) out[k] = s[k] as string
  return out
}

/** Creates or updates a connection; returns its id. Empty secret fields keep the saved ones. */
export async function save(input: unknown, secretsInput: unknown): Promise<string> {
  const c = sanitize(input)
  const typed = sanitizeSecrets(secretsInput)
  const list = load()
  const existing = c.id ? list.find((s) => s.id === c.id) : undefined
  if (c.id && !existing) throw new Error(t('error.notFound'))
  if (!existing) {
    const base = slugify(c.name)
    let id = base
    for (let n = 2; list.some((s) => s.id === id); n++) id = `${base}-${n}`
    c.id = id
  }
  const secrets = { ...secretsOf(existing), ...typed }
  if (c.type === 'afinder') {
    // Pairing, not the form, decides which computer this is: a new one needs the key just made for it.
    if (existing && (existing.peerRoom !== c.peerRoom || existing.peerKey !== c.peerKey)) throw new Error(t('remote.error.computerUnpaired'))
    if (!existing) {
      if (pendingComputer?.room !== c.peerRoom) throw new Error(t('remote.error.computerUnpaired'))
      secrets.clientKey = pendingComputer.clientKey
      pendingComputer = null
    }
  }
  let encrypted: string | undefined
  if (Object.keys(secrets).length > 0) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error(t('remote.error.noKeychain'))
    encrypted = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
  }
  // A different server must not inherit the pinned host key of the old one.
  const hostKey = existing && existing.host === c.host && existing.port === c.port ? existing.hostKey : undefined
  // Likewise a Graph sign-in belongs to one app registration and tenant.
  let tokenCache = existing && existing.type === 'graph' && graphKey(existing) === graphKey(c) ? existing.tokenCache : undefined
  if (!tokenCache && c.type === 'graph' && pendingGraphCache?.key === graphKey(c)) tokenCache = encrypt(pendingGraphCache.cache)
  pendingGraphCache = null
  const next: Stored = {
    ...c,
    ...(encrypted ? { secrets: encrypted } : {}),
    ...(hostKey ? { hostKey } : {}),
    ...(tokenCache ? { tokenCache } : {})
  }
  if (existing) list[list.indexOf(existing)] = next
  else list.push(next)
  persist()
  await disconnect(c.id)
  mountsChanged()
  return c.id
}

export async function remove(id: unknown): Promise<void> {
  const list = load()
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return
  await disconnect(list[i].id)
  list.splice(i, 1)
  persist()
  await rm(path.join(cacheRoot(), String(id)), { recursive: true, force: true }).catch(() => {})
  mountsChanged()
}

/** Connects with the values from the dialog (saved secrets fill empty fields) and lists the root. */
export async function test(input: unknown, secretsInput: unknown): Promise<void> {
  const c = sanitize(input)
  const existing = load().find((s) => s.id === c.id)
  const sameGraph = existing?.type === 'graph' && graphKey(existing) === graphKey(c)
  const pending = c.type === 'afinder' && pendingComputer?.room === c.peerRoom ? { clientKey: pendingComputer.clientKey } : {}
  const provider = await connect(c, { ...secretsOf(existing), ...pending, ...sanitizeSecrets(secretsInput) }, existing?.hostKey ?? null, () => {}, {
    tokenCache: sameGraph ? decrypt(existing.tokenCache) : pendingGraphCache?.key === graphKey(c) ? pendingGraphCache.cache : null,
    save: (cache) => (pendingGraphCache = { key: graphKey(c), cache })
  })
  try {
    await provider.list([])
  } finally {
    await provider.close()
  }
}

interface TokenCacheSlot {
  tokenCache: string | null
  save(cache: string): void
}

async function connect(
  c: RemoteConnection,
  secrets: RemoteSecrets,
  hostKey: string | null,
  onNewHostKey: (hash: string) => void,
  graph: TokenCacheSlot
): Promise<RemoteProvider> {
  if (c.type === 'graph') {
    const { connectGraph } = await import('./graph')
    return connectGraph({ connection: c, tokenCache: graph.tokenCache, saveTokenCache: graph.save })
  }
  if (c.type === 'afinder') {
    const { connectAfinder } = await import('./afinder')
    const provider = connectAfinder(c, secrets.clientKey)
    // Fails here (offline, unpaired) rather than on the first listing.
    await provider.info().catch(async (err: unknown) => {
      await provider.close()
      throw err
    })
    return provider
  }
  if (c.type === 'sftp') {
    const { connectSftp } = await import('./sftp')
    return connectSftp({ connection: c, secrets, hostKey, onNewHostKey })
  }
  const { connectS3 } = await import('./s3')
  return connectS3(c, secrets)
}

/** The connection's provider, connected on first use and closed after a while without use. */
function providerOf(id: string): Promise<RemoteProvider> {
  const s = load().find((x) => x.id === id)
  if (!s) return Promise.reject(fsError('ENOENT', t('error.notFound')))
  let slot = providers.get(id)
  if (!slot) {
    const provider = connect(
      publicOf(s),
      secretsOf(s),
      s.hostKey ?? null,
      (hash) => {
        s.hostKey = hash
        persist()
      },
      {
        tokenCache: decrypt(s.tokenCache),
        save: (cache) => {
          // Without a keychain the sign-in lasts only until the app quits.
          s.tokenCache = encrypt(cache)
          persist()
        }
      }
    )
    slot = { provider, timer: null }
    providers.set(id, slot)
    provider.then(mountsChanged, () => providers.delete(id))
  }
  if (slot.timer) clearTimeout(slot.timer)
  slot.timer = setTimeout(() => void disconnect(id), IDLE_MS)
  return slot.provider
}

/** The session with aFinder on another computer (remote desktop); also keeps it from closing as idle. */
export async function computer(id: string): Promise<AfinderProvider> {
  const s = load().find((x) => x.id === id)
  if (s?.type !== 'afinder') throw fsError('ENOENT', t('error.notFound'))
  return (await providerOf(id)) as AfinderProvider
}

/**
 * Starts pairing with aFinder on another computer from its pairing link; resolves with the code both
 * computers show. pairComputerWait() then resolves once the other computer's user confirmed.
 */
export async function pairComputerStart(uri: unknown): Promise<{ sas: string; name: string }> {
  pairComputerCancel()
  const [{ parsePairingUri }, { newKeyPair }, { pair }, { computerName }, { toB64 }] = await Promise.all([
    import('@shared/companion/protocol'),
    import('@shared/companion/crypto'),
    import('@shared/companion/client'),
    import('../computerName'),
    import('@shared/companion/bytes')
  ])
  const link = parsePairingUri(String(uri ?? ''))
  if (!link) throw new Error(t('remote.error.badPairingLink'))
  const identity = newKeyPair()
  const abort = new AbortController()
  let shown!: (sas: string) => void
  const sas = new Promise<string>((r) => (shown = r))
  const done = pair(link, identity, computerName(), shown, abort.signal, 'computer').then((computer) => {
    pendingComputer = { room: computer.id, clientKey: toB64(identity.secretKey) }
    return { ...emptyConnection('afinder'), name: link.name || 'aFinder', peerRelay: computer.relay, peerRoom: computer.id, peerKey: computer.key }
  })
  done.catch(() => {})
  const current = { abort, done }
  pairing = current
  let timer: ReturnType<typeof setTimeout> | undefined
  const failed = new Promise<never>((_, reject) => {
    done.catch((err: Error) => reject(pairingError(err)))
    // The code appears once the other aFinder answers; one that is not running never does.
    timer = setTimeout(() => reject(new Error(t('remote.error.computerNotRunning'))), 20_000)
  })
  failed.catch(() => {})
  try {
    return { sas: await Promise.race([sas, failed]), name: link.name }
  } catch (err) {
    if (pairing === current) endPairing(current)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function pairingError(err: Error): Error {
  if (err.message === 'declined') return new Error(t('remote.error.pairingDeclined'))
  if (err.message === 'pairing-closed') return new Error(t('remote.error.pairingClosed'))
  if (err.message === 'unreachable') return new Error(t('remote.error.computerOffline'))
  return err
}

/** The new connection (not saved yet) once the other computer accepted. */
export async function pairComputerWait(): Promise<RemoteConnection> {
  const p = pairing
  if (!p) throw new Error(t('remote.error.pairingClosed'))
  try {
    return await p.done.catch((err: Error) => Promise.reject(pairingError(err)))
  } finally {
    if (pairing === p) pairing = null
  }
}

function endPairing(p: NonNullable<typeof pairing>): void {
  p.abort.abort()
  if (pairing === p) pairing = null
}

export function pairComputerCancel(): void {
  pairing?.abort.abort()
  pairing = null
}

export async function disconnect(id: string): Promise<void> {
  const slot = providers.get(id)
  if (!slot) return
  providers.delete(id)
  if (slot.timer) clearTimeout(slot.timer)
  await slot.provider.then((p) => p.close(), () => {})
  mountsChanged()
}

export async function closeAll(): Promise<void> {
  await Promise.all([...providers.keys()].map(disconnect))
  await rm(cacheRoot(), { recursive: true, force: true }).catch(() => {})
}

// ---- paths ---------------------------------------------------------------------------------------

/** Null for paths outside the remote mounts. The folder holding all mounts is located with no connection. */
export function locate(p: string): Located | 'mounts' | null {
  const rel = path.relative(mountRoot(), p)
  if (rel === '') return 'mounts'
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const [id, ...inner] = rel.split(path.sep)
  const s = load().find((x) => x.id === id)
  if (!s) throw fsError('ENOENT', t('error.notFound'), p)
  return { connection: publicOf(s), mount: path.join(mountRoot(), id), inner }
}

const pathOf = (at: Located, inner = at.inner): string => path.join(at.mount, ...inner)

function entryOf(at: Located, item: RemoteItem): FileEntry {
  const kind = kindOf(item.name, item.isDir)
  return {
    name: item.name.normalize('NFC'),
    path: path.join(pathOf(at), item.name),
    isDir: item.isDir,
    isSymlink: false,
    hidden: isHiddenName(item.name),
    kind: item.isDir ? 'folder' : kind,
    size: item.isDir ? null : item.size,
    modified: item.modified
  }
}

export async function list(at: Located | 'mounts'): Promise<Listing> {
  if (at === 'mounts') {
    return {
      path: mountRoot(),
      parent: null,
      entries: mounts().map((m) => ({ name: m.connection.name, path: m.path, isDir: true, isSymlink: false, hidden: false, kind: 'folder', size: null, modified: 0 })),
      readOnly: true
    }
  }
  const items = await (await providerOf(at.connection.id)).list(at.inner)
  return {
    path: pathOf(at),
    // The connection's root has no parent: above it is only the virtual "Remote" folder.
    parent: at.inner.length > 0 ? pathOf(at, at.inner.slice(0, -1)) : mountRoot(),
    entries: items.map((i) => entryOf(at, i))
  }
}

export interface SshTarget {
  host: string
  port: number
  user: string
  /** Private key file (SFTP with a key), else ssh's own defaults, agent or a password prompt. */
  identity: string | null
  /** Absolute folder on the server. */
  dir: string
}

/** Where `ssh` should go for a folder on an SFTP connection; null for other kinds of storage. */
export function sshTarget(at: Located): SshTarget | null {
  const c = at.connection
  if (c.type !== 'sftp') return null
  const base = c.root && c.root !== '/' ? (c.root.startsWith('/') ? c.root : `/${c.root}`) : '/'
  return {
    host: c.host,
    port: c.port || 22,
    user: c.username,
    identity: c.sftpAuth === 'key' && c.keyPath ? c.keyPath : null,
    dir: path.posix.join(base, ...at.inner)
  }
}

export async function statOf(at: Located): Promise<RemoteItem | null> {
  return (await providerOf(at.connection.id)).stat(at.inner)
}

// ---- downloads -------------------------------------------------------------------------------

/**
 * The item as a real local path (a cached copy), downloading what is missing or out of date.
 * maxBytes guards automatic previews against pulling huge files.
 */
export async function materialize(at: Located, maxBytes = Infinity): Promise<string> {
  const provider = await providerOf(at.connection.id)
  const item = await provider.stat(at.inner)
  if (!item) throw fsError('ENOENT', t('error.notFound'), pathOf(at))
  const target = path.join(cacheRoot(), at.connection.id, ...(at.inner.length ? at.inner : ['_root']))
  if (!item.isDir) {
    if (item.size > maxBytes) throw new Error(t('remote.error.tooLargeToPreview'))
    await downloadFile(provider, at.inner, item, target)
    return target
  }
  await downloadTree(provider, at.inner, target)
  return target
}

async function downloadFile(provider: RemoteProvider, inner: string[], item: RemoteItem, target: string): Promise<void> {
  const cached = await stat(target).catch(() => null)
  if (cached?.isFile() && cached.size === item.size && (!item.modified || Math.abs(cached.mtimeMs - item.modified) < 1000)) return
  await mkdir(path.dirname(target), { recursive: true })
  const partial = `${target}.part`
  await provider.download(inner, partial)
  await rename(partial, target)
  if (item.modified) await utimes(target, new Date(item.modified), new Date(item.modified)).catch(() => {})
}

async function downloadTree(provider: RemoteProvider, inner: string[], target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const child of await provider.list(inner)) {
    const childTarget = path.join(target, child.name)
    if (child.isDir) await downloadTree(provider, [...inner, child.name], childTarget)
    else await downloadFile(provider, [...inner, child.name], child, childTarget)
  }
}

// ---- changes -----------------------------------------------------------------------------------

/** Uploads a local file or folder (recursively) to the remote path, which must not exist yet. */
export async function upload(local: string, at: Located): Promise<void> {
  const provider = await providerOf(at.connection.id)
  const put = async (src: string, inner: string[]): Promise<void> => {
    const st = await stat(src)
    if (st.isDirectory()) {
      await provider.mkdir(inner)
      for (const name of await readdir(src)) await put(path.join(src, name), [...inner, name])
    } else if (st.isFile()) {
      await provider.upload(src, inner)
    }
  }
  await put(local, at.inner)
  changed(pathOf(at, at.inner.slice(0, -1)))
}

export async function exists(at: Located): Promise<boolean> {
  return (await statOf(at)) !== null
}

export async function createFolder(at: Located, baseName: string): Promise<string> {
  const provider = await providerOf(at.connection.id)
  for (let n = 1; n < 10_000; n++) {
    const name = n === 1 ? baseName : `${baseName} ${n}`
    if (await provider.stat([...at.inner, name])) continue
    await provider.mkdir([...at.inner, name])
    changed(pathOf(at))
    return path.join(pathOf(at), name)
  }
  throw new Error(t('error.noFreeFolderName'))
}

export async function createFile(at: Located, baseName: string, ext: string): Promise<string> {
  const provider = await providerOf(at.connection.id)
  for (let n = 1; n < 10_000; n++) {
    const name = `${n === 1 ? baseName : `${baseName} ${n}`}${ext}`
    if (await provider.stat([...at.inner, name])) continue
    const empty = path.join(cacheRoot(), at.connection.id, ...at.inner, name)
    await mkdir(path.dirname(empty), { recursive: true })
    await writeFile(empty, '')
    await provider.upload(empty, [...at.inner, name])
    changed(pathOf(at))
    return path.join(pathOf(at), name)
  }
  throw new Error(t('error.noFreeFileName'))
}

export async function renameItem(at: Located, name: string): Promise<string> {
  if (at.inner.length === 0) throw new Error(t('error.invalidPath'))
  const provider = await providerOf(at.connection.id)
  const to = [...at.inner.slice(0, -1), name]
  if (to.at(-1) === at.inner.at(-1)) return pathOf(at)
  if (to.at(-1)!.toLowerCase() !== at.inner.at(-1)!.toLowerCase() && (await provider.stat(to))) {
    throw new Error(t('error.nameExists', { name }))
  }
  await provider.rename(at.inner, to)
  changed(pathOf(at, at.inner.slice(0, -1)))
  return pathOf(at, to)
}

/** Moves an item to another folder of the same connection. */
export async function moveWithin(from: Located, to: Located): Promise<void> {
  await (await providerOf(from.connection.id)).rename(from.inner, to.inner)
  changed(pathOf(from, from.inner.slice(0, -1)))
  changed(pathOf(to, to.inner.slice(0, -1)))
}

/** Deletes permanently (the caller has asked the user). */
export async function removeItem(at: Located): Promise<void> {
  if (at.inner.length === 0) throw new Error(t('error.invalidPath'))
  const provider = await providerOf(at.connection.id)
  const item = await provider.stat(at.inner)
  if (!item) return
  await provider.remove(at.inner, item.isDir)
  changed(pathOf(at, at.inner.slice(0, -1)))
}

/** Saves text or an image edited in the preview: refuses when the remote file changed since it was loaded. */
export async function writeText(at: Located, content: string | Uint8Array, expectedModified: number | null): Promise<number> {
  const provider = await providerOf(at.connection.id)
  const before = await provider.stat(at.inner)
  if (!before || before.isDir) throw fsError('ENOENT', t('error.notFound'), pathOf(at))
  if (expectedModified !== null && before.modified && Math.abs(before.modified - expectedModified) > 1) {
    throw new Error(t('preview.changedOnDisk'))
  }
  const target = path.join(cacheRoot(), at.connection.id, ...at.inner)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
  await provider.upload(target, at.inner)
  const after = await provider.stat(at.inner)
  if (after?.modified) await utimes(target, new Date(after.modified), new Date(after.modified)).catch(() => {})
  changed(pathOf(at, at.inner.slice(0, -1)))
  return after?.modified ?? Date.now()
}
