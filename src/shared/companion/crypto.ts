// End-to-end encryption between aFinder (the host) and a paired phone. The relay in between only ever
// sees these bytes, so everything that matters is decided here:
// - identities are static X25519 keys, exchanged once by pairing (QR code + one-time code + SAS check);
// - every connection runs a Noise-IK-like handshake with fresh ephemeral keys (forward secrecy);
// - frames are XChaCha20-Poly1305 with a per-direction counter as nonce, so replayed, dropped or
//   reordered frames fail to decrypt and end the session.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { concat, equalBytes, fromUtf8, readU32, utf8 } from './bytes'

export const KEY_BYTES = 32
const TAG_BYTES = 16

export interface KeyPair {
  secretKey: Uint8Array
  publicKey: Uint8Array
}

export const newKeyPair = (): KeyPair => {
  const { secretKey, publicKey } = x25519.keygen()
  return { secretKey, publicKey }
}
export const keyPairOf = (secretKey: Uint8Array): KeyPair => ({ secretKey, publicKey: x25519.getPublicKey(secretKey) })
export const random = (n: number): Uint8Array => randomBytes(n)

const dh = (secret: Uint8Array, pub: Uint8Array): Uint8Array => {
  if (pub.length !== KEY_BYTES) throw new Error('Invalid key')
  return x25519.getSharedSecret(secret, pub)
}
const derive = (ikm: Uint8Array, salt: Uint8Array, info: string, n: number): Uint8Array => hkdf(sha256, ikm, salt, utf8(info), n)
const ZERO_NONCE = new Uint8Array(24)
/** For keys used for exactly one message: a zero nonce is safe. */
const sealOnce = (key: Uint8Array, data: Uint8Array): Uint8Array => xchacha20poly1305(key, ZERO_NONCE).encrypt(data)
const openOnce = (key: Uint8Array, data: Uint8Array): Uint8Array => xchacha20poly1305(key, ZERO_NONCE).decrypt(data)

/** One direction of a session. The nonce is the frame counter, which the receiver expects in order. */
export class Cipher {
  private counter = 0
  constructor(private readonly key: Uint8Array) {}
  private nonce(): Uint8Array {
    const n = new Uint8Array(24)
    let c = this.counter++
    for (let i = 16; i < 24; i++, c = Math.floor(c / 256)) n[i] = c % 256
    return n
  }
  seal(data: Uint8Array): Uint8Array {
    return xchacha20poly1305(this.key, this.nonce()).encrypt(data)
  }
  /** Throws on a forged, replayed, dropped or reordered frame; the session is then unusable. */
  open(data: Uint8Array): Uint8Array {
    return xchacha20poly1305(this.key, this.nonce()).decrypt(data)
  }
}

export interface Session {
  send: Cipher
  receive: Cipher
}

// ── Pairing ─────────────────────────────────────────────────────────────────────────────────────
// The QR code carries the host key and a one-time code. The phone proves it saw the code and sends its
// own key; both screens show a 6-digit SAS derived from everything, which the user compares before
// confirming on the computer.

/** What paired: the phone app, or aFinder on another computer (sent from 1.x; older apps say nothing: a phone). */
export type DeviceKind = 'phone' | 'computer'

export interface PairRequest {
  /** The phone's static public key. */
  key: Uint8Array
  name: string
  kind: DeviceKind
}

interface PairKeys {
  request: Uint8Array
  response: Uint8Array
  ikm: Uint8Array
  salt: Uint8Array
}

function pairKeys(shared: Uint8Array, code: Uint8Array, hostKey: Uint8Array, ephemeral: Uint8Array): PairKeys {
  const ikm = concat(shared, code)
  const salt = sha256(concat(utf8('afinder-pair-v1'), hostKey, ephemeral))
  const k = derive(ikm, salt, 'pair', 64)
  return { request: k.slice(0, 32), response: k.slice(32), ikm, salt }
}

const sasOf = (keys: PairKeys, phoneKey: Uint8Array): string =>
  String(readU32(derive(concat(keys.ikm, phoneKey), keys.salt, 'sas', 4)) % 1_000_000).padStart(6, '0')

/** Phone side: the pairing message, the SAS to show, and a reader for the host's answer. */
export function pairStart(phone: KeyPair, name: string, hostKey: Uint8Array, code: Uint8Array, kind: DeviceKind = 'phone'): { message: Uint8Array; sas: string; answer(data: Uint8Array): boolean } {
  const e = newKeyPair()
  const keys = pairKeys(dh(e.secretKey, hostKey), code, hostKey, e.publicKey)
  const body = utf8(JSON.stringify({ name: name.slice(0, 64), kind }))
  return {
    message: concat(e.publicKey, sealOnce(keys.request, concat(phone.publicKey, body))),
    sas: sasOf(keys, phone.publicKey),
    answer: (data) => openOnce(keys.response, data)[0] === 1
  }
}

/** Host side: reads a pairing message; null when it was not made with this code (wrong or stale QR). */
export function pairAccept(host: KeyPair, code: Uint8Array, message: Uint8Array): { request: PairRequest; sas: string; answer(ok: boolean): Uint8Array } | null {
  if (message.length < KEY_BYTES + KEY_BYTES + TAG_BYTES) return null
  const ephemeral = message.slice(0, KEY_BYTES)
  try {
    const keys = pairKeys(dh(host.secretKey, ephemeral), code, host.publicKey, ephemeral)
    const plain = openOnce(keys.request, message.slice(KEY_BYTES))
    const key = plain.slice(0, KEY_BYTES)
    const { name, kind } = JSON.parse(fromUtf8(plain.slice(KEY_BYTES))) as { name?: unknown; kind?: unknown }
    const clean = typeof name === 'string' ? name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64) : ''
    return {
      request: { key, name: clean || 'Phone', kind: kind === 'computer' ? 'computer' : 'phone' },
      sas: sasOf(keys, key),
      answer: (ok) => sealOnce(keys.response, Uint8Array.of(ok ? 1 : 0))
    }
  } catch {
    return null
  }
}

// ── Session handshake ───────────────────────────────────────────────────────────────────────────
// hello  (phone → host): e_c, seal(k0, s_c)          k0 from DH(e_c, S_h): only the real host can read who calls
// welcome (host → phone): e_h, first frame of the session
// Session keys mix DH(e_c,e_h), DH(e_c,S_h) and DH(s_c,e_h): the host is proven by its first frame, the
// phone by its first frame, and recorded traffic stays secret even if the static keys leak later.

const helloKey = (shared: Uint8Array, hostKey: Uint8Array, ephemeral: Uint8Array): Uint8Array =>
  derive(shared, sha256(concat(utf8('afinder-hello-v1'), hostKey, ephemeral)), 'hello', 32)

function sessionKeys(ee: Uint8Array, es: Uint8Array, se: Uint8Array, transcript: Uint8Array): { phoneToHost: Uint8Array; hostToPhone: Uint8Array } {
  const k = derive(concat(ee, es, se), sha256(concat(utf8('afinder-session-v1'), transcript)), 'session', 64)
  return { phoneToHost: k.slice(0, 32), hostToPhone: k.slice(32) }
}

/** Phone side: the hello message and a function that completes the session from the host's welcome. */
export function helloStart(phone: KeyPair, hostKey: Uint8Array): { message: Uint8Array; finish(welcome: Uint8Array): { session: Session; first: Uint8Array } } {
  const e = newKeyPair()
  const sealed = sealOnce(helloKey(dh(e.secretKey, hostKey), hostKey, e.publicKey), phone.publicKey)
  return {
    message: concat(e.publicKey, sealed),
    finish(welcome) {
      if (welcome.length < KEY_BYTES + TAG_BYTES) throw new Error('Invalid welcome')
      const eh = welcome.slice(0, KEY_BYTES)
      const keys = sessionKeys(dh(e.secretKey, eh), dh(e.secretKey, hostKey), dh(phone.secretKey, eh), concat(hostKey, e.publicKey, sealed, eh))
      const session = { send: new Cipher(keys.phoneToHost), receive: new Cipher(keys.hostToPhone) }
      return { session, first: session.receive.open(welcome.slice(KEY_BYTES)) }
    }
  }
}

/**
 * Host side: who is calling (null if the hello is malformed), and a function that, once the caller is
 * known to be paired, creates the session and the welcome carrying `first` as its first frame.
 */
export function helloAccept(host: KeyPair, message: Uint8Array): { phoneKey: Uint8Array; welcome(first: Uint8Array): { session: Session; message: Uint8Array } } | null {
  if (message.length !== KEY_BYTES + KEY_BYTES + TAG_BYTES) return null
  const ec = message.slice(0, KEY_BYTES)
  const sealed = message.slice(KEY_BYTES)
  try {
    const phoneKey = openOnce(helloKey(dh(host.secretKey, ec), host.publicKey, ec), sealed)
    return {
      phoneKey,
      welcome(first) {
        const e = newKeyPair()
        const keys = sessionKeys(dh(e.secretKey, ec), dh(host.secretKey, ec), dh(e.secretKey, phoneKey), concat(host.publicKey, ec, sealed, e.publicKey))
        const session = { send: new Cipher(keys.hostToPhone), receive: new Cipher(keys.phoneToHost) }
        return { session, message: concat(e.publicKey, session.send.seal(first)) }
      }
    }
  } catch {
    return null
  }
}

export const sameKey = equalBytes
