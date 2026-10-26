import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { toB64 } from '../../../src/shared/companion/bytes'
import { splitConnection, withConnection, type RelayControl } from '../../../src/shared/companion/protocol'

type Received = string | Uint8Array

/** A test peer: its socket and everything it received, in order. */
async function connect(room: string, role: 'host' | 'client'): Promise<{ ws: WebSocket; next(): Promise<Received>; closed: Promise<number> }> {
  const res = await SELF.fetch(`https://relay.test/v1/room/${room}?role=${role}`, { headers: { Upgrade: 'websocket' } })
  const ws = res.webSocket
  if (!ws) throw new Error(`No WebSocket (${res.status})`)
  ws.accept()
  // Promises keep the order even though binary messages arrive as Blobs that are read asynchronously.
  const queue: Promise<Received>[] = []
  const waiting: ((m: Promise<Received>) => void)[] = []
  ws.addEventListener('message', (e) => {
    const m = Promise.resolve(typeof e.data === 'string' ? e.data : e.data instanceof Blob ? e.data.arrayBuffer().then((b) => new Uint8Array(b)) : new Uint8Array(e.data as ArrayBuffer))
    const w = waiting.shift()
    if (w) w(m)
    else queue.push(m)
  })
  const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)))
  return { ws, closed, next: () => (queue.length ? queue.shift()! : new Promise<Received>((resolve) => waiting.push((m) => void m.then(resolve)))) }
}

async function newRoom(): Promise<{ room: string; secret: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return { secret: toB64(bytes), room: toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) }
}
const json = (m: Received): RelayControl => JSON.parse(m as string) as RelayControl

describe('relay', () => {
  it('rejects bad routes and plain requests', async () => {
    expect((await SELF.fetch('https://relay.test/v1/room/short?role=host', { headers: { Upgrade: 'websocket' } })).status).toBe(404)
    const { room } = await newRoom()
    expect((await SELF.fetch(`https://relay.test/v1/room/${room}?role=host`)).status).toBe(426)
  })

  it('passes bytes between an authenticated host and a phone', async () => {
    const { room, secret } = await newRoom()
    const phone = await connect(room, 'client')
    expect(json(await phone.next())).toEqual({ t: 'host', online: false })
    const host = await connect(room, 'host')
    host.ws.send(JSON.stringify({ t: 'auth', secret }))
    expect(json(await host.next())).toEqual({ t: 'ready' })
    const open = json(await host.next()) as { t: 'open'; c: number }
    expect(open.t).toBe('open')
    expect(json(await phone.next())).toEqual({ t: 'host', online: true })

    phone.ws.send(Uint8Array.of(1, 2, 3))
    const got = splitConnection((await host.next()) as Uint8Array)
    expect(got.c).toBe(open.c)
    expect([...got.payload]).toEqual([1, 2, 3])
    host.ws.send(withConnection(open.c, Uint8Array.of(9)))
    expect([...((await phone.next()) as Uint8Array)]).toEqual([9])

    host.ws.close(1000)
    expect(json(await phone.next())).toEqual({ t: 'host', online: false })
  })

  it('does not let anyone else claim the room', async () => {
    const { room } = await newRoom()
    const fake = await connect(room, 'host')
    fake.ws.send(JSON.stringify({ t: 'auth', secret: 'guess' }))
    expect(await fake.closed).toBe(4003)
  })

  it('lets the host drop a phone, and tells it when a phone leaves', async () => {
    const { room, secret } = await newRoom()
    const host = await connect(room, 'host')
    host.ws.send(JSON.stringify({ t: 'auth', secret }))
    await host.next()
    const phone = await connect(room, 'client')
    const { c } = json(await host.next()) as { t: 'open'; c: number }
    host.ws.send(JSON.stringify({ t: 'close', c }))
    expect(await phone.closed).toBe(4002)
    expect(json(await host.next())).toEqual({ t: 'close', c })
  })

  it('answers ICE requests only for the authenticated host (no TURN key here: empty list)', async () => {
    const { room, secret } = await newRoom()
    const host = await connect(room, 'host')
    host.ws.send(JSON.stringify({ t: 'auth', secret }))
    expect(json(await host.next())).toEqual({ t: 'ready' })
    host.ws.send(JSON.stringify({ t: 'ice' }))
    expect(json(await host.next())).toEqual({ t: 'ice', servers: [] })
  })
})
