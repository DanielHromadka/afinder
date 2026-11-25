import { describe, expect, it } from 'vitest'
import { encodeGif, indexPixels, lzw, medianCut, paletteLookup, samplePixels } from './gif'

/** GIF LZW decoder, to check the encoder against. */
function unlzw(data: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize
  const end = clear + 1
  let size = minCodeSize + 1
  let dict: number[][] = []
  const reset = (): void => {
    dict = Array.from({ length: clear }, (_, i) => [i])
    dict.push([], [])
    size = minCodeSize + 1
  }
  reset()
  const out: number[] = []
  let bit = 0
  let prev: number[] | null = null
  const read = (): number => {
    let code = 0
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i
    return code
  }
  for (;;) {
    const code = read()
    if (code === clear) {
      reset()
      prev = null
      continue
    }
    if (code === end) break
    let entry: number[]
    if (code < dict.length) entry = dict[code]
    else entry = [...prev!, prev![0]]
    out.push(...entry)
    if (prev) dict.push([...prev, entry[0]])
    prev = entry
    if (dict.length === 1 << size && size < 12) size++
  }
  return out
}

describe('gif', () => {
  it('round-trips LZW, also past the 4096-code reset', () => {
    const small = Uint8Array.from([0, 1, 1, 1, 2, 3, 0, 0, 0, 0, 1, 2])
    expect(unlzw(lzw(small, 2), 2)).toEqual([...small])
    const big = Uint8Array.from({ length: 40000 }, (_, i) => (i * 7 + (i >> 5)) % 256)
    expect(unlzw(lzw(big, 8), 8)).toEqual([...big])
    expect(unlzw(lzw(new Uint8Array(), 2), 2)).toEqual([])
  })
  it('builds a palette and maps colours to it', () => {
    const rgb = Uint8Array.from([255, 0, 0, 250, 5, 0, 0, 0, 255, 0, 10, 250])
    const palette = medianCut(rgb, 2)
    expect(palette.length).toBe(6)
    const lookup = paletteLookup(palette)
    const idx = indexPixels(Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]), lookup)
    expect(palette[idx[0] * 3]).toBeGreaterThan(200)
    expect(palette[idx[1] * 3 + 2]).toBeGreaterThan(200)
    expect(samplePixels(Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]), 2)).toEqual(Uint8Array.from([1, 2, 3]))
  })
  it('writes a looping GIF89a with one image per frame', () => {
    const palette = Uint8Array.from([0, 0, 0, 255, 255, 255])
    const frames = [Uint8Array.from([0, 1, 1, 0]), Uint8Array.from([1, 0, 0, 1])]
    const gif = encodeGif(frames, 2, 2, palette, 10)
    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a')
    expect(gif[gif.length - 1]).toBe(0x3b)
    expect(new TextDecoder().decode(gif)).toContain('NETSCAPE2.0')
    // Image descriptors: one 0x2c after each graphic control extension.
    let images = 0
    for (let i = 0; i < gif.length - 1; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9) images++
    expect(images).toBe(2)
  })
})
