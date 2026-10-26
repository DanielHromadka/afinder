// Text encodings for the Encoding tool. Base64 works on UTF-8 bytes, so "Žluťoučký" round-trips.

export const ENCODINGS = ['base64', 'base64url', 'url', 'html', 'hex'] as const
export type Encoding = (typeof ENCODINGS)[number]

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=')
  }
  return out
}

function base64ToBytes(text: string): Uint8Array {
  const s = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) throw new Error('Not Base64')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let o = 0
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((B64.indexOf(s[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(s[i + 3] ?? 'A') & 63)
    out[o++] = (n >> 16) & 255
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255
    if (i + 3 < s.length) out[o++] = n & 255
  }
  return out.subarray(0, o)
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
/** Fatal: bytes that are not UTF-8 are an error, not replacement characters. */
const fromUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b)

const HTML_OUT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const HTML_IN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function encodeText(text: string, enc: Encoding): string {
  switch (enc) {
    case 'base64':
      return bytesToBase64(utf8(text))
    case 'base64url':
      return bytesToBase64(utf8(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    case 'url':
      return encodeURIComponent(text)
    case 'html':
      return text.replace(/[&<>"']/g, (c) => HTML_OUT[c])
    case 'hex':
      return [...utf8(text)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  }
}

export function decodeText(text: string, enc: Encoding): string {
  switch (enc) {
    case 'base64':
    case 'base64url':
      return fromUtf8(base64ToBytes(text))
    case 'url':
      return decodeURIComponent(text.replace(/\+/g, ' '))
    case 'html':
      return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        return HTML_IN[e.toLowerCase()] ?? m
      })
    case 'hex': {
      const clean = text.replace(/[\s:-]|0x/gi, '')
      if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new Error('Not hex')
      return fromUtf8(new Uint8Array(clean.match(/../g)?.map((h) => parseInt(h, 16)) ?? []))
    }
  }
}
