// Byte helpers that run unchanged in Electron, Hermes (React Native), Cloudflare Workers and vitest:
// no Buffer, atob or TextDecoder, which are not everywhere.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]))

/** URL-safe base64 without padding. */
export function toB64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64[n & 63]
  }
  return out
}

/** Throws on anything but URL-safe base64 (padding tolerated). */
export function fromB64(text: string): Uint8Array {
  const s = text.replace(/=+$/, '')
  if (s.length % 4 === 1) throw new Error('Invalid base64')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let bits = 0
  let value = 0
  let o = 0
  for (const c of s) {
    const v = B64_INDEX.get(c)
    if (v === undefined) throw new Error('Invalid base64')
    value = (value << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (value >> bits) & 255
    }
  }
  return out
}

export function utf8(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    let c = ch.codePointAt(0)!
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd // lone surrogate
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return Uint8Array.from(out)
}

/** Lenient decoder: malformed sequences become U+FFFD. */
export function fromUtf8(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]
    const need = b < 0x80 ? 0 : b >= 0xf0 && b < 0xf8 ? 3 : b >= 0xe0 ? 2 : b >= 0xc2 && b < 0xe0 ? 1 : -1
    if (need < 0 || i + need >= bytes.length) {
      out += '�'
      i++
      continue
    }
    let c = need === 0 ? b : b & (0x3f >> need)
    let ok = true
    for (let k = 1; k <= need; k++) {
      const n = bytes[i + k]
      if ((n & 0xc0) !== 0x80) ok = false
      c = (c << 6) | (n & 63)
    }
    if (!ok || (need === 2 && c < 0x800) || (need === 3 && (c < 0x10000 || c > 0x10ffff))) {
      out += '�'
      i++
      continue
    }
    out += String.fromCodePoint(c)
    i += need + 1
  }
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export const u32 = (n: number): Uint8Array => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
export const readU32 = (b: Uint8Array, at = 0): number => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

/** Constant-time comparison, for secrets. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}
