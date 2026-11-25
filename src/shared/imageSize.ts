// Pixel size of an image from its first bytes, without decoding it: JPEG (SOF marker), PNG (IHDR), GIF,
// WebP (VP8, VP8L, VP8X) and BMP. JPEGs turned by their EXIF orientation report the size as shown.

import { readExif } from './exif'

/** Enough for the header of every supported format (JPEG puts EXIF and thumbnails before the SOF). */
export const IMAGE_SIZE_BYTES = 256 * 1024

const be16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1]
const le16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8)
const le24 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
const le32 = (b: Uint8Array, at: number): number => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
const tag = (b: Uint8Array, at: number, s: string): boolean => [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && tag(b, 1, 'PNG') && tag(b, 12, 'IHDR')) {
    return ok((b[16] << 24) | (b[17] << 16) | be16(b, 18), (b[20] << 24) | (b[21] << 16) | be16(b, 22))
  }
  if (b.length >= 10 && tag(b, 0, 'GIF8')) return ok(le16(b, 6), le16(b, 8))
  if (b.length >= 26 && tag(b, 0, 'BM')) return ok(le32(b, 18), Math.abs(le32(b, 22) | 0))
  if (b.length >= 25 && tag(b, 0, 'RIFF') && tag(b, 8, 'WEBP')) {
    if (tag(b, 12, 'VP8X')) return ok(le24(b, 24) + 1, le24(b, 27) + 1)
    if (tag(b, 12, 'VP8L')) {
      const bits = le32(b, 21)
      return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (tag(b, 12, 'VP8 ')) return ok(le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff)
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) return null
      const marker = b[at + 1]
      if (marker === 0xff) {
        at++
        continue
      }
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const size = ok(be16(b, at + 7), be16(b, at + 5))
        const o = readExif(b)?.orientation ?? 1
        return size && o >= 5 && o <= 8 ? { width: size.height, height: size.width } : size
      }
      if (marker === 0xda || marker === 0xd9) return null
      at += 2 + be16(b, at + 2)
    }
  }
  return null
}

const ok = (width: number, height: number): { width: number; height: number } | null => (width > 0 && height > 0 ? { width, height } : null)
