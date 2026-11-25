import { describe, expect, it } from 'vitest'
import { orientationTiff } from './exif'
import { imageSize } from './imageSize'

const bytes = (...parts: (number[] | string)[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

describe('imageSize', () => {
  it('reads PNG, GIF, BMP and WebP headers', () => {
    expect(imageSize(bytes([0x89], 'PNG', [13, 10, 26, 10, 0, 0, 0, 13], 'IHDR', [0, 0, 1, 0, 0, 0, 0, 200]))).toEqual({ width: 256, height: 200 })
    expect(imageSize(bytes('GIF89a', [10, 0, 20, 0]))).toEqual({ width: 10, height: 20 })
    expect(imageSize(bytes('BM', Array(16).fill(0), [100, 0, 0, 0, 0x9c, 0xff, 0xff, 0xff]))).toEqual({ width: 100, height: 100 })
    expect(imageSize(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0, 0, 0, 0, 0, 0x3f, 0x01, 0, 0xc7, 0, 0]))).toEqual({ width: 320, height: 200 })
    expect(imageSize(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x01, 0xc8, 0x00]))).toEqual({ width: 320, height: 200 })
    const w = 640 - 1
    const h = 480 - 1
    const bits = w | (h << 14)
    expect(imageSize(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8L', [0, 0, 0, 0, 0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]))).toEqual({ width: 640, height: 480 })
  })
  it('reads the JPEG SOF and swaps for turned photos', () => {
    const sof = [0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3]
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0], sof))).toEqual({ width: 640, height: 480 })
    const exif = [...bytes('Exif', [0, 0])].concat([...orientationTiff(6)])
    const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif]
    expect(imageSize(bytes([0xff, 0xd8], app1, sof))).toEqual({ width: 480, height: 640 })
  })
  it('gives null for anything else', () => {
    expect(imageSize(bytes('hello world, not an image'))).toBeNull()
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
  })
})
