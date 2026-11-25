// Photo metadata without a library: finds the EXIF block (TIFF) in JPEG, PNG, WebP and HEIC files, reads
// the fields aFinder shows (camera, date taken, exposure, location), and writes copies without the
// location or without any metadata. Pure byte work, shared by the renderer and the tests; every read is
// bounds-checked, so a damaged file gives fewer fields, never an exception.

import { extensionOf } from './preview'

export interface ExifData {
  make?: string
  model?: string
  lens?: string
  software?: string
  /** Date taken as written by the camera (local time, no zone): `YYYY-MM-DDTHH:MM:SS`. */
  taken?: string
  /** 1 = as stored; 2–8 the usual EXIF mirror / rotate values. */
  orientation?: number
  width?: number
  height?: number
  /** Seconds. */
  exposure?: number
  fNumber?: number
  iso?: number
  /** Millimetres; focal35 is the 35 mm equivalent. */
  focalLength?: number
  focal35?: number
  flash?: boolean
  gps?: { lat: number; lon: number; alt?: number }
}

/** Formats whose EXIF block can be read; writing (stripping) works for the first three. */
const READABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])
const WRITABLE = new Set(['jpg', 'jpeg', 'png', 'webp'])
export const hasExifSupport = (name: string): boolean => READABLE.has(extensionOf(name))
export const canStripMetadata = (name: string): boolean => WRITABLE.has(extensionOf(name))
/** JPEG keeps EXIF near the start, so its first bytes are enough to read it. */
export const exifReadBytes = (name: string): number | null => (/^jpe?g$/.test(extensionOf(name)) ? 256 * 1024 : null)

// ---- containers --------------------------------------------------------------------------------------

type Format = 'jpeg' | 'png' | 'webp' | 'heic'

function formatOf(b: Uint8Array): Format | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp'
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') return 'heic'
  return null
}

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, Math.min(b.length, at + n)))
const be16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1]
const be32 = (b: Uint8Array, at: number): number => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const le32 = (b: Uint8Array, at: number): number => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

interface Segment {
  /** Start of the whole segment / chunk / box, and its end. */
  start: number
  end: number
  /** The TIFF data inside it. */
  tiff: [number, number]
}

const EXIF_HEADER = 'Exif\0\0'

/** JPEG segments before the image data: [marker, start, data start, end]. */
function jpegSegments(b: Uint8Array): { marker: number; start: number; data: number; end: number }[] {
  const out: { marker: number; start: number; data: number; end: number }[] = []
  let at = 2
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) break
    const marker = b[at + 1]
    if (marker === 0xff) {
      at++ // fill byte
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    const end = at + 2 + be16(b, at + 2)
    if (end > b.length && marker !== 0xda) break
    out.push({ marker, start: at, data: at + 4, end: Math.min(end, b.length) })
    if (marker === 0xda) break // start of scan: the rest is image data
    at = end
  }
  return out
}

function pngChunks(b: Uint8Array): { type: string; start: number; data: number; end: number }[] {
  const out: { type: string; start: number; data: number; end: number }[] = []
  let at = 8
  while (at + 12 <= b.length) {
    const len = be32(b, at)
    const end = at + 12 + len
    if (end > b.length) break
    const type = ascii(b, at + 4, 4)
    out.push({ type, start: at, data: at + 8, end })
    if (type === 'IEND') break
    at = end
  }
  return out
}

function webpChunks(b: Uint8Array): { type: string; start: number; data: number; size: number; end: number }[] {
  const out: { type: string; start: number; data: number; size: number; end: number }[] = []
  let at = 12
  while (at + 8 <= b.length) {
    const size = le32(b, at + 4)
    const end = at + 8 + size + (size & 1)
    if (at + 8 + size > b.length) break
    out.push({ type: ascii(b, at, 4), start: at, data: at + 8, size, end: Math.min(end, b.length) })
    at = end
  }
  return out
}

/** The EXIF block of a HEIC/HEIF file: the item of type "Exif", found through the meta box's iinf and iloc. */
function heicTiff(b: Uint8Array): [number, number] | null {
  const boxes = (from: number, to: number): { type: string; start: number; data: number; end: number }[] => {
    const out: { type: string; start: number; data: number; end: number }[] = []
    let at = from
    while (at + 8 <= to) {
      let size = be32(b, at)
      let header = 8
      if (size === 1) {
        if (at + 16 > to) break
        size = be32(b, at + 8) * 2 ** 32 + be32(b, at + 12)
        header = 16
      } else if (size === 0) size = to - at
      if (size < header || at + size > to) break
      out.push({ type: ascii(b, at + 4, 4), start: at, data: at + header, end: at + size })
      at += size
    }
    return out
  }
  const meta = boxes(0, b.length).find((x) => x.type === 'meta')
  if (!meta) return null
  const children = boxes(meta.data + 4, meta.end)
  const iinf = children.find((x) => x.type === 'iinf')
  const iloc = children.find((x) => x.type === 'iloc')
  if (!iinf || !iloc) return null
  // Which item is the EXIF one.
  const iinfVersion = b[iinf.data]
  const entriesAt = iinf.data + 4 + (iinfVersion === 0 ? 2 : 4)
  let exifId = -1
  for (const infe of boxes(entriesAt, iinf.end)) {
    if (infe.type !== 'infe') continue
    const v = b[infe.data]
    if (v < 2) continue
    const idSize = v === 2 ? 2 : 4
    const id = idSize === 2 ? be16(b, infe.data + 4) : be32(b, infe.data + 4)
    if (ascii(b, infe.data + 4 + idSize + 2, 4) === 'Exif') {
      exifId = id
      break
    }
  }
  if (exifId < 0) return null
  // Where it lies in the file.
  const v = b[iloc.data]
  let at = iloc.data + 4
  const offsetSize = b[at] >> 4
  const lengthSize = b[at] & 15
  const baseSize = b[at + 1] >> 4
  const indexSize = v === 1 || v === 2 ? b[at + 1] & 15 : 0
  at += 2
  const read = (n: number): number => {
    let x = 0
    for (let i = 0; i < n; i++) x = x * 256 + (b[at + i] ?? 0)
    at += n
    return x
  }
  const count = read(v < 2 ? 2 : 4)
  for (let i = 0; i < count && at < iloc.end; i++) {
    const id = read(v < 2 ? 2 : 4)
    const method = v === 1 || v === 2 ? read(2) & 15 : 0
    read(2) // data reference index
    const base = read(baseSize)
    const extents = read(2)
    let first: [number, number] | null = null
    for (let e = 0; e < extents; e++) {
      read(indexSize)
      const offset = read(offsetSize)
      const length = read(lengthSize)
      if (!first) first = [base + offset, length]
    }
    if (id !== exifId || method !== 0 || !first) continue
    const [start, length] = first
    if (start + 4 > b.length) return null
    // The item starts with the offset of the TIFF header behind it.
    const tiff = start + 4 + be32(b, start)
    const end = Math.min(b.length, start + length)
    return tiff + 8 <= end ? [tiff, end] : null
  }
  return null
}

/** Where the TIFF data of the EXIF block is, or null when the file has none. */
function findExif(b: Uint8Array): Segment | null {
  switch (formatOf(b)) {
    case 'jpeg':
      for (const s of jpegSegments(b)) if (s.marker === 0xe1 && ascii(b, s.data, 6) === EXIF_HEADER) return { start: s.start, end: s.end, tiff: [s.data + 6, s.end] }
      return null
    case 'png':
      for (const c of pngChunks(b)) if (c.type === 'eXIf') return { start: c.start, end: c.end, tiff: [c.data, c.end - 4] }
      return null
    case 'webp':
      for (const c of webpChunks(b)) {
        if (c.type !== 'EXIF') continue
        // Some writers keep the JPEG "Exif\0\0" prefix.
        const skip = ascii(b, c.data, 6) === EXIF_HEADER ? 6 : 0
        return { start: c.start, end: c.end, tiff: [c.data + skip, c.data + c.size] }
      }
      return null
    case 'heic': {
      const tiff = heicTiff(b)
      return tiff ? { start: tiff[0], end: tiff[1], tiff } : null
    }
    default:
      return null
  }
}

// ---- TIFF --------------------------------------------------------------------------------------------

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825

interface Entry {
  tag: number
  type: number
  count: number
  /** Offset of the value inside the TIFF data (inline values point into the entry). */
  value: number
  /** Offset of the 12-byte entry. */
  at: number
}

class Tiff {
  readonly le: boolean
  constructor(readonly b: Uint8Array) {
    this.le = b[0] === 0x49
  }
  static open(b: Uint8Array): Tiff | null {
    if (b.length < 8) return null
    const t = new Tiff(b)
    const sig = ascii(b, 0, 2)
    return (sig === 'II' || sig === 'MM') && t.u16(2) === 42 ? t : null
  }
  u16(at: number): number {
    if (at + 2 > this.b.length) return 0
    return this.le ? this.b[at] | (this.b[at + 1] << 8) : be16(this.b, at)
  }
  u32(at: number): number {
    if (at + 4 > this.b.length) return 0
    return this.le ? le32(this.b, at) : be32(this.b, at)
  }
  s32(at: number): number {
    return this.u32(at) | 0
  }
  entries(ifd: number): Entry[] {
    if (ifd < 8 || ifd + 2 > this.b.length) return []
    const n = Math.min(this.u16(ifd), 512)
    const out: Entry[] = []
    for (let i = 0; i < n; i++) {
      const at = ifd + 2 + i * 12
      if (at + 12 > this.b.length) break
      const type = this.u16(at + 2)
      const count = this.u32(at + 4)
      const size = (TYPE_SIZE[type] ?? 0) * count
      out.push({ tag: this.u16(at), type, count, value: size <= 4 ? at + 8 : this.u32(at + 8), at })
    }
    return out
  }
  /** Bytes a value takes when it is stored outside its entry, else 0. */
  outOfLine(e: Entry): number {
    const size = (TYPE_SIZE[e.type] ?? 0) * e.count
    return size > 4 ? size : 0
  }
  num(e: Entry, i = 0): number | undefined {
    const at = e.value + i * (TYPE_SIZE[e.type] ?? 0)
    if (i >= e.count || at >= this.b.length) return undefined
    switch (e.type) {
      case 1:
      case 7:
        return this.b[at]
      case 3:
        return this.u16(at)
      case 4:
        return this.u32(at)
      case 9:
        return this.s32(at)
      case 5: {
        const d = this.u32(at + 4)
        return d ? this.u32(at) / d : undefined
      }
      case 10: {
        const d = this.s32(at + 4)
        return d ? this.s32(at) / d : undefined
      }
      default:
        return undefined
    }
  }
  str(e: Entry): string | undefined {
    if (e.type !== 2 && e.type !== 7) return undefined
    const end = Math.min(this.b.length, e.value + e.count)
    let s = ''
    for (let i = e.value; i < end && this.b[i] !== 0; i++) s += String.fromCharCode(this.b[i])
    s = s.trim()
    // Many cameras write UTF-8 into ASCII fields.
    try {
      s = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))
    } catch {
      /* keep the latin-1 reading */
    }
    return s || undefined
  }
}

/** `2024:05:01 14:03:22` → `2024-05-01T14:03:22`; null for the zero dates some cameras write. */
export function exifDate(s: string | undefined): string | undefined {
  const m = s?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m || m[1] === '0000' || m[2] === '00') return undefined
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
}

export function parseTiff(b: Uint8Array): ExifData {
  const t = Tiff.open(b)
  if (!t) return {}
  const out: ExifData = {}
  const ifd0 = t.entries(t.u32(4))
  let modified: string | undefined
  for (const e of ifd0) {
    if (e.tag === 0x010f) out.make = t.str(e)
    else if (e.tag === 0x0110) out.model = t.str(e)
    else if (e.tag === 0x0112) out.orientation = t.num(e)
    else if (e.tag === 0x0131) out.software = t.str(e)
    else if (e.tag === 0x0132) modified = exifDate(t.str(e))
  }
  const exifIfd = ifd0.find((e) => e.tag === TAG_EXIF_IFD)
  let digitized: string | undefined
  for (const e of exifIfd ? t.entries(t.num(exifIfd) ?? 0) : []) {
    if (e.tag === 0x829a) out.exposure = t.num(e)
    else if (e.tag === 0x829d) out.fNumber = t.num(e)
    else if (e.tag === 0x8827) out.iso = t.num(e)
    else if (e.tag === 0x9003) out.taken = exifDate(t.str(e))
    else if (e.tag === 0x9004) digitized = exifDate(t.str(e))
    else if (e.tag === 0x9209) out.flash = ((t.num(e) ?? 0) & 1) === 1
    else if (e.tag === 0x920a) out.focalLength = t.num(e)
    else if (e.tag === 0xa405) out.focal35 = t.num(e) || undefined
    else if (e.tag === 0xa002) out.width = t.num(e)
    else if (e.tag === 0xa003) out.height = t.num(e)
    else if (e.tag === 0xa434) out.lens = t.str(e)
  }
  out.taken ??= digitized ?? modified
  const gpsIfd = ifd0.find((e) => e.tag === TAG_GPS_IFD)
  if (gpsIfd) {
    const g = new Map(t.entries(t.num(gpsIfd) ?? 0).map((e) => [e.tag, e]))
    const coord = (tag: number, refTag: number, neg: string): number | undefined => {
      const e = g.get(tag)
      const ref = g.get(refTag)
      if (!e || e.count < 3) return undefined
      const [d, m, s] = [t.num(e, 0), t.num(e, 1), t.num(e, 2)]
      if (d === undefined || m === undefined || s === undefined) return undefined
      const v = d + m / 60 + s / 3600
      return ref && t.str(ref)?.toUpperCase() === neg ? -v : v
    }
    const lat = coord(2, 1, 'S')
    const lon = coord(4, 3, 'W')
    if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
      const altEntry = g.get(6)
      const alt = altEntry ? t.num(altEntry) : undefined
      const below = g.get(5) ? t.num(g.get(5)!) === 1 : false
      out.gps = { lat, lon, ...(alt !== undefined ? { alt: below ? -alt : alt } : {}) }
    }
  }
  for (const k of Object.keys(out) as (keyof ExifData)[]) if (out[k] === undefined) delete out[k]
  return out
}

/** The photo's metadata, or null when the file carries no EXIF block. */
export function readExif(bytes: Uint8Array): ExifData | null {
  const seg = findExif(bytes)
  return seg ? parseTiff(bytes.subarray(seg.tiff[0], seg.tiff[1])) : null
}

// ---- writing -----------------------------------------------------------------------------------------

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** An XMP packet that mentions a location (exif:GPSLatitude and friends). */
const xmpHasGps = (b: Uint8Array, from: number, to: number): boolean => /GPS(Latitude|Longitude|Altitude)|exif:GPS/.test(ascii(b, from, to - from))

/** Zeroes the GPS directory of the TIFF data in place (same length, no offsets move). True when there was one. */
function wipeGps(tiff: Uint8Array): boolean {
  const t = Tiff.open(tiff)
  if (!t) return false
  const pointer = t.entries(t.u32(4)).find((e) => e.tag === TAG_GPS_IFD)
  const ifd = pointer ? (t.num(pointer) ?? 0) : 0
  if (ifd < 8 || ifd + 2 > tiff.length) return false
  const entries = t.entries(ifd)
  if (entries.length === 0) return false
  for (const e of entries) {
    const size = t.outOfLine(e)
    if (size && e.value >= 8 && e.value + size <= tiff.length) tiff.fill(0, e.value, e.value + size)
  }
  // The count, the entries and the next-directory pointer: an empty directory is left behind.
  tiff.fill(0, ifd, Math.min(tiff.length, ifd + 2 + entries.length * 12 + 4))
  return true
}

/** A copy without the location (EXIF GPS and XMP packets that carry one); null when there was none. */
export function stripGps(bytes: Uint8Array): Uint8Array | null {
  const format = formatOf(bytes)
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') return null
  const out = bytes.slice()
  const seg = findExif(out)
  const changed = seg ? wipeGps(out.subarray(seg.tiff[0], seg.tiff[1])) : false
  if (format === 'png' && changed) {
    const c = pngChunks(out).find((x) => x.type === 'eXIf')!
    writeCrc(out, c.start, c.end)
  }
  // XMP: dropped whole when it holds a location (rewriting XML in place is not worth the risk).
  const drop: [number, number][] = []
  if (format === 'jpeg') {
    for (const s of jpegSegments(out)) if (s.marker === 0xe1 && ascii(out, s.data, 28).startsWith('http://ns.adobe.com/xap/') && xmpHasGps(out, s.data, s.end)) drop.push([s.start, s.end])
  } else if (format === 'png') {
    for (const c of pngChunks(out)) if (c.type === 'iTXt' && ascii(out, c.data, 17) === 'XML:com.adobe.xmp' && xmpHasGps(out, c.data, c.end)) drop.push([c.start, c.end])
  } else {
    for (const c of webpChunks(out)) if (c.type === 'XMP ' && xmpHasGps(out, c.data, c.end)) drop.push([c.start, c.end])
  }
  if (drop.length === 0) return changed ? out : null
  const kept = cut(out, drop)
  return format === 'webp' ? fixWebp(kept) : kept
}

/** Bytes without the given ranges. */
function cut(b: Uint8Array, ranges: [number, number][]): Uint8Array {
  const parts: Uint8Array[] = []
  let at = 0
  for (const [s, e] of [...ranges].sort((x, y) => x[0] - y[0])) {
    parts.push(b.subarray(at, s))
    at = e
  }
  parts.push(b.subarray(at))
  return concat(parts)
}

/** The smallest TIFF that keeps only the orientation, so a stripped photo still shows upright. */
export function orientationTiff(orientation: number): Uint8Array {
  const b = new Uint8Array(26)
  b.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation & 0xff, 0, 0, 0, 0, 0, 0])
  return b
}

/**
 * A copy without EXIF, XMP, IPTC and comments; colour profiles stay, and so does the orientation (as a
 * minimal EXIF block). Null when there was nothing to remove.
 */
export function stripMetadata(bytes: Uint8Array): Uint8Array | null {
  const format = formatOf(bytes)
  const orientation = readExif(bytes)?.orientation
  const keep = orientation && orientation > 1 && orientation <= 8 ? orientationTiff(orientation) : null
  if (format === 'jpeg') {
    // APP1 (EXIF, XMP), APP12/13 (Ducky, IPTC) and comments; APP0 (JFIF), APP2 (ICC) and APP14 (Adobe colour) stay.
    const segs = jpegSegments(bytes)
    const drop = segs.filter((s) => s.marker === 0xe1 || s.marker === 0xec || s.marker === 0xed || s.marker === 0xfe).map((s): [number, number] => [s.start, s.end])
    if (drop.length === 0) return null
    const kept = cut(bytes, drop)
    if (!keep) return kept
    const app0 = jpegSegments(kept).find((s) => s.marker === 0xe0)
    const at = app0 ? app0.end : 2
    const payload = concat([new TextEncoder().encode(EXIF_HEADER), keep])
    const header = new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff])
    return concat([kept.subarray(0, at), header, payload, kept.subarray(at)])
  }
  if (format === 'png') {
    const chunks = pngChunks(bytes)
    const drop = chunks.filter((c) => ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(c.type)).map((c): [number, number] => [c.start, c.end])
    if (drop.length === 0) return null
    const kept = cut(bytes, drop)
    if (!keep) return kept
    const ihdr = pngChunks(kept).find((c) => c.type === 'IHDR')
    if (!ihdr) return kept
    return concat([kept.subarray(0, ihdr.end), pngChunk('eXIf', keep), kept.subarray(ihdr.end)])
  }
  if (format === 'webp') {
    const drop = webpChunks(bytes).filter((c) => c.type === 'EXIF' || c.type === 'XMP ').map((c): [number, number] => [c.start, c.end])
    if (drop.length === 0) return null
    const kept = cut(bytes, drop)
    if (!keep) return fixWebp(kept)
    const exif = new Uint8Array(8 + keep.length + (keep.length & 1))
    exif.set([0x45, 0x58, 0x49, 0x46, keep.length & 0xff, (keep.length >> 8) & 0xff, 0, 0])
    exif.set(keep, 8)
    return fixWebp(concat([kept, exif]))
  }
  return null
}

/** Rewrites the RIFF size and the VP8X flags for EXIF (0x08) and XMP (0x04) after chunks came or went. */
function fixWebp(b: Uint8Array): Uint8Array {
  const chunks = webpChunks(b)
  const vp8x = chunks.find((c) => c.type === 'VP8X')
  if (vp8x) {
    let flags = b[vp8x.data] & ~0x0c
    if (chunks.some((c) => c.type === 'EXIF')) flags |= 0x08
    if (chunks.some((c) => c.type === 'XMP ')) flags |= 0x04
    b[vp8x.data] = flags
  }
  const size = b.length - 8
  b.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4)
  return b
}

let crcTable: Uint32Array | null = null
export function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function writeCrc(b: Uint8Array, start: number, end: number): void {
  const crc = crc32(b.subarray(start + 4, end - 4))
  b.set([crc >>> 24, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff], end - 4)
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const n = data.length
  out.set([n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff], 0)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  writeCrc(out, 0, out.length)
  return out
}

// ---- display -----------------------------------------------------------------------------------------

/** `1/250 s`, `0.5 s`, `2 s`. */
export function formatExposure(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds < 0.5) return `1/${Math.round(1 / seconds)} s`
  return `${Number(seconds.toFixed(1))} s`
}

/** `50.08804° N, 14.42076° E`. */
export function formatCoords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(5)}° ${lon < 0 ? 'W' : 'E'}`
}

/** Camera name without the maker repeated ("Canon Canon EOS R6" → "Canon EOS R6"). */
export function cameraName(make: string | undefined, model: string | undefined): string | undefined {
  if (!model) return make
  if (!make || model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0])) return model
  return `${make} ${model}`
}

/**
 * Carries the EXIF block of `source` (any readable format) over to a freshly encoded JPEG, with the
 * orientation set to upright (the pixels were already turned when decoded). Returns `jpeg` unchanged when
 * either side has nothing to work with.
 */
export function transplantExif(source: Uint8Array, jpeg: Uint8Array, dropGps = false): Uint8Array {
  const seg = findExif(source)
  if (!seg || formatOf(jpeg) !== 'jpeg') return jpeg
  const tiff = source.slice(seg.tiff[0], seg.tiff[1])
  if (tiff.length > 65000) return jpeg
  const t = Tiff.open(tiff)
  if (!t) return jpeg
  const orientation = t.entries(t.u32(4)).find((e) => e.tag === 0x0112 && e.type === 3)
  if (orientation) tiff.set(t.le ? [1, 0] : [0, 1], orientation.value)
  if (dropGps) wipeGps(tiff)
  // The encoder's own APP1 (none from Chromium, but be safe) goes; the new one follows APP0.
  const kept = cut(jpeg, jpegSegments(jpeg).filter((s) => s.marker === 0xe1).map((s): [number, number] => [s.start, s.end]))
  const app0 = jpegSegments(kept).find((s) => s.marker === 0xe0)
  const at = app0 ? app0.end : 2
  const payload = concat([new TextEncoder().encode(EXIF_HEADER), tiff])
  const header = new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff])
  return concat([kept.subarray(0, at), header, payload, kept.subarray(at)])
}

/**
 * A JPEG with a new orientation value, without touching the image data: patched in the EXIF block, or a
 * minimal block added when there is none. Null when the block exists but has no orientation field to patch.
 */
export function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array | null {
  if (formatOf(jpeg) !== 'jpeg') return null
  const seg = findExif(jpeg)
  if (!seg) {
    const app0 = jpegSegments(jpeg).find((s) => s.marker === 0xe0)
    const at = app0 ? app0.end : 2
    const payload = concat([new TextEncoder().encode(EXIF_HEADER), orientationTiff(orientation)])
    const header = new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff])
    return concat([jpeg.subarray(0, at), header, payload, jpeg.subarray(at)])
  }
  const out = jpeg.slice()
  const tiff = out.subarray(seg.tiff[0], seg.tiff[1])
  const t = Tiff.open(tiff)
  const entry = t?.entries(t.u32(4)).find((e) => e.tag === 0x0112 && e.type === 3)
  if (!t || !entry) return null
  tiff.set(t.le ? [orientation, 0] : [0, orientation], entry.value)
  return out
}
