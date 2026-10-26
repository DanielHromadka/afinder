import { describe, expect, it } from 'vitest'
import { fromB64, fromUtf8, toB64, utf8 } from './bytes'
import { helloAccept, helloStart, newKeyPair, pairAccept, pairStart, random } from './crypto'
import { chunkFrame, decodeFrame, jsonFrame, pairingUri, parsePairingUri, sameVersion } from './protocol'

describe('companion bytes', () => {
  it('round-trips base64url and UTF-8 like the platform codecs', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const b = random(n)
      expect(toB64(b)).toBe(Buffer.from(b).toString('base64url'))
      expect(fromB64(toB64(b))).toEqual(b)
    }
    const text = 'Příliš žluťoučký kůň 🐎 ∑'
    expect(utf8(text)).toEqual(new Uint8Array(Buffer.from(text)))
    expect(fromUtf8(utf8(text))).toBe(text)
    expect(fromUtf8(Uint8Array.of(0x61, 0xc3))).toBe('a�')
    expect(() => fromB64('a+b/')).toThrow()
  })
})

describe('companion pairing', () => {
  const host = newKeyPair()
  const phone = newKeyPair()
  const code = random(16)

  it('accepts the phone key with matching SAS codes on both screens', () => {
    const start = pairStart(phone, 'iPhone', host.publicKey, code)
    const got = pairAccept(host, code, start.message)!
    expect(got.request.key).toEqual(phone.publicKey)
    expect(got.request.name).toBe('iPhone')
    expect(got.request.kind).toBe('phone')
    expect(got.sas).toMatch(/^\d{6}$/)
    expect(got.sas).toBe(start.sas)
    expect(start.answer(got.answer(true))).toBe(true)
    expect(start.answer(got.answer(false))).toBe(false)
  })

  it('tells another computer from a phone', () => {
    expect(pairAccept(host, code, pairStart(phone, 'Mac', host.publicKey, code, 'computer').message)!.request.kind).toBe('computer')
  })

  it('rejects a stale code or another computer', () => {
    expect(pairAccept(host, random(16), pairStart(phone, 'x', host.publicKey, code).message)).toBeNull()
    expect(pairAccept(host, code, pairStart(phone, 'x', newKeyPair().publicKey, code).message)).toBeNull()
  })

  it('parses only valid pairing links', () => {
    const link = { relay: 'wss://relay.example.com', room: toB64(random(32)), key: host.publicKey, code, name: 'Mac mini & co' }
    expect(parsePairingUri(pairingUri(link))).toEqual(link)
    expect(parsePairingUri('afinder://pair?v=2')).toBeNull()
    expect(parsePairingUri(pairingUri({ ...link, relay: 'http://x' }))).toBeNull()
    expect(parsePairingUri('https://example.com')).toBeNull()
  })
})

describe('companion session', () => {
  const host = newKeyPair()
  const phone = newKeyPair()

  const connect = () => {
    const hello = helloStart(phone, host.publicKey)
    const accepted = helloAccept(host, hello.message)!
    expect(accepted.phoneKey).toEqual(phone.publicKey)
    const h = accepted.welcome(utf8('hi'))
    const p = hello.finish(h.message)
    expect(fromUtf8(p.first)).toBe('hi')
    return { host: h.session, phone: p.session }
  }

  it('carries frames both ways in order', () => {
    const s = connect()
    for (let i = 0; i < 3; i++) {
      expect(fromUtf8(s.host.receive.open(s.phone.send.seal(utf8(`p${i}`))))).toBe(`p${i}`)
      expect(fromUtf8(s.phone.receive.open(s.host.send.seal(utf8(`h${i}`))))).toBe(`h${i}`)
    }
  })

  it('refuses replayed, reordered and tampered frames', () => {
    const s = connect()
    const a = s.phone.send.seal(utf8('a'))
    const b = s.phone.send.seal(utf8('b'))
    expect(() => s.host.receive.open(b)).toThrow()
    const t = connect()
    const c = t.phone.send.seal(utf8('c'))
    t.host.receive.open(c)
    expect(() => t.host.receive.open(c)).toThrow()
    const u = connect()
    const d = u.phone.send.seal(utf8('d'))
    d[d.length - 1] ^= 1
    expect(() => u.host.receive.open(d)).toThrow()
    expect(a.length).toBe(b.length)
  })

  it('does not let a phone without the paired secret key finish', () => {
    const impostor = newKeyPair()
    const hello = helloStart({ secretKey: impostor.secretKey, publicKey: phone.publicKey }, host.publicKey)
    const accepted = helloAccept(host, hello.message)!
    // The hello claims the paired key, but the session keys need its secret: the first frame fails.
    const h = accepted.welcome(utf8('hi'))
    expect(() => hello.finish(h.message)).toThrow()
  })

  it('does not let another computer answer as the host', () => {
    const hello = helloStart(phone, host.publicKey)
    expect(helloAccept(newKeyPair(), hello.message)).toBeNull()
  })

  it('encodes RPC and chunk frames', () => {
    expect(decodeFrame(jsonFrame({ id: 1, m: 'list', p: { path: '/' } }))).toEqual({ json: { id: 1, m: 'list', p: { path: '/' } } })
    expect(decodeFrame(chunkFrame(7, Uint8Array.of(1, 2)))).toEqual({ sid: 7, data: Uint8Array.of(1, 2) })
  })
})

describe('companion file versions', () => {
  it('compares size and whole milliseconds, so a cached copy survives fractional mtimes', () => {
    expect(sameVersion({ size: 3, modified: 1000.9 }, { size: 3, modified: 1000 })).toBe(true)
    expect(sameVersion({ size: 3, modified: 1000 }, { size: 4, modified: 1000 })).toBe(false)
    expect(sameVersion({ size: 3, modified: 1001 }, { size: 3, modified: 1000 })).toBe(false)
  })
})
