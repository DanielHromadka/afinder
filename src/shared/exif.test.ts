import { describe, expect, it } from 'vitest'
import { cameraName, crc32, exifDate, formatCoords, formatExposure, orientationTiff, parseTiff, readExif, stripGps, stripMetadata, transplantExif, withOrientation } from './exif'

// A small big-endian TIFF built by hand: IFD0 (make, model, orientation, pointers), the EXIF IFD and the GPS IFD.
type Field = [tag: number, type: number, value: number[] | string]
function tiff(ifd0: Field[], exif: Field[], gps: Field[]): Uint8Array {
  const data: number[] = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8]
  const u16 = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff]
  const u32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
  const size = (f: Field): number => (f[1] === 2 ? (f[2] as string).length + 1 : f[1] === 5 ? 8 * (f[2] as number[]).length : f[1] === 3 ? 2 * (f[2] as number[]).length : 4 * (f[2] as number[]).length)
  const ifdLen = (fields: Field[]): number => 2 + fields.length * 12 + 4 + fields.reduce((n, f) => n + (size(f) > 4 ? size(f) : 0), 0)
  const at0 = 8
  const atExif = at0 + ifdLen(ifd0) + 24
  const atGps = atExif + ifdLen(exif)
  const write = (fields: Field[], start: number): void => {
    let extra = start + 2 + fields.length * 12 + 4
    const tail: number[] = []
    data.push(...u16(fields.length))
    for (const f of fields) {
      const value = f[0] === 0x8769 ? [atExif] : f[0] === 0x8825 ? [atGps] : f[2]
      const bytes = f[1] === 2 ? [...(value as string)].map((c) => c.charCodeAt(0)).concat(0) : f[1] === 3 ? (value as number[]).flatMap(u16) : f[1] === 5 ? (value as number[]).flatMap((v) => [...u32(Math.round(v * 1000)), ...u32(1000)]) : (value as number[]).flatMap(u32)
      data.push(...u16(f[0]), ...u16(f[1]), ...u32(f[1] === 2 ? bytes.length : (value as number[]).length))
      if (bytes.length > 4) {
        data.push(...u32(extra))
        tail.push(...bytes)
        extra += bytes.length
      } else data.push(...bytes, ...Array(4 - bytes.length).fill(0))
    }
    data.push(0, 0, 0, 0, ...tail)
  }
  write(ifd0, at0)
  while (data.length < atExif) data.push(0)
  write(exif, atExif)
  write(gps, atGps)
  return Uint8Array.from(data)
}

const sample = tiff(
  [
    [0x010f, 2, 'Canon'],
    [0x0110, 2, 'Canon EOS R6'],
    [0x0112, 3, [6]],
    [0x8769, 4, [0]],
    [0x8825, 4, [0]]
  ],
  [
    [0x829a, 5, [0.004]],
    [0x829d, 5, [1.8]],
    [0x8827, 3, [400]],
    [0x9003, 2, '2024:05:01 14:03:22'],
    [0x920a, 5, [50]]
  ],
  [
    [1, 2, 'N'],
    [2, 5, [50, 5, 16.944]],
    [3, 2, 'W'],
    [4, 5, [14, 25, 14.736]]
  ]
)

const jpeg = (t: Uint8Array, extra: number[][] = []): Uint8Array => {
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t]
  const seg = (marker: number, body: number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]
  return Uint8Array.from([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), ...seg(0xe1, exif), ...extra.flat(), ...seg(0xe2, [1, 2, 3]), 0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9])
}

const png = (t: Uint8Array): Uint8Array => {
  const chunk = (type: string, body: Uint8Array): number[] => {
    const typed = Uint8Array.from([...type].map((c) => c.charCodeAt(0)).concat([...body]))
    const crc = crc32(typed)
    const n = body.length
    return [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...typed, crc >>> 24, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff]
  }
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', new Uint8Array(13)), ...chunk('eXIf', t), ...chunk('tEXt', new TextEncoder().encode('Comment\0hi')), ...chunk('IDAT', new Uint8Array(4)), ...chunk('IEND', new Uint8Array())])
}

const webp = (t: Uint8Array): Uint8Array => {
  const chunk = (type: string, body: Uint8Array): number[] => {
    const n = body.length
    return [...[...type].map((c) => c.charCodeAt(0)), n & 0xff, (n >> 8) & 0xff, 0, 0, ...body, ...(n & 1 ? [0] : [])]
  }
  const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...chunk('VP8X', Uint8Array.from([0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0])), ...chunk('VP8 ', new Uint8Array(10)), ...chunk('EXIF', t)]
  const n = body.length
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, n & 0xff, (n >> 8) & 0xff, 0, 0, ...body])
}

describe('parseTiff', () => {
  it('reads camera, date, exposure and location', () => {
    const d = parseTiff(sample)
    expect(d).toMatchObject({ make: 'Canon', model: 'Canon EOS R6', orientation: 6, iso: 400, taken: '2024-05-01T14:03:22', fNumber: 1.8, focalLength: 50 })
    expect(d.exposure).toBeCloseTo(0.004)
    expect(d.gps!.lat).toBeCloseTo(50.08804, 4)
    expect(d.gps!.lon).toBeCloseTo(-14.42076, 4)
  })
  it('gives nothing for garbage and survives truncation', () => {
    expect(parseTiff(new Uint8Array([1, 2, 3]))).toEqual({})
    for (let n = 0; n < sample.length; n += 7) expect(() => parseTiff(sample.subarray(0, n))).not.toThrow()
  })
})

describe('readExif', () => {
  it('finds the block in JPEG, PNG and WebP', () => {
    for (const file of [jpeg(sample), png(sample), webp(sample)]) expect(readExif(file)?.model).toBe('Canon EOS R6')
  })
  it('returns null without EXIF or for unknown data', () => {
    expect(readExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
    expect(readExif(new Uint8Array(40))).toBeNull()
  })
})

describe('stripGps', () => {
  it('removes the location and keeps the rest, at the same size', () => {
    for (const file of [jpeg(sample), png(sample), webp(sample)]) {
      const out = stripGps(file)!
      expect(out.length).toBe(file.length)
      const d = readExif(out)!
      expect(d.gps).toBeUndefined()
      expect(d.model).toBe('Canon EOS R6')
      expect(stripGps(out)).toBeNull()
    }
  })
  it('drops an XMP packet that carries a location', () => {
    const xmp = [...new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0<x exif:GPSLatitude="50,5N"/>')]
    const file = jpeg(sample, [[0xff, 0xe1, (xmp.length + 2) >> 8, (xmp.length + 2) & 0xff, ...xmp]])
    const out = stripGps(file)!
    expect(new TextDecoder().decode(out)).not.toContain('GPSLatitude')
  })
  it('keeps a valid PNG checksum', () => {
    const out = stripGps(png(sample))!
    // eXIf is the second chunk: 8 signature + 25 IHDR.
    const at = 8 + 25
    const len = (out[at] << 24) | (out[at + 1] << 16) | (out[at + 2] << 8) | out[at + 3]
    const crc = crc32(out.subarray(at + 4, at + 8 + len))
    const stored = ((out[at + 8 + len] << 24) | (out[at + 9 + len] << 16) | (out[at + 10 + len] << 8) | out[at + 11 + len]) >>> 0
    expect(stored).toBe(crc)
  })
})

describe('stripMetadata', () => {
  it('removes everything but the orientation and the colour profile', () => {
    const out = stripMetadata(jpeg(sample))!
    expect(readExif(out)).toEqual({ orientation: 6 })
    expect([...out].join(',')).toContain([0xff, 0xe2, 0, 5, 1, 2, 3].join(','))
    expect(stripMetadata(stripMetadata(out)!) ?? out).toBeTruthy()
  })
  it('handles PNG and WebP', () => {
    const p = stripMetadata(png(sample))!
    expect(readExif(p)).toEqual({ orientation: 6 })
    expect(new TextDecoder().decode(p)).not.toContain('Comment')
    const w = stripMetadata(webp(sample))!
    expect(readExif(w)).toEqual({ orientation: 6 })
    const size = w[4] | (w[5] << 8) | (w[6] << 16) | (w[7] << 24)
    expect(size).toBe(w.length - 8)
  })
  it('is null when there is nothing to remove', () => {
    expect(stripMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toBeNull()
  })
  it('writes an upright-only block', () => {
    expect(parseTiff(orientationTiff(3))).toEqual({ orientation: 3 })
  })
})

describe('formatting', () => {
  it('formats exposure, coordinates, dates and cameras', () => {
    expect(formatExposure(0.004)).toBe('1/250 s')
    expect(formatExposure(2)).toBe('2 s')
    expect(formatCoords(50.088, -14.42)).toBe('50.08800° N, 14.42000° W')
    expect(exifDate('0000:00:00 00:00:00')).toBeUndefined()
    expect(exifDate('2024:05:01 14:03:22')).toBe('2024-05-01T14:03:22')
    expect(cameraName('Canon', 'Canon EOS R6')).toBe('Canon EOS R6')
    expect(cameraName('Apple', 'iPhone 15')).toBe('Apple iPhone 15')
    expect(cameraName('NIKON CORPORATION', 'NIKON D750')).toBe('NIKON D750')
  })
})

describe('transplantExif', () => {
  const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 7, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xda, 0, 2, 1, 0xff, 0xd9])
  it('copies the block into a new JPEG, upright', () => {
    for (const source of [jpeg(sample), png(sample), webp(sample)]) {
      const d = readExif(transplantExif(source, bare))!
      expect(d).toMatchObject({ model: 'Canon EOS R6', orientation: 1, taken: '2024-05-01T14:03:22' })
      expect(d.gps).toBeDefined()
    }
    expect(readExif(transplantExif(jpeg(sample), bare, true))!.gps).toBeUndefined()
  })
  it('leaves the JPEG alone without a source block', () => {
    expect(transplantExif(new Uint8Array(10), bare)).toBe(bare)
  })
})

describe('withOrientation', () => {
  it('patches the value in place, or adds a block', () => {
    const out = withOrientation(jpeg(sample), 8)!
    expect(out.length).toBe(jpeg(sample).length)
    expect(readExif(out)).toMatchObject({ orientation: 8, model: 'Canon EOS R6' })
    const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 1, 0xff, 0xd9])
    expect(readExif(withOrientation(bare, 6)!)).toEqual({ orientation: 6 })
    expect(withOrientation(png(sample), 6)).toBeNull()
  })
})
