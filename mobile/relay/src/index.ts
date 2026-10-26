// aFinder relay: passes bytes between one computer (the host) and its paired phones. Everything it
// forwards is end-to-end encrypted (src/shared/companion/crypto.ts), so it only needs to keep rooms
// apart and stop the host's room from being taken over. One Durable Object per room; with the
// WebSocket Hibernation API an idle room costs nothing while its connections stay open.

import { DurableObject } from 'cloudflare:workers'
import { fromB64, toB64 } from '../../../src/shared/companion/bytes'
import { MAX_MESSAGE_BYTES, ROOM_RE, splitConnection, withConnection, type IceServer, type RelayControl } from '../../../src/shared/companion/protocol'

export interface Env {
  ROOM: DurableObjectNamespace<Room>
  CONNECT_LIMIT?: RateLimit
  /** Cloudflare Realtime TURN key (wrangler secret put …). Without them screen sharing gets STUN only. */
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
}

/** Credentials outlive one viewing session comfortably but not by days. */
const TURN_TTL = 4 * 3600
/** One host may ask this often; each answer is reused meanwhile (it is the same computer). */
const TURN_EVERY_MS = 30_000

type Peer = { role: 'host'; room: string; authed: boolean } | { role: 'client'; c: number }

const MAX_CLIENTS = 16
const ROUTE = /^\/v1\/room\/([A-Za-z0-9_-]+)$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/') return new Response('aFinder relay\n')
    const room = ROUTE.exec(url.pathname)?.[1]
    if (!room || !ROOM_RE.test(room)) return new Response('Not found', { status: 404 })
    // Validated here so bad requests never reach (and bill) a Durable Object.
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 })
    const role = url.searchParams.get('role')
    if (role !== 'host' && role !== 'client') return new Response('Unknown role', { status: 400 })
    if (env.CONNECT_LIMIT) {
      const { success } = await env.CONNECT_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'local' })
      if (!success) return new Response('Too many connections', { status: 429 })
    }
    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request)
  }
} satisfies ExportedHandler<Env>

/** A peer may be closing at any moment; a lost message to it does not matter. */
const send = (ws: WebSocket | undefined, data: string | Uint8Array): void => {
  try {
    ws?.send(data)
  } catch {
    // closed meanwhile
  }
}
const control = (ws: WebSocket, msg: RelayControl): void => send(ws, JSON.stringify(msg))
const peerOf = (ws: WebSocket): Peer => ws.deserializeAttachment() as Peer

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Keep-alives are answered by the runtime and do not wake a hibernating room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const room = ROUTE.exec(url.pathname)![1]
    const [client, server] = Object.values(new WebSocketPair())
    if (url.searchParams.get('role') === 'host') {
      // Not trusted until it proves it owns the room with its first message.
      this.ctx.acceptWebSocket(server, ['host'])
      server.serializeAttachment({ role: 'host', room, authed: false } satisfies Peer)
    } else {
      if (this.ctx.getWebSockets('client').length >= MAX_CLIENTS) return new Response('Room is full', { status: 503 })
      const c = this.freeId()
      this.ctx.acceptWebSocket(server, ['client', `c:${c}`])
      server.serializeAttachment({ role: 'client', c } satisfies Peer)
      const host = this.host()
      control(server, { t: 'host', online: !!host })
      if (host) control(host, { t: 'open', c })
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const peer = peerOf(ws)
    const size = typeof message === 'string' ? message.length : message.byteLength
    if (size > MAX_MESSAGE_BYTES + 4) return ws.close(1009, 'Message too big')
    if (peer.role === 'client') {
      // Text from phones is only the keep-alive, answered above; everything else goes to the host.
      if (typeof message !== 'string') send(this.host(), withConnection(peer.c, new Uint8Array(message)))
      return
    }
    if (!peer.authed) return this.authenticate(ws, peer, message)
    if (typeof message !== 'string') {
      const { c, payload } = splitConnection(new Uint8Array(message))
      send(this.ctx.getWebSockets(`c:${c}`)[0], payload)
      return
    }
    let msg: RelayControl
    try {
      msg = JSON.parse(message) as RelayControl
    } catch {
      return
    }
    // The host drops a phone it does not know or that misbehaves.
    if (msg.t === 'close') this.ctx.getWebSockets(`c:${msg.c}`)[0]?.close(4002, 'Closed by the computer')
    // Only the authenticated owner of the room gets TURN credentials, so the TURN key cannot be abused.
    if (msg.t === 'ice') control(ws, { t: 'ice', servers: await this.iceServers() })
  }

  private turn: { at: number; servers: IceServer[] } | null = null

  private async iceServers(): Promise<IceServer[]> {
    const { TURN_KEY_ID: id, TURN_KEY_API_TOKEN: token } = this.env
    if (!id || !token) return []
    if (this.turn && Date.now() - this.turn.at < TURN_EVERY_MS) return this.turn.servers
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL })
      })
      if (!res.ok) return []
      const { iceServers } = (await res.json()) as { iceServers?: IceServer[] }
      this.turn = { at: Date.now(), servers: Array.isArray(iceServers) ? iceServers : [] }
      return this.turn.servers
    } catch {
      return []
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.gone(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.gone(ws)
  }

  private async authenticate(ws: WebSocket, peer: Extract<Peer, { role: 'host' }>, message: string | ArrayBuffer): Promise<void> {
    let secret = ''
    try {
      const msg = typeof message === 'string' ? (JSON.parse(message) as RelayControl) : null
      if (msg?.t === 'auth' && typeof msg.secret === 'string' && msg.secret.length < 100) secret = msg.secret
    } catch {
      // falls through to the refusal
    }
    // The room name is the hash of the host's secret: proving it needs no stored state.
    let hash = ''
    try {
      hash = toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', fromB64(secret))))
    } catch {
      // not base64: refused below
    }
    if (!secret || hash !== peer.room) return ws.close(4003, 'Not the owner of this room')
    // A newer connection of the same computer (after sleep, network change) replaces the old one.
    for (const other of this.ctx.getWebSockets('host')) if (other !== ws && (peerOf(other) as { authed?: boolean }).authed) other.close(4001, 'Replaced')
    ws.serializeAttachment({ ...peer, authed: true } satisfies Peer)
    control(ws, { t: 'ready' })
    for (const phone of this.ctx.getWebSockets('client')) {
      control(ws, { t: 'open', c: (peerOf(phone) as { c: number }).c })
      control(phone, { t: 'host', online: true })
    }
  }

  private gone(ws: WebSocket): void {
    const peer = peerOf(ws)
    if (peer.role === 'client') {
      const host = this.host(ws)
      if (host) control(host, { t: 'close', c: peer.c })
    } else if (peer.authed && !this.host(ws)) {
      for (const phone of this.ctx.getWebSockets('client')) control(phone, { t: 'host', online: false })
    }
  }

  /** The authenticated host connection, other than `except` (which is closing). */
  private host(except?: WebSocket): WebSocket | undefined {
    return this.ctx.getWebSockets('host').find((ws) => ws !== except && (peerOf(ws) as { authed?: boolean }).authed && ws.readyState === WebSocket.OPEN)
  }

  private freeId(): number {
    for (;;) {
      const c = crypto.getRandomValues(new Uint32Array(1))[0]
      if (this.ctx.getWebSockets(`c:${c}`).length === 0) return c
    }
  }
}
