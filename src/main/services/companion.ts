// Phone companion: while the user has it on, aFinder keeps one outgoing WebSocket to the relay
// (mobile/relay) and serves paired phones over end-to-end encrypted sessions (src/shared/companion).
// No port is opened here and the relay sees only ciphertext. Loaded lazily from index.ts.

import { createHash, randomBytes } from 'node:crypto'
import { promises as fs, readFileSync, writeFileSync, type Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, clipboard, safeStorage, systemPreferences } from 'electron'
import { t } from '@shared/i18n'
import { fromB64, toB64, utf8 } from '@shared/companion/bytes'
import { helloAccept, keyPairOf, newKeyPair, pairAccept, type DeviceKind, type KeyPair, type Session } from '@shared/companion/crypto'
import {
  CHUNK_BYTES,
  CONFLICT,
  CONTROL_METHODS,
  DEFAULT_RELAY,
  Kind,
  METHODS,
  SCREEN_METHODS,
  STUN,
  WINDOW,
  WRITE_METHODS,
  chunkFrame,
  decodeFrame,
  jsonFrame,
  message,
  pairingUri,
  reject,
  roomUrl,
  sameVersion,
  splitConnection,
  withConnection,
  type ControlError,
  type FileVersion,
  type HostInfo,
  type IceServer,
  type ScreenEnd,
  type Method,
  type RejectReason,
  type RelayControl,
  type RpcMessage,
  type RpcMethods
} from '@shared/companion/protocol'
import type { CompanionDevice, CompanionStatus } from '@shared/types'
import type { ActivityInput, ActivityService } from './activityService'
import { computerName } from './computerName'
import type { InputInjector } from './inputInjector'
import type { ScreenCapture } from './screenCapture'
import * as files from './fileSystem'
import { thumbnail } from './preview'
import * as vfs from './vfs'

const PAIRING_MS = 5 * 60_000
/** A capture that has not answered by then (a system prompt left unanswered) ends. */
const SCREEN_START_MS = 60_000
/** The phone pings while it shows the screen; silence this long (app in background, gone) ends it. */
const SCREEN_SILENCE_MS = 45_000
const ICE_WAIT_MS = 5000
/** Through the TURN server (paid per GB) a session lasts this long, and the server then rests this long.
 * Direct connections have no limit and are tried first; during the rest only they are offered. */
const RELAY_LIMIT_MS = 10 * 60_000
const RELAY_COOLDOWN_MS = 30 * 60_000
const PING_MS = 30_000
/** Remote files are downloaded to this computer before they can go to the phone. */
const MAX_REMOTE_DOWNLOAD = 2 * 1024 ** 3

type Device = Omit<CompanionDevice, 'online'>

interface ScreenSession {
  id: number
  conn: Conn
  device: Device
  capture: ScreenCapture | null
  /** Replays the viewer's mouse and keyboard; null for a session that only watches. */
  injector: InputInjector | null
  since: number
  lastPing: number
  /** The page captured and answered; before that, the phone has nothing to ping about. */
  answered: boolean
  timer: ReturnType<typeof setInterval>
  /** The activity token of the start, so the end records how long it took. */
  token: ReturnType<ActivityService['begin']>
  /** Ends a session that goes through the TURN server. */
  relayTimer?: ReturnType<typeof setTimeout>
}

interface Stored {
  /** X25519 secret key and room secret, encrypted with safeStorage when the system offers it. */
  identity: string
  room: string
  encrypted: boolean
  devices: Device[]
}

interface Outgoing {
  kind: 'out'
  file: FileHandle
  size: number
  sent: number
  inflight: number
  /** One pump at a time reads the file; acks that arrive meanwhile only widen the window it sees. */
  pumping: boolean
}
interface Incoming {
  kind: 'in'
  file: FileHandle
  temp: string
  target: string
  size: number
  received: number
  /** Writes happen one after another; the ack goes out once a chunk is on disk. */
  queue: Promise<void>
  failed: string | null
  /** Set for `replace`: the target is overwritten, once more checked against `base`, keeping its mode. */
  replace?: { base?: FileVersion; mode: number }
}
type Stream = Outgoing | Incoming

interface Conn {
  c: number
  session: Session | null
  device: Device | null
  /** The phone proved it holds the paired key (its first frame decrypted). */
  verified: boolean
  streams: Map<number, Stream>
}

interface Pairing {
  /** A phone (QR code, Settings → Phone) or another computer (link, Settings → Remote access). */
  kind: DeviceKind
  code: Uint8Array
  uri: string
  qr: string
  expiresAt: number
  /** One phone per code; later attempts are refused. */
  used: boolean
}

export interface CompanionDeps {
  activity: ActivityService
  changed(status: CompanionStatus): void
}

function describe(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'EACCES' || code === 'EPERM') return t('error.denied')
  if (code === 'ENOENT') return t('error.notFound')
  if (code === 'EEXIST') return t('error.exists')
  return (err as Error)?.message || String(err)
}

/** Control needs the input helper, which the Mac App Store sandbox does not allow. */
const controlSupported = (): boolean => !process.mas

export class CompanionHost {
  private stored: Stored | null = null
  private identity: KeyPair | null = null
  private secret: Uint8Array | null = null
  private ws: WebSocket | null = null
  private state: CompanionStatus['state'] = 'off'
  private error: string | null = null
  private relay = ''
  private enabled = false
  private kinds: Record<DeviceKind, boolean> = { phone: false, computer: false }
  private conns = new Map<number, Conn>()
  private pairing: Pairing | null = null
  private request: { c: number; kind: DeviceKind; name: string; sas: string; key: Uint8Array; answer(ok: boolean): Uint8Array } | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private backoff = 1000
  private screen: ScreenSession | null = null
  /** Until then sessions get no TURN server (in memory: a restart of aFinder resets it). */
  private relayRestUntil = 0
  private iceWaiters: ((servers: IceServer[]) => void)[] = []

  constructor(private readonly deps: CompanionDeps) {}

  private file(): string {
    return path.join(app.getPath('userData'), 'companion.json')
  }

  /** Loads (or creates on first use) this computer's key, room secret and paired phones. */
  private load(): Stored {
    if (this.stored) return this.stored
    try {
      const s = JSON.parse(readFileSync(this.file(), 'utf8')) as Stored
      const open = (v: string): Uint8Array => (s.encrypted ? fromB64(safeStorage.decryptString(Buffer.from(v, 'base64'))) : fromB64(v))
      this.identity = keyPairOf(open(s.identity))
      this.secret = open(s.room)
      this.stored = { ...s, devices: Array.isArray(s.devices) ? s.devices.filter((d) => typeof d?.id === 'string' && typeof d.name === 'string').map((d) => ({ ...d, kind: d.kind === 'computer' ? 'computer' : 'phone', screen: d.screen === true, control: d.control === true && d.kind === 'computer' })) : [] }
    } catch {
      this.identity = newKeyPair()
      this.secret = new Uint8Array(randomBytes(32))
      this.stored = { identity: '', room: '', encrypted: false, devices: [] }
      this.save()
    }
    return this.stored
  }

  private save(): void {
    const s = this.stored!
    const encrypted = safeStorage.isEncryptionAvailable()
    const seal = (b: Uint8Array): string => (encrypted ? safeStorage.encryptString(toB64(b)).toString('base64') : toB64(b))
    s.identity = seal(this.identity!.secretKey)
    s.room = seal(this.secret!)
    s.encrypted = encrypted
    try {
      writeFileSync(this.file(), JSON.stringify(s, null, 2), { mode: 0o600 })
    } catch (err) {
      console.error('Cannot save companion state', err)
    }
  }

  private room(): string {
    return toB64(createHash('sha256').update(this.secret!).digest())
  }

  status(): CompanionStatus {
    const online = new Set([...this.conns.values()].filter((c) => c.verified && c.device).map((c) => c.device!.id))
    const devices = this.enabled || this.stored ? this.load().devices.map((d) => ({ ...d, online: online.has(d.id) })) : []
    const pairing = this.pairing && !this.pairing.used ? { kind: this.pairing.kind, uri: this.pairing.uri, qr: this.pairing.qr, expiresAt: this.pairing.expiresAt } : null
    const screen = this.screen && { device: this.screen.device.name, since: this.screen.since, control: !!this.screen.injector }
    return { enabled: this.enabled, kinds: { ...this.kinds }, state: this.state, error: this.error, relay: this.relay, devices, pairing, controlSupported: controlSupported(), request: this.request && { kind: this.request.kind, name: this.request.name, sas: this.request.sas }, screen }
  }

  private changed(): void {
    this.deps.changed(this.status())
  }

  /** Connects, reconnects or disconnects to match the settings: one relay connection serves phones and computers. */
  apply(kinds: Record<DeviceKind, boolean>, relay: string): void {
    const url = relay || DEFAULT_RELAY
    const enabled = kinds.phone || kinds.computer
    const was = this.kinds
    this.kinds = { ...kinds }
    if (enabled === this.enabled && url === this.relay) {
      // Still connected for the other kind: only the devices of the kind switched off go.
      for (const kind of ['phone', 'computer'] as const) if (was[kind] && !kinds[kind]) this.dropKind(kind)
      return this.changed()
    }
    this.disconnect()
    this.enabled = enabled
    this.relay = url
    this.error = null
    this.backoff = 1000
    if (enabled) {
      this.load()
      if (!url) {
        this.state = 'offline'
        this.error = t('companion.noRelay')
      } else this.connect()
    } else {
      this.state = 'off'
      this.pairing = null
      this.request = null
    }
    this.changed()
  }

  private connect(): void {
    this.state = 'connecting'
    let ws: WebSocket
    try {
      ws = new WebSocket(roomUrl(this.relay, this.room(), 'host'))
    } catch (err) {
      this.state = 'offline'
      this.error = describe(err)
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', secret: toB64(this.secret!) } satisfies RelayControl))
    ws.onmessage = (e) => {
      if (ws !== this.ws) return
      if (typeof e.data === 'string') this.control(e.data)
      else void this.received(new Uint8Array(e.data as ArrayBuffer))
    }
    ws.onclose = (e) => {
      if (ws !== this.ws) return
      this.ws = null
      this.dropAll()
      this.state = 'offline'
      // 4001: this computer connected again elsewhere (a second aFinder with the same data) – do not fight.
      if (e.code === 4003 || e.code === 4001) this.error = t('companion.refused')
      else {
        this.error = this.error ?? (e.reason || null)
        this.retry = setTimeout(() => this.connect(), this.backoff)
        this.backoff = Math.min(this.backoff * 2, 60_000)
      }
      this.changed()
    }
    ws.onerror = () => {
      this.error = t('companion.unreachable')
    }
    this.changed()
  }

  private disconnect(): void {
    this.endScreen('stopped')
    if (this.retry) clearTimeout(this.retry)
    if (this.ping) clearInterval(this.ping)
    this.retry = this.ping = null
    const ws = this.ws
    this.ws = null
    this.dropAll()
    ws?.close(1000)
  }

  stop(): void {
    this.disconnect()
  }

  private control(text: string): void {
    if (text === 'pong') return
    let msg: RelayControl
    try {
      msg = JSON.parse(text) as RelayControl
    } catch {
      return
    }
    if (msg.t === 'ready') {
      this.state = 'online'
      this.error = null
      this.backoff = 1000
      if (this.ping) clearInterval(this.ping)
      // Keeps NAT mappings and proxies from dropping an idle connection; the relay answers without waking.
      this.ping = setInterval(() => this.ws?.readyState === WebSocket.OPEN && this.ws.send('ping'), PING_MS)
      this.changed()
    } else if (msg.t === 'open') {
      this.conns.set(msg.c, { c: msg.c, session: null, device: null, verified: false, streams: new Map() })
    } else if (msg.t === 'close') {
      this.drop(msg.c)
    } else if (msg.t === 'ice') {
      const waiters = this.iceWaiters
      this.iceWaiters = []
      for (const w of waiters) w(Array.isArray(msg.servers) ? msg.servers : [])
    }
  }

  private raw(c: number, payload: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(withConnection(c, payload))
  }

  private refuse(c: number, reason: RejectReason): void {
    this.raw(c, reject(reason))
    this.ws?.send(JSON.stringify({ t: 'close', c } satisfies RelayControl))
    this.drop(c)
  }

  private send(conn: Conn, frame: Uint8Array): void {
    if (conn.session) this.raw(conn.c, message(Kind.HostData, conn.session.send.seal(frame)))
  }

  private json(conn: Conn, m: RpcMessage): void {
    this.send(conn, jsonFrame(m))
  }

  private drop(c: number): void {
    const conn = this.conns.get(c)
    this.conns.delete(c)
    if (this.request?.c === c) this.request = null
    if (!conn) return
    if (this.screen?.conn === conn) this.endScreen('stopped')
    for (const sid of conn.streams.keys()) void this.closeStream(conn, sid)
    if (conn.verified) this.changed()
  }

  private dropAll(): void {
    for (const c of [...this.conns.keys()]) this.drop(c)
  }

  private async received(data: Uint8Array): Promise<void> {
    if (data.length < 5) return
    const { c, payload } = splitConnection(data)
    let conn = this.conns.get(c)
    if (!conn) this.conns.set(c, (conn = { c, session: null, device: null, verified: false, streams: new Map() }))
    const body = payload.subarray(1)
    switch (payload[0]) {
      case Kind.Hello:
        return this.hello(conn, body)
      case Kind.Pair:
        return this.paired(conn, body)
      case Kind.Data: {
        if (!conn.session) return this.refuse(c, 'bad-message')
        let plain: Uint8Array
        try {
          plain = conn.session.receive.open(body)
        } catch {
          return this.refuse(c, 'bad-message')
        }
        if (!conn.verified) {
          conn.verified = true
          conn.device!.lastSeen = Date.now()
          this.save()
          this.changed()
        }
        return this.frame(conn, plain)
      }
      default:
        return this.refuse(c, 'bad-message')
    }
  }

  /** A kind was switched off: its sessions end and its pairing is withdrawn. */
  private dropKind(kind: DeviceKind): void {
    if (this.screen?.device.kind === kind) this.endScreen('stopped')
    if (this.request?.kind === kind) this.cancelPair()
    if (this.pairing?.kind === kind) this.pairing = null
    for (const conn of [...this.conns.values()]) if (conn.device?.kind === kind) this.refuse(conn.c, 'unknown-device')
  }

  private hello(conn: Conn, body: Uint8Array): void {
    if (conn.session) return this.refuse(conn.c, 'bad-message')
    const accepted = helloAccept(this.identity!, body)
    if (!accepted) return this.refuse(conn.c, 'bad-message')
    const id = toB64(accepted.phoneKey)
    const device = this.load().devices.find((d) => d.id === id)
    if (!device || !this.kinds[device.kind]) return this.refuse(conn.c, 'unknown-device')
    const { session, message: welcome } = accepted.welcome(utf8(JSON.stringify(this.info(device))))
    conn.session = session
    conn.device = device
    this.raw(conn.c, message(Kind.Welcome, welcome))
  }

  private info(device: Device): HostInfo {
    return { name: computerName(), platform: process.platform, home: os.homedir(), write: device.write, screen: device.screen, control: device.control && controlSupported(), version: app.getVersion() }
  }

  // ── Pairing ───────────────────────────────────────────────────────────────────────────────────

  async pair(kind: DeviceKind): Promise<CompanionStatus> {
    if (!this.kinds[kind] || !this.relay) throw new Error(t('companion.noRelay'))
    this.load()
    const code = new Uint8Array(randomBytes(16))
    const uri = pairingUri({ relay: this.relay, room: this.room(), key: this.identity!.publicKey, code, name: computerName() })
    // The QR library is only needed while pairing.
    const QRCode = await import('qrcode')
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
    this.pairing = { kind, code, uri, qr, expiresAt: Date.now() + PAIRING_MS, used: false }
    this.request = null
    const pairing = this.pairing
    setTimeout(() => {
      if (this.pairing === pairing) {
        this.pairing = null
        this.changed()
      }
    }, PAIRING_MS)
    this.changed()
    return this.status()
  }

  cancelPair(): void {
    if (this.request) this.raw(this.request.c, message(Kind.Paired, this.request.answer(false)))
    this.pairing = null
    this.request = null
    this.changed()
  }

  private paired(conn: Conn, body: Uint8Array): void {
    const p = this.pairing
    if (!p || p.used || Date.now() > p.expiresAt) return this.refuse(conn.c, 'pairing-closed')
    const got = pairAccept(this.identity!, p.code, body)
    // A wrong code burns the QR code too: whoever tries must not get a second guess.
    p.used = true
    // A phone scanning the computers' link (or the other way round) would land in the wrong list.
    if (!got || got.request.kind !== p.kind) {
      this.pairing = null
      this.changed()
      return this.refuse(conn.c, 'pairing-closed')
    }
    this.request = { c: conn.c, kind: got.request.kind, name: got.request.name, sas: got.sas, key: got.request.key, answer: got.answer }
    this.changed()
  }

  answer(accept: boolean): void {
    const r = this.request
    if (!r) return
    this.request = null
    this.pairing = null
    if (accept) {
      const s = this.load()
      const id = toB64(r.key)
      s.devices = [...s.devices.filter((d) => d.id !== id), { id, name: r.name, kind: r.kind, pairedAt: Date.now(), lastSeen: null, write: false, screen: false, control: false }]
      this.save()
    }
    this.raw(r.c, message(Kind.Paired, r.answer(accept)))
    this.changed()
  }

  setWrite(id: string, write: boolean): void {
    const d = this.load().devices.find((x) => x.id === id)
    if (!d) return
    d.write = write === true
    this.save()
    this.changed()
  }

  setScreen(id: string, screen: boolean): void {
    const d = this.load().devices.find((x) => x.id === id)
    if (!d) return
    d.screen = screen === true
    // Control is part of watching: without the screen it goes too.
    if (!d.screen) d.control = false
    this.save()
    // Taking the permission back ends what is running at once.
    if (!d.screen && this.screen?.device.id === id) this.endScreen('revoked')
    this.changed()
  }

  setControl(id: string, control: boolean): void {
    const d = this.load().devices.find((x) => x.id === id)
    if (!d) return
    // The phone app only watches; control is for other computers.
    d.control = control === true && d.kind === 'computer' && controlSupported()
    this.save()
    // macOS asks for the Accessibility permission now, while the user is at this computer, not when nobody is.
    if (d.control && process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true)
    if (!d.control && this.screen?.device.id === id && this.screen.injector) this.endScreen('revoked')
    this.changed()
  }

  /** Forgets the device and ends its open sessions. */
  remove(id: string): void {
    if (this.screen?.device.id === id) this.endScreen('revoked')
    const s = this.load()
    s.devices = s.devices.filter((d) => d.id !== id)
    this.save()
    for (const conn of [...this.conns.values()]) if (conn.device?.id === id) this.refuse(conn.c, 'unknown-device')
    this.changed()
  }

  // ── RPC ───────────────────────────────────────────────────────────────────────────────────────

  private frame(conn: Conn, plain: Uint8Array): void {
    let decoded
    try {
      decoded = decodeFrame(plain)
    } catch {
      return this.refuse(conn.c, 'bad-message')
    }
    if ('sid' in decoded) return this.chunk(conn, decoded.sid, decoded.data)
    const m = decoded.json
    if ('s' in m) return this.streamControl(conn, m)
    if ('m' in m) void this.call(conn, m.id, m.m, m.p)
  }

  private async call(conn: Conn, id: number, method: Method, params: unknown): Promise<void> {
    try {
      if (!METHODS.includes(method)) throw new Error(t('companion.unknownCall'))
      const computer = conn.device!.kind === 'computer'
      if (WRITE_METHODS.has(method) && !conn.device!.write) throw new Error(t(computer ? 'computers.readOnly' : 'companion.readOnly'))
      if (SCREEN_METHODS.has(method) && !conn.device!.screen) throw new Error(t(computer ? 'computers.screenNotAllowed' : 'companion.screenNotAllowed'))
      if (CONTROL_METHODS.has(method) && !(conn.device!.control && controlSupported())) throw new Error(t('companion.controlNotAllowed'))
      const p = (params ?? {}) as Record<string, unknown>
      const v = await this.run(conn, method, p)
      this.json(conn, { id, ok: true, v })
    } catch (err) {
      this.json(conn, { id, ok: false, e: describe(err) })
    }
  }

  private track<T>(conn: Conn, input: ActivityInput, work: () => Promise<T>, result?: (v: T) => Partial<ActivityInput>): Promise<T> {
    return this.deps.activity.track({ ...input, label: conn.device!.name }, work, result)
  }

  private async run(conn: Conn, method: Method, p: Record<string, unknown>): Promise<RpcMethods[Method][1]> {
    switch (method) {
      case 'info':
        return this.info(conn.device!)
      case 'places':
        return (await files.places()).map(({ name, path, icon }) => ({ name, path, icon }))
      case 'list': {
        const l = await files.list(String(p.path))
        const loc = await vfs.locate(l.path)
        return {
          path: l.path,
          parent: l.parent,
          readOnly: !!l.readOnly || loc.kind === 'archive' || loc.kind === 'mounts',
          entries: l.entries.map((e) => ({ name: e.name, path: e.path, dir: e.isDir, hidden: e.hidden, size: e.size, modified: e.modified, kind: e.kind }))
        }
      }
      case 'thumbnail':
        return thumbnail(p.path, typeof p.size === 'number' ? p.size : 256)
      case 'stat':
        return this.stat(files.validatePath(p.path))
      case 'download':
        return this.download(conn, p)
      case 'upload':
        return this.upload(conn, p)
      case 'replace':
        return this.replace(conn, p)
      case 'mkdir': {
        const parent = await this.localFolder(p.parent)
        const name = files.validateName(p.name)
        const full = path.join(parent, name)
        return this.track(conn, { action: 'create', folder: parent, paths: [full], count: 1 }, async () => (await fs.mkdir(full), full))
      }
      case 'rename': {
        const from = files.validatePath(p.path)
        return this.track(conn, { action: 'rename', folder: path.dirname(from), paths: [from] }, () => files.rename(from, String(p.name)), (to) => ({ destinations: [to] }))
      }
      case 'move': {
        const from = files.validatePath(p.path)
        if ((await vfs.locate(from)).kind !== 'local') throw new Error(t('companion.localOnly'))
        const dir = await this.localFolder(p.dir)
        const to = path.join(dir, path.basename(from))
        if (await fs.lstat(to).then(() => true, () => false)) throw Object.assign(new Error(), { code: 'EEXIST' })
        return this.track(conn, { action: 'move', folder: path.dirname(from), paths: [from] }, async () => (await fs.rename(from, to), to), (to) => ({ destinations: [to] }))
      }
      case 'clipboardRead':
        return await clipboard.readText()
      case 'clipboardWrite':
        await clipboard.writeText(String(p.text ?? '').slice(0, 1_000_000))
        return null
      case 'screenDisplays':
        return (await import('./screenCapture')).displays()
      case 'screenStart':
        return this.screenStart(conn, p)
      case 'screenSignal':
        return this.screenSignal(conn, p)
      case 'screenStop': {
        if (this.screen?.conn === conn && this.screen.id === p.session) this.endScreen('stopped', false)
        return null
      }
      case 'trash': {
        const paths = Array.isArray(p.paths) ? p.paths.slice(0, 1000).map(files.validatePath) : []
        // Remote servers would need a confirmation dialog on the computer; the phone works with local files only.
        for (const x of paths) if ((await vfs.locate(x)).kind !== 'local') throw new Error(t('companion.localOnly'))
        await this.track(conn, { action: 'trash', paths }, () => files.trash(paths, null))
        return null
      }
    }
  }

  // ── Screen ────────────────────────────────────────────────────────────────────────────────────

  /** No confirmation on this computer: a device with the screen permission may watch whenever it wants
   * (unattended access), and the banner in every aFinder window shows that it does. */
  private async screenStart(conn: Conn, p: Record<string, unknown>): Promise<RpcMethods['screenStart'][1]> {
    if (this.screen) throw new Error(t('companion.screenBusy'))
    const { displays, ScreenCapture } = await import('./screenCapture')
    const list = displays()
    const display = list.find((d) => d.id === p.display) ?? list.find((d) => d.primary) ?? list[0]
    if (!display) throw new Error(t('companion.screenFailed'))
    // No check of the Screen Recording permission here: macOS reports "denied" until it was first asked,
    // and it asks only when something captures. A refusal ends the session with `permission`.
    const device = conn.device!
    const rest = Math.max(0, this.relayRestUntil - Date.now())
    const turn = rest ? [] : await this.iceServers()
    const control = p.control === true && device.control ? await this.startInjector(display.id) : null
    // The device may have gone, or another session started, while TURN and the helper were awaited.
    if (!this.conns.has(conn.c) || !device.screen || this.screen) {
      control?.injector?.stop()
      throw new Error(t('companion.screenBusy'))
    }
    const injector = control?.injector ?? null
    const id = randomBytes(4).readUInt32BE(0)
    const session: ScreenSession = {
      id,
      conn,
      device,
      capture: null,
      injector,
      since: Date.now(),
      lastPing: Date.now(),
      answered: false,
      // Silent viewers end it; so does a capture that never starts (a system prompt left unanswered).
      timer: setInterval(() => {
        const silent = Date.now() - session.lastPing > SCREEN_SILENCE_MS
        if (silent && session.answered) this.endScreen('timeout')
        else if (!session.answered && Date.now() - session.since > SCREEN_START_MS) this.endScreen('failed')
      }, 5000),
      token: this.deps.activity.begin()
    }
    // AFINDER_ICE_LOCAL: viewer and computer on one machine (smoke tests). With STUN, macOS refuses UDP to its
    // own LAN address there and the input never arrives; host candidates alone connect.
    const iceServers = process.env.AFINDER_ICE_LOCAL ? [] : [STUN, ...turn]
    session.capture = new ScreenCapture(display.id, iceServers, !!injector, {
      candidate: (candidate) => this.json(conn, { ev: 'screen', session: id, candidate }),
      ended: (reason, detail) => this.screen === session && this.endScreen(detail === 'unreachable' ? 'unreachable' : reason),
      relayed: () => this.screen === session && this.screenRelayed(session),
      input: (raw) => {
        if (this.screen !== session) return
        session.lastPing = Date.now()
        session.injector?.input(raw)
      }
    })
    if (injector) injector.onExit = () => this.screen === session && this.endScreen('failed')
    this.screen = session
    this.deps.activity.record({ action: 'screen', outcome: 'started', label: device.name })
    this.changed()
    return { session: id, iceServers, ...(rest && { cooldownMs: rest }), ...(p.control === true && { control: !!injector }), ...(control?.error && { controlError: control.error }) }
  }

  /** The input helper for the monitor, or why control is not possible. */
  private async startInjector(display: string): Promise<{ injector?: InputInjector; error?: ControlError }> {
    if (!controlSupported()) return { error: 'unavailable' }
    // A helper named by AFINDER_INPUT_HELPER (smoke tests) reports its own permission.
    if (process.platform === 'darwin' && !process.env.AFINDER_INPUT_HELPER && !systemPreferences.isTrustedAccessibilityClient(false)) return { error: 'accessibility' }
    const { InputInjector } = await import('./inputInjector')
    try {
      return { injector: await InputInjector.start(display) }
    } catch (err) {
      return { error: (err as Error).message === 'permission' ? 'accessibility' : 'failed' }
    }
  }

  /** TURN credentials from the relay (only the room's owner gets them); none when it has no TURN key. */
  private iceServers(): Promise<IceServer[]> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve([])
    return new Promise((resolve) => {
      const done = (servers: IceServer[]): void => {
        clearTimeout(timer)
        resolve(servers)
      }
      const timer = setTimeout(() => {
        this.iceWaiters = this.iceWaiters.filter((w) => w !== done)
        resolve([])
      }, ICE_WAIT_MS)
      this.iceWaiters.push(done)
      this.ws!.send(JSON.stringify({ t: 'ice' } satisfies RelayControl))
    })
  }

  private async screenSignal(conn: Conn, p: Record<string, unknown>): Promise<RpcMethods['screenSignal'][1]> {
    const s = this.screen
    if (!s || s.conn !== conn || s.id !== p.session || !s.capture) throw new Error(t('companion.screenEnded'))
    s.lastPing = Date.now()
    const signal = (p.signal ?? {}) as Record<string, unknown>
    if (typeof signal.offer === 'string' && signal.offer.length < 100_000) {
      const sdp = await s.capture.accept(signal.offer)
      s.answered = true
      s.lastPing = Date.now()
      return { sdp }
    }
    const { isCandidate } = await import('./screenCapture')
    if (isCandidate(signal.candidate)) s.capture.candidate(signal.candidate)
    return null
  }

  /** The video goes through the TURN server: the session gets its time limit, and the phone shows it. */
  private screenRelayed(s: ScreenSession): void {
    if (s.relayTimer) return
    s.relayTimer = setTimeout(() => {
      this.relayRestUntil = Date.now() + RELAY_COOLDOWN_MS
      this.endScreen('limit')
    }, RELAY_LIMIT_MS)
    this.json(s.conn, { ev: 'screen', session: s.id, relay: { ms: RELAY_LIMIT_MS, cooldownMs: RELAY_COOLDOWN_MS } })
  }

  /** Ends the running session from aFinder (the Stop button). */
  stopScreen(): void {
    this.endScreen('stopped')
  }

  private endScreen(reason: ScreenEnd, tell = true): void {
    const s = this.screen
    if (!s) return
    this.screen = null
    clearInterval(s.timer)
    clearTimeout(s.relayTimer)
    s.injector?.stop()
    s.capture?.end(reason)
    if (tell) this.json(s.conn, { ev: 'screen', session: s.id, end: reason })
    this.deps.activity.record({ action: 'screen', outcome: reason === 'stopped' || reason === 'timeout' || reason === 'limit' ? 'success' : 'failed', label: s.device.name }, s.token)
    this.changed()
  }

  private async localFolder(p: unknown): Promise<string> {
    const dir = files.validatePath(p)
    if ((await vfs.locate(dir)).kind !== 'local') throw new Error(t('companion.localOnly'))
    if (!(await fs.stat(dir)).isDirectory()) throw new Error(t('error.notDir'))
    return dir
  }

  private sid(conn: Conn, v: unknown): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff || conn.streams.has(v)) throw new Error(t('companion.unknownCall'))
    return v
  }

  /** Local files ask the disk; archives and remote servers answer from their listing, without downloading. */
  private async stat(p: string): Promise<RpcMethods['stat'][1]> {
    if ((await vfs.locate(p)).kind === 'local') {
      const info = await fs.stat(p)
      return { size: info.isDirectory() ? 0 : info.size, modified: Math.floor(info.mtimeMs), dir: info.isDirectory() }
    }
    const e = (await files.list(path.dirname(p))).entries.find((x) => x.path === p)
    if (!e) throw Object.assign(new Error(), { code: 'ENOENT' })
    return { size: e.size ?? 0, modified: Math.floor(e.modified), dir: e.isDir }
  }

  private async download(conn: Conn, p: Record<string, unknown>): Promise<RpcMethods['download'][1]> {
    const sid = this.sid(conn, p.sid)
    const real = await vfs.realPath(files.validatePath(p.path), MAX_REMOTE_DOWNLOAD)
    const info: Stats = await fs.stat(real)
    if (!info.isFile()) throw new Error(t('companion.notAFile'))
    const offset = typeof p.offset === 'number' && Number.isInteger(p.offset) && p.offset > 0 ? Math.min(p.offset, info.size) : 0
    const file = await fs.open(real, 'r')
    conn.streams.set(sid, { kind: 'out', file, size: info.size, sent: offset, inflight: 0, pumping: false })
    // The answer must reach the phone before the first chunk.
    setImmediate(() => void this.pump(conn, sid))
    // Archives and remote files report the time of their listing, which is what the phone compares with.
    const modified = real === p.path ? Math.floor(info.mtimeMs) : ((await this.stat(String(p.path)).catch(() => null))?.modified ?? Math.floor(info.mtimeMs))
    return { name: path.basename(String(p.path)), size: info.size, modified }
  }

  /** Sends chunks until the window is full; acks from the phone call it again. */
  private async pump(conn: Conn, sid: number): Promise<void> {
    const s = conn.streams.get(sid)
    if (!s || s.kind !== 'out' || s.pumping) return
    s.pumping = true
    try {
      while (s.inflight < WINDOW && s.sent < s.size && conn.streams.get(sid) === s) {
        s.inflight++
        const buf = new Uint8Array(Math.min(CHUNK_BYTES, s.size - s.sent))
        const { bytesRead } = await s.file.read(buf, 0, buf.length, s.sent)
        if (bytesRead === 0) throw new Error(t('companion.changedWhileReading'))
        s.sent += bytesRead
        this.send(conn, chunkFrame(sid, buf.subarray(0, bytesRead)))
      }
      if (s.sent >= s.size && conn.streams.get(sid) === s) {
        this.json(conn, { s: sid, end: true })
        await this.closeStream(conn, sid)
      }
    } catch (err) {
      this.json(conn, { s: sid, err: describe(err) })
      await this.closeStream(conn, sid)
    } finally {
      s.pumping = false
    }
  }

  private async upload(conn: Conn, p: Record<string, unknown>): Promise<RpcMethods['upload'][1]> {
    const sid = this.sid(conn, p.sid)
    const dir = await this.localFolder(p.dir)
    const name = files.validateName(p.name)
    const size = typeof p.size === 'number' && Number.isInteger(p.size) && p.size >= 0 ? p.size : -1
    if (size < 0) throw new Error(t('companion.unknownCall'))
    const target = await files.freeName(dir, name)
    // Written under a hidden name and renamed at the end, so a broken transfer never looks like a file.
    const temp = path.join(dir, `.${name}.afinder-upload-${randomBytes(4).toString('hex')}`)
    const file = await fs.open(temp, 'wx')
    conn.streams.set(sid, { kind: 'in', file, temp, target, size, received: 0, queue: Promise.resolve(), failed: null })
    return { path: target }
  }

  private async replace(conn: Conn, p: Record<string, unknown>): Promise<RpcMethods['replace'][1]> {
    const sid = this.sid(conn, p.sid)
    const target = files.validatePath(p.path)
    if ((await vfs.locate(target)).kind !== 'local') throw new Error(t('companion.localOnly'))
    const size = typeof p.size === 'number' && Number.isInteger(p.size) && p.size >= 0 ? p.size : -1
    if (size < 0) throw new Error(t('companion.unknownCall'))
    const b = p.base as Partial<FileVersion> | undefined
    const base = b && typeof b.size === 'number' && typeof b.modified === 'number' ? { size: b.size, modified: b.modified } : undefined
    const info = await fs.stat(target)
    if (!info.isFile()) throw new Error(t('companion.notAFile'))
    // Checked now so the phone does not send a whole file for nothing, and again before the rename.
    if (base && !sameVersion(base, { size: info.size, modified: info.mtimeMs })) throw new Error(CONFLICT)
    const dir = path.dirname(target)
    const temp = path.join(dir, `.${path.basename(target)}.afinder-upload-${randomBytes(4).toString('hex')}`)
    const file = await fs.open(temp, 'wx')
    conn.streams.set(sid, { kind: 'in', file, temp, target, size, received: 0, queue: Promise.resolve(), failed: null, replace: { base, mode: info.mode } })
    return { path: target }
  }

  private chunk(conn: Conn, sid: number, data: Uint8Array): void {
    const s = conn.streams.get(sid)
    if (!s || s.kind !== 'in') return
    s.received += data.length
    if (s.received > s.size) s.failed = t('companion.tooMuchData')
    const copy = data.slice()
    s.queue = s.queue.then(async () => {
      if (s.failed) return
      try {
        await s.file.write(copy)
        this.json(conn, { s: sid, ack: 1 })
      } catch (err) {
        s.failed = describe(err)
      }
    })
  }

  private streamControl(conn: Conn, m: Extract<RpcMessage, { s: number }>): void {
    const s = conn.streams.get(m.s)
    if (!s) return
    if (m.cancel) return void this.closeStream(conn, m.s)
    if (s.kind === 'out' && typeof m.ack === 'number') {
      s.inflight = Math.max(0, s.inflight - m.ack)
      void this.pump(conn, m.s)
    } else if (s.kind === 'in' && m.end) {
      void s.queue.then(() => this.finishUpload(conn, m.s, s))
    }
  }

  private async finishUpload(conn: Conn, sid: number, s: Incoming): Promise<void> {
    try {
      if (s.failed) throw new Error(s.failed)
      if (s.received !== s.size) throw new Error(t('companion.incomplete'))
      await s.file.close()
      if (s.replace) {
        const r = s.replace
        await this.track(conn, { action: 'edit', folder: path.dirname(s.target), paths: [s.target], count: 1 }, async () => {
          const now = await fs.stat(s.target).catch(() => null)
          if (r.base && (!now || !sameVersion(r.base, { size: now.size, modified: now.mtimeMs }))) throw new Error(CONFLICT)
          await fs.chmod(s.temp, r.mode & 0o7777).catch(() => {})
          await fs.rename(s.temp, s.target)
        })
        conn.streams.delete(sid)
        return this.json(conn, { s: sid, end: true, path: s.target })
      }
      const target = await this.track(conn, { action: 'create', folder: path.dirname(s.target), count: 1 }, async () => {
        // Someone may have created a file of that name meanwhile.
        const final = await files.freeName(path.dirname(s.target), path.basename(s.target))
        await fs.rename(s.temp, final)
        return final
      }, (final) => ({ paths: [final] }))
      conn.streams.delete(sid)
      this.json(conn, { s: sid, end: true, path: target })
    } catch (err) {
      this.json(conn, { s: sid, err: describe(err) })
      await this.closeStream(conn, sid)
    }
  }

  private async closeStream(conn: Conn, sid: number): Promise<void> {
    const s = conn.streams.get(sid)
    if (!s) return
    conn.streams.delete(sid)
    await s.file.close().catch(() => {})
    if (s.kind === 'in') await fs.rm(s.temp, { force: true }).catch(() => {})
  }
}
