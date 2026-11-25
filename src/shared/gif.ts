// An animated GIF encoder small enough to keep: one palette for the whole animation (median cut over
// sampled pixels), a 32×32×32 lookup from colour to palette index, and the GIF variant of LZW. Used to
// turn a stretch of video into a GIF; pure, so the tests decode what it writes.

/** Which stretch of a video becomes a GIF, how wide, at what frame rate. */
export interface GifOptions {
  /** Seconds. */
  start: number
  length: number
  width: number
  fps: number
}

export const DEFAULT_GIF: GifOptions = { start: 0, length: 5, width: 480, fps: 12 }

/** Up to `size` colours (RGB triplets) that represent the sampled pixels, by median cut. */
export function medianCut(rgb: Uint8Array, size = 256): Uint8Array {
  type Box = number[] // pixel offsets into rgb
  const all: Box = []
  for (let i = 0; i + 2 < rgb.length; i += 3) all.push(i)
  if (all.length === 0) return new Uint8Array(3)
  const boxes: Box[] = [all]
  const range = (box: Box): [number, number] => {
    let best = 0
    let channel = 0
    for (let c = 0; c < 3; c++) {
      let lo = 255
      let hi = 0
      for (const i of box) {
        const v = rgb[i + c]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (hi - lo > best) {
        best = hi - lo
        channel = c
      }
    }
    return [best, channel]
  }
  while (boxes.length < size) {
    // Split the box with the widest colour range along that channel, at the median.
    let pick = -1
    let pickRange = 0
    let pickChannel = 0
    for (let b = 0; b < boxes.length; b++) {
      if (boxes[b].length < 2) continue
      const [r, c] = range(boxes[b])
      if (r > pickRange) {
        pickRange = r
        pick = b
        pickChannel = c
      }
    }
    if (pick < 0) break
    const box = boxes[pick].sort((a, b) => rgb[a + pickChannel] - rgb[b + pickChannel])
    const mid = box.length >> 1
    boxes.splice(pick, 1, box.slice(0, mid), box.slice(mid))
  }
  const out = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, b) => {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (const i of box) sum += rgb[i + c]
      out[b * 3 + c] = Math.round(sum / box.length)
    }
  })
  return out
}

/** Palette index for every 15-bit colour (5 bits per channel), nearest by squared distance. */
export function paletteLookup(palette: Uint8Array): Uint8Array {
  const n = palette.length / 3
  const table = new Uint8Array(32 * 32 * 32)
  for (let r = 0; r < 32; r++)
    for (let g = 0; g < 32; g++)
      for (let b = 0; b < 32; b++) {
        const R = (r << 3) | 4
        const G = (g << 3) | 4
        const B = (b << 3) | 4
        let best = 0
        let dist = Infinity
        for (let i = 0; i < n; i++) {
          const dr = palette[i * 3] - R
          const dg = palette[i * 3 + 1] - G
          const db = palette[i * 3 + 2] - B
          const d = dr * dr + dg * dg + db * db
          if (d < dist) {
            dist = d
            best = i
          }
        }
        table[(r << 10) | (g << 5) | b] = best
      }
  return table
}

/** RGBA pixels to palette indices through the lookup. */
export function indexPixels(rgba: Uint8ClampedArray | Uint8Array, lookup: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2)
  for (let p = 0, i = 0; i < rgba.length; i += 4, p++) out[p] = lookup[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)]
  return out
}

/** Every `step`-th pixel as RGB, for building the palette from many frames at little cost. */
export function samplePixels(rgba: Uint8ClampedArray | Uint8Array, step: number): Uint8Array {
  const n = Math.floor(rgba.length / 4 / step)
  const out = new Uint8Array(n * 3)
  for (let k = 0; k < n; k++) {
    const i = k * step * 4
    out.set([rgba[i], rgba[i + 1], rgba[i + 2]], k * 3)
  }
  return out
}

/** LZW as GIF wants it: variable code size from minCodeSize + 1 up to 12 bits, packed LSB first. */
export function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize
  const end = clear + 1
  const out: number[] = []
  let bits = 0
  let acc = 0
  let size = minCodeSize + 1
  const emit = (code: number): void => {
    acc |= code << bits
    bits += size
    while (bits >= 8) {
      out.push(acc & 0xff)
      acc >>>= 8
      bits -= 8
    }
  }
  let dict = new Map<number, number>()
  let next = end + 1
  emit(clear)
  if (indices.length === 0) {
    emit(end)
    if (bits) out.push(acc & 0xff)
    return Uint8Array.from(out)
  }
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = (prefix << 8) | k
    const found = dict.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    if (next < 4096) {
      dict.set(key, next++)
      if (next > 1 << size && size < 12) size++
    } else {
      emit(clear)
      dict = new Map()
      next = end + 1
      size = minCodeSize + 1
    }
    prefix = k
  }
  emit(prefix)
  emit(end)
  if (bits) out.push(acc & 0xff)
  return Uint8Array.from(out)
}

/** A looping animated GIF from palette-indexed frames of the same size; delay in hundredths of a second. */
export function encodeGif(frames: Uint8Array[], width: number, height: number, palette: Uint8Array, delayCs: number): Uint8Array {
  // The colour table holds 2^(n+1) entries.
  let tableBits = 1
  while (1 << tableBits < palette.length / 3) tableBits++
  const table = new Uint8Array(3 << tableBits)
  table.set(palette.subarray(0, table.length))
  const minCode = Math.max(2, tableBits)
  const parts: Uint8Array[] = []
  const bytes = (...b: number[]): void => void parts.push(Uint8Array.from(b))
  const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
  bytes(...[...'GIF89a'].map((c) => c.charCodeAt(0)), ...u16(width), ...u16(height), 0x80 | ((tableBits - 1) << 4) | (tableBits - 1), 0, 0)
  parts.push(table)
  // NETSCAPE2.0: loop forever.
  bytes(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0)
  for (const frame of frames) {
    bytes(0x21, 0xf9, 4, 0, ...u16(Math.max(2, Math.round(delayCs))), 0, 0)
    bytes(0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0, minCode)
    const data = lzw(frame, minCode)
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255)
      bytes(block.length)
      parts.push(block)
    }
    bytes(0)
  }
  bytes(0x3b)
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
