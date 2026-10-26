// Wire format of the phone companion, shared by aFinder (host), the relay and the mobile app.
//
// Relay ⇄ peers (plain, the relay must read it):
//   client: binary = opaque payload for the host;  text "ping" → "pong" (answered without waking the relay)
//   host:   binary = [connection id u32][payload], both ways;  text = RelayControl JSON
// Payloads (first byte = kind):
//   phone → host: HELLO, PAIR, DATA (encrypted)      host → phone: WELCOME, PAIRED, DATA, REJECT
// Inside DATA, after decryption: FRAME_JSON (RpcMessage) or FRAME_CHUNK ([stream u32][bytes]).

import { concat, fromB64, fromUtf8, readU32, toB64, u32, utf8 } from './bytes'

export const PROTOCOL_VERSION = 1
/** The relay aFinder uses unless the settings name another one (mobile/relay, deployed with wrangler). */
export const DEFAULT_RELAY = 'wss://afinder-relay.danielhromadka1.workers.dev'

export const Kind = { Hello: 0x01, Pair: 0x02, Data: 0x03, Welcome: 0x11, Paired: 0x12, HostData: 0x13, Reject: 0x1f } as const
export type Kind = (typeof Kind)[keyof typeof Kind]

const Frame = { Json: 0x01, Chunk: 0x02 } as const

/** Why the host refused a phone; sent in plain text with Kind.Reject. */
export type RejectReason = 'unknown-device' | 'pairing-closed' | 'bad-message' | 'version'

/** File data travels in chunks this big; one relay message stays far below the Workers limit. */
export const CHUNK_BYTES = 256 * 1024
/** Chunks a sender may have in flight before the receiver acknowledges them. */
export const WINDOW = 16
export const MAX_MESSAGE_BYTES = CHUNK_BYTES + 1024

/** Messages between the relay and the host connection (text frames). */
export type RelayControl =
  | { t: 'auth'; secret: string }
  | { t: 'ready' }
  | { t: 'open'; c: number }
  | { t: 'close'; c: number }
  | { t: 'host'; online: boolean }
  /** Host asks for ICE servers (STUN + short-lived TURN credentials) for a screen session; the relay
   * answers with the same type. An empty list means the relay has no TURN configured. */
  | { t: 'ice'; servers?: IceServer[] }

/** WebRTC ICE server, as RTCPeerConnection takes it. */
export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}
/** Always offered; TURN from the relay comes on top for networks where direct connections fail. */
export const STUN: IceServer = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }

export const ROOM_RE = /^[A-Za-z0-9_-]{43}$/
/** The room is the hash of the host's secret, so only the host can claim it and nothing is stored. */
export async function roomOf(secret: Uint8Array, sha256: (b: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<string> {
  return toB64(await sha256(secret))
}

export const roomUrl = (relay: string, room: string, role: 'host' | 'client'): string => `${relay.replace(/\/+$/, '')}/v1/room/${room}?role=${role}`

export const withConnection = (c: number, payload: Uint8Array): Uint8Array => concat(u32(c), payload)
export const splitConnection = (data: Uint8Array): { c: number; payload: Uint8Array } => ({ c: readU32(data), payload: data.subarray(4) })

export const message = (kind: Kind, body: Uint8Array = new Uint8Array()): Uint8Array => concat(Uint8Array.of(kind), body)
export const reject = (reason: RejectReason): Uint8Array => message(Kind.Reject, utf8(reason))

// ── Pairing link (QR code) ─────────────────────────────────────────────────────────────────────

export interface PairingLink {
  relay: string
  room: string
  /** Host public key. */
  key: Uint8Array
  /** One-time code. */
  code: Uint8Array
  /** Computer name, shown on the phone. */
  name: string
}

export const pairingUri = (p: PairingLink): string =>
  `afinder://pair?v=${PROTOCOL_VERSION}&relay=${encodeURIComponent(p.relay)}&room=${p.room}&key=${toB64(p.key)}&code=${toB64(p.code)}&name=${encodeURIComponent(p.name)}`

/** Null for anything that is not a pairing link of this version. */
export function parsePairingUri(uri: string): PairingLink | null {
  const m = /^afinder:\/\/pair\?(.*)$/.exec(uri.trim())
  if (!m) return null
  const q = new Map(
    m[1].split('&').map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i), kv.slice(i + 1)] as [string, string]
    })
  )
  try {
    const relay = decodeURIComponent(q.get('relay') ?? '')
    const room = q.get('room') ?? ''
    const key = fromB64(q.get('key') ?? '')
    const code = fromB64(q.get('code') ?? '')
    if (q.get('v') !== String(PROTOCOL_VERSION) || !/^wss?:\/\/[^\s]+$/.test(relay) || !ROOM_RE.test(room) || key.length !== 32 || code.length !== 16) return null
    return { relay, room, key, code, name: decodeURIComponent(q.get('name') ?? '').slice(0, 64) }
  } catch {
    return null
  }
}

// ── RPC inside the encrypted session ───────────────────────────────────────────────────────────

export interface RemoteEntry {
  name: string
  path: string
  dir: boolean
  hidden: boolean
  /** Bytes; null for folders. */
  size: number | null
  modified: number
  kind: string
}

/** Identifies one state of a file; `modified` is whole milliseconds. */
export interface FileVersion {
  size: number
  modified: number
}
export const sameVersion = (a: FileVersion, b: FileVersion): boolean => a.size === b.size && Math.floor(a.modified) === Math.floor(b.modified)
/** Error text of a `replace` whose file changed on the computer meanwhile. */
export const CONFLICT = 'conflict'

export interface HostInfo {
  name: string
  platform: string
  home: string
  /** This phone may change files. */
  write: boolean
  /** This device may view the screen (no confirmation on the computer: the permission is the consent). */
  screen?: boolean
  /** This device may also control the mouse and keyboard while it views the screen. */
  control?: boolean
  version: string
}

/** Every call the phone can make, with its parameters and result. */
export interface RpcMethods {
  info: [Record<string, never>, HostInfo]
  places: [Record<string, never>, { name: string; path: string; icon: string }[]]
  list: [{ path: string }, { path: string; parent: string | null; entries: RemoteEntry[]; readOnly: boolean }]
  /** A PNG data URL, or null when the computer has no thumbnail for the file. */
  thumbnail: [{ path: string; size: number }, string | null]
  /** Size and modification time, so the phone can tell whether its cached copy is still current. */
  stat: [{ path: string }, FileVersion & { dir: boolean }]
  /** Starts sending the file as stream `sid`, from byte `offset` (resuming a broken transfer) to the end. */
  download: [{ path: string; sid: number; offset?: number }, { name: string } & FileVersion]
  /** Prepares to receive a file of `size` bytes as stream `sid`; returns where it will be saved. */
  upload: [{ dir: string; name: string; size: number; sid: number }, { path: string }]
  /** Receives new contents for an existing file as stream `sid`. With `base`, the file must still be that
   * version when the transfer ends, otherwise it fails with CONFLICT and nothing is overwritten. */
  replace: [{ path: string; size: number; sid: number; base?: FileVersion }, { path: string }]
  mkdir: [{ parent: string; name: string }, string]
  /** The computer's monitors, for choosing which one to watch. */
  screenDisplays: [Record<string, never>, ScreenDisplay[]]
  /** Starts watching a monitor. `cooldownMs`: the time through the TURN server is used up, so only a direct
   * connection is tried. With `control` asked for, `control` in the answer says whether input is accepted
   * (on a data channel named INPUT_CHANNEL the viewer opens), or `controlError` why not. */
  screenStart: [{ display?: string; control?: boolean }, { session: number; iceServers: IceServer[]; cooldownMs?: number; control?: boolean; controlError?: ControlError }]
  /** WebRTC signalling: the phone's offer (answered with the computer's answer), ICE candidates, and a
   * heartbeat (`ping`) that keeps the session alive while the phone shows it. */
  screenSignal: [{ session: number; signal: ScreenSignal }, { sdp: string } | null]
  screenStop: [{ session: number }, null]
  rename: [{ path: string; name: string }, string]
  /** Moves a file or folder into another folder on the computer; returns its new path. */
  move: [{ path: string; dir: string }, string]
  trash: [{ paths: string[] }, null]
  /** Text on the computer's clipboard (control permission). */
  clipboardRead: [Record<string, never>, string]
  clipboardWrite: [{ text: string }, null]
}
/** Why a session runs without control: macOS has not allowed aFinder to control the computer
 * (Accessibility), this build cannot (Mac App Store sandbox), or the input helper failed. */
export type ControlError = 'accessibility' | 'unavailable' | 'failed'
/** The viewer opens this data channel for mouse and keyboard; the computer reads only it. */
export const INPUT_CHANNEL = 'input'
/** The computer sends this on the input channel once it listens: messages that arrive before the page has
 * taken the channel are lost, so the viewer sends nothing until then. */
export const INPUT_READY = 'ready'
export interface ScreenDisplay {
  id: string
  name: string
  width: number
  height: number
  primary: boolean
}

export type ScreenSignal = { offer: string } | { candidate: IceCandidate } | { ping: true }
export interface IceCandidate {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
}
/** Why a screen session ended, sent to the phone in a `screen` event. */
/** `permission`: the computer may not record its screen; `revoked`: this phone lost the permission;
 * `limit`: the time allowed through the TURN server ran out. */
export type ScreenEnd = 'stopped' | 'refused' | 'busy' | 'timeout' | 'permission' | 'revoked' | 'unreachable' | 'failed' | 'limit'

export type Method = keyof RpcMethods
export const METHODS: readonly Method[] = ['info', 'places', 'list', 'thumbnail', 'stat', 'download', 'upload', 'replace', 'mkdir', 'rename', 'move', 'trash', 'screenDisplays', 'screenStart', 'screenSignal', 'screenStop', 'clipboardRead', 'clipboardWrite']
export const WRITE_METHODS: ReadonlySet<Method> = new Set<Method>(['upload', 'replace', 'mkdir', 'rename', 'move', 'trash'])
/** Calls that need the "may control" permission. */
export const CONTROL_METHODS: ReadonlySet<Method> = new Set<Method>(['clipboardRead', 'clipboardWrite'])
/** Calls that need the separate "may view the screen" permission. */
export const SCREEN_METHODS: ReadonlySet<Method> = new Set<Method>(['screenDisplays', 'screenStart', 'screenSignal', 'screenStop'])

export type RpcMessage =
  | { id: number; m: Method; p: unknown }
  | { id: number; ok: true; v: unknown }
  | { id: number; ok: false; e: string }
  /** Stream control: the receiver consumed `ack` more chunks; the sender finished (`end`, with the saved
   * path for uploads) or failed (`err`); either side gave up (`cancel`). */
  | { s: number; ack?: number; end?: true; path?: string; err?: string; cancel?: true }
  /** Pushed by the computer: an ICE candidate of a screen session, or its end. Older phones ignore it. */
  | ScreenEvent

export interface ScreenEvent {
  ev: 'screen'
  session: number
  candidate?: IceCandidate
  end?: ScreenEnd
  /** The video goes through the TURN server: it ends after `ms`, and the server is then unavailable for `cooldownMs`. */
  relay?: { ms: number; cooldownMs: number }
}

export const jsonFrame = (m: RpcMessage): Uint8Array => concat(Uint8Array.of(Frame.Json), utf8(JSON.stringify(m)))
export const chunkFrame = (sid: number, data: Uint8Array): Uint8Array => concat(Uint8Array.of(Frame.Chunk), u32(sid), data)

export type Decoded = { json: RpcMessage } | { sid: number; data: Uint8Array }
export function decodeFrame(plain: Uint8Array): Decoded {
  if (plain[0] === Frame.Json) return { json: JSON.parse(fromUtf8(plain.subarray(1))) as RpcMessage }
  if (plain[0] === Frame.Chunk && plain.length >= 5) return { sid: readU32(plain, 1), data: plain.subarray(5) }
  throw new Error('Unknown frame')
}
