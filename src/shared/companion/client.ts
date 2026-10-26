// The client side of the companion protocol: pairing and an encrypted RPC session with one computer through
// the relay, used by the phone and by aFinder connecting to another aFinder. Uses only WebSocket and the
// shared protocol code, so it runs the same in React Native, Electron's main process and Node (smoke tests).

import { fromB64, fromUtf8, toB64 } from './bytes'
import { helloStart, pairStart, type DeviceKind, type KeyPair, type Session } from './crypto'
import {
  CHUNK_BYTES,
  Kind,
  WINDOW,
  chunkFrame,
  decodeFrame,
  jsonFrame,
  message,
  roomUrl,
  type FileVersion,
  type HostInfo,
  type Method,
  type PairingLink,
  type RejectReason,
  type RelayControl,
  type RpcMessage,
  type RpcMethods,
  type ScreenEvent
} from './protocol'

/** A paired computer as the phone remembers it. */
export interface Computer {
  /** The room; unique per computer. */
  id: string
  relay: string
  /** Host public key, base64url. */
  key: string
  name: string
}

export const computerOf = (link: PairingLink): Computer => ({ id: link.room, relay: link.relay, key: toB64(link.key), name: link.name })

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly reason?: RejectReason
  ) {
    super(message)
  }
}

const PING_MS = 25_000

function open(url: string): WebSocket {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  return ws
}

const bytesOf = (data: unknown): Uint8Array | null => (data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null)
const control = (data: unknown): RelayControl | null => {
  if (typeof data !== 'string' || data === 'pong') return null
  try {
    return JSON.parse(data) as RelayControl
  } catch {
    return null
  }
}

/**
 * Pairs with the computer of a scanned QR code. `onCode` gets the 6-digit code to show while the user
 * confirms on the computer; resolves when the computer accepted, rejects when it declined or failed.
 */
export function pair(link: PairingLink, identity: KeyPair, deviceName: string, onCode: (sas: string) => void, signal?: AbortSignal, kind?: DeviceKind): Promise<Computer> {
  return new Promise((resolve, reject) => {
    const ws = open(roomUrl(link.relay, link.room, 'client'))
    let start: ReturnType<typeof pairStart> | null = null
    const fail = (err: Error): void => {
      ws.close()
      reject(err)
    }
    signal?.addEventListener('abort', () => fail(new RemoteError('cancelled')))
    ws.onmessage = (e) => {
      const msg = control(e.data)
      if (msg?.t === 'host' && msg.online && !start) {
        start = pairStart(identity, deviceName, link.key, link.code, kind)
        ws.send(message(Kind.Pair, start.message))
        onCode(start.sas)
      }
      const data = bytesOf(e.data)
      if (!data) return
      if (data[0] === Kind.Reject) return fail(new RemoteError(fromUtf8(data.subarray(1)), fromUtf8(data.subarray(1)) as RejectReason))
      if (data[0] === Kind.Paired && start) {
        try {
          if (!start.answer(data.subarray(1))) return fail(new RemoteError('declined'))
        } catch {
          return fail(new RemoteError('bad-message', 'bad-message'))
        }
        ws.close()
        resolve(computerOf(link))
      }
    }
    ws.onerror = () => fail(new RemoteError('unreachable'))
    ws.onclose = (e) => {
      if (e.code === 4002) reject(new RemoteError('pairing-closed', 'pairing-closed'))
    }
  })
}

export type HostState =
  | { kind: 'connecting' }
  /** The relay is reachable but aFinder on the computer is not running. */
  | { kind: 'offline' }
  | { kind: 'ready'; info: HostInfo }
  /** The computer refused this phone (unpaired) – reconnecting will not help. */
  | { kind: 'refused'; reason: RejectReason | string }

type Reader = (offset: number, length: number) => Promise<Uint8Array>

interface Pending {
  resolve(v: unknown): void
  reject(e: Error): void
}

interface Download {
  kind: 'down'
  write(data: Uint8Array): Promise<void>
  done(err?: Error): void
  received: number
  queue: Promise<void>
}
interface Upload {
  kind: 'up'
  inflight: number
  more(): void
  done(err?: Error, path?: string): void
}

/** A connection to one paired computer that reconnects on its own until closed. */
export class HostClient {
  private ws: WebSocket | null = null
  private session: Session | null = null
  private hello: ReturnType<typeof helloStart> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private streams = new Map<number, Download | Upload>()
  private listeners = new Set<(s: HostState) => void>()
  private screenListeners = new Set<(e: ScreenEvent) => void>()
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private backoff = 1000
  state: HostState = { kind: 'connecting' }

  constructor(
    readonly computer: Computer,
    private readonly identity: KeyPair
  ) {
    this.connect()
  }

  subscribe(fn: (s: HostState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(state: HostState): void {
    this.state = state
    for (const fn of this.listeners) fn(state)
  }

  private connect(): void {
    if (this.closed) return
    const ws = open(roomUrl(this.computer.relay, this.computer.id, 'client'))
    this.ws = ws
    ws.onmessage = (e) => ws === this.ws && this.received(e.data)
    ws.onclose = () => {
      if (ws !== this.ws) return
      this.reset(new RemoteError('disconnected'))
      if (this.closed || this.state.kind === 'refused') return
      this.set({ kind: 'connecting' })
      this.retry = setTimeout(() => this.connect(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, 30_000)
    }
    if (this.ping) clearInterval(this.ping)
    this.ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), PING_MS)
  }

  /** Reconnects now (the app came to the foreground, the user pulled to refresh …). */
  wake(): void {
    if (this.closed || this.state.kind === 'refused') return
    if (this.ws && this.ws.readyState <= 1) return
    if (this.retry) clearTimeout(this.retry)
    this.backoff = 1000
    this.connect()
  }

  close(): void {
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    if (this.ping) clearInterval(this.ping)
    this.ws?.close()
    this.reset(new RemoteError('closed'))
  }

  private reset(err: Error): void {
    this.session = null
    this.hello = null
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    for (const s of this.streams.values()) s.done(err)
    this.streams.clear()
  }

  private received(data: unknown): void {
    const msg = control(data)
    if (msg?.t === 'host') {
      if (msg.online && !this.session && !this.hello) {
        this.hello = helloStart(this.identity, fromB64(this.computer.key))
        this.ws?.send(message(Kind.Hello, this.hello.message))
      } else if (!msg.online) {
        this.reset(new RemoteError('offline'))
        this.set({ kind: 'offline' })
      }
      return
    }
    const bytes = bytesOf(data)
    if (!bytes || bytes.length === 0) return
    const body = bytes.subarray(1)
    if (bytes[0] === Kind.Reject) {
      const reason = fromUtf8(body)
      this.set({ kind: 'refused', reason })
      this.ws?.close()
      return
    }
    if (bytes[0] === Kind.Welcome && this.hello) {
      try {
        const { session, first } = this.hello.finish(body)
        this.session = session
        this.hello = null
        this.backoff = 1000
        this.set({ kind: 'ready', info: JSON.parse(fromUtf8(first)) as HostInfo })
      } catch {
        // Not our computer (or a forged answer): never talk to it.
        this.set({ kind: 'refused', reason: 'bad-message' })
        this.ws?.close()
      }
      return
    }
    if (bytes[0] === Kind.HostData && this.session) {
      let plain: Uint8Array
      try {
        plain = this.session.receive.open(body)
      } catch {
        this.ws?.close()
        return
      }
      const decoded = decodeFrame(plain)
      if ('sid' in decoded) return this.chunk(decoded.sid, decoded.data)
      this.message(decoded.json)
    }
  }

  private post(frame: Uint8Array): void {
    if (!this.session || this.ws?.readyState !== 1) throw new RemoteError('offline')
    this.ws.send(message(Kind.Data, this.session.send.seal(frame)))
  }

  /** Candidates and the end of a screen session, pushed by the computer. */
  onScreen(fn: (e: ScreenEvent) => void): () => void {
    this.screenListeners.add(fn)
    return () => this.screenListeners.delete(fn)
  }

  private message(m: RpcMessage): void {
    if ('ev' in m) {
      if (m.ev === 'screen') for (const fn of this.screenListeners) fn(m)
      return
    }
    if ('s' in m) return this.streamControl(m)
    if (!('ok' in m)) return
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.ok) p.resolve(m.v)
    else p.reject(new RemoteError(m.e))
  }

  call<M extends Method>(method: M, params: RpcMethods[M][0]): Promise<RpcMethods[M][1]> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      try {
        this.post(jsonFrame({ id, m: method, p: params }))
      } catch (err) {
        return reject(err as Error)
      }
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    })
  }

  /**
   * Receives a file, from byte `offset` when resuming. `write` gets the chunks in order; the next ones
   * are acknowledged only after it finished, so a slow phone throttles the computer instead of buffering.
   */
  async download(path: string, write: (data: Uint8Array) => Promise<void>, progress?: (received: number, size: number) => void, offset = 0, signal?: AbortSignal): Promise<{ name: string } & FileVersion> {
    const sid = this.nextId++
    let size = 0
    const finished = new Promise<void>((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        if (!this.streams.delete(sid)) return
        try {
          this.post(jsonFrame({ s: sid, cancel: true }))
        } catch {
          // offline anyway
        }
        reject(new RemoteError('cancelled'))
      })
      const s: Download = {
        kind: 'down',
        received: offset,
        queue: Promise.resolve(),
        write: async (data) => {
          await write(data)
          s.received += data.length
          progress?.(s.received, size)
        },
        done: (err) => (err ? reject(err) : resolve())
      }
      this.streams.set(sid, s)
    })
    try {
      const meta = await this.call('download', offset ? { path, sid, offset } : { path, sid })
      size = meta.size
      // A cancel sent before the computer opened the file found no stream there: repeat it.
      if (signal?.aborted) this.post(jsonFrame({ s: sid, cancel: true }))
      progress?.(offset, size)
      await finished
      return meta
    } catch (err) {
      this.streams.delete(sid)
      throw err
    }
  }

  /** Sends a file of `size` bytes read by `read(offset, length)`; resolves with where it was saved. */
  upload(dir: string, name: string, size: number, read: Reader, progress?: (sent: number, size: number) => void): Promise<string> {
    return this.send(size, read, progress, (sid) => this.call('upload', { dir, name, size, sid }))
  }

  /** Overwrites `path` with new contents; fails with CONFLICT when it is no longer version `base`. */
  replace(path: string, size: number, read: Reader, base?: FileVersion, progress?: (sent: number, size: number) => void): Promise<string> {
    return this.send(size, read, progress, (sid) => this.call('replace', base ? { path, size, sid, base } : { path, size, sid }))
  }

  private async send(size: number, read: Reader, progress: ((sent: number, size: number) => void) | undefined, start: (sid: number) => Promise<unknown>): Promise<string> {
    const sid = this.nextId++
    let wake = (): void => {}
    let failed: Error | null = null
    const finished = new Promise<string>((resolve, reject) => {
      this.streams.set(sid, {
        kind: 'up',
        inflight: 0,
        more: () => wake(),
        done: (err, path) => {
          failed = err ?? null
          wake()
          if (err) reject(err)
          else resolve(path!)
        }
      })
    })
    finished.catch(() => {})
    try {
      await start(sid)
    } catch (err) {
      this.streams.delete(sid)
      throw err
    }
    const s = this.streams.get(sid) as Upload
    let sent = 0
    while (sent < size) {
      while (s.inflight >= WINDOW && !failed) await new Promise<void>((r) => (wake = r))
      if (failed) throw failed
      const data = await read(sent, Math.min(CHUNK_BYTES, size - sent))
      if (data.length === 0) throw new RemoteError('read')
      this.post(chunkFrame(sid, data))
      s.inflight++
      sent += data.length
      progress?.(sent, size)
    }
    this.post(jsonFrame({ s: sid, end: true }))
    return finished
  }

  private chunk(sid: number, data: Uint8Array): void {
    const s = this.streams.get(sid)
    if (!s || s.kind !== 'down') return
    const copy = data.slice()
    s.queue = s.queue.then(async () => {
      try {
        await s.write(copy)
        this.post(jsonFrame({ s: sid, ack: 1 }))
      } catch (err) {
        this.streams.delete(sid)
        try {
          this.post(jsonFrame({ s: sid, cancel: true }))
        } catch {
          // offline anyway
        }
        s.done(err as Error)
      }
    })
  }

  private streamControl(m: Extract<RpcMessage, { s: number }>): void {
    const s = this.streams.get(m.s)
    if (!s) return
    if (s.kind === 'up') {
      if (typeof m.ack === 'number') {
        s.inflight -= m.ack
        s.more()
      }
      if (m.end || m.err) {
        this.streams.delete(m.s)
        s.done(m.err ? new RemoteError(m.err) : undefined, m.path)
      }
      return
    }
    if (m.err) {
      this.streams.delete(m.s)
      s.done(new RemoteError(m.err))
    } else if (m.end) {
      // Chunks still being written finish first.
      void s.queue.then(() => {
        this.streams.delete(m.s)
        s.done()
      })
    }
  }
}
