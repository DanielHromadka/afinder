import { describe, expect, it } from 'vitest'
import { canOverwrite, DEFAULT_RESIZE, fitQuality, resizedExt, resizedSize } from './resize'

describe('resize', () => {
  it('fits into the limits without enlarging', () => {
    expect(resizedSize(4000, 3000, DEFAULT_RESIZE)).toEqual({ width: 1920, height: 1440 })
    expect(resizedSize(3000, 4000, DEFAULT_RESIZE)).toEqual({ width: 1440, height: 1920 })
    expect(resizedSize(800, 600, DEFAULT_RESIZE)).toEqual({ width: 800, height: 600 })
    expect(resizedSize(4000, 3000, { ...DEFAULT_RESIZE, maxHeight: 0 })).toEqual({ width: 1920, height: 1440 })
    expect(resizedSize(4000, 3000, { ...DEFAULT_RESIZE, mode: 'percent', percent: 25 })).toEqual({ width: 1000, height: 750 })
    expect(resizedSize(1, 1, { ...DEFAULT_RESIZE, mode: 'percent', percent: 1 })).toEqual({ width: 1, height: 1 })
  })
  it('picks the format and whether the original may be replaced', () => {
    expect(resizedExt('a.JPEG', 'keep')).toBe('jpg')
    expect(resizedExt('a.heic', 'keep')).toBe('jpg')
    expect(resizedExt('a.png', 'webp')).toBe('webp')
    expect(canOverwrite('a.jpeg', 'keep')).toBe(true)
    expect(canOverwrite('a.jpg', 'jpg')).toBe(true)
    expect(canOverwrite('a.png', 'jpg')).toBe(false)
    expect(canOverwrite('a.heic', 'keep')).toBe(false)
  })
  it('lowers the quality until the file fits', async () => {
    // A fake encoder: size grows with quality.
    const encode = async (q: number): Promise<Uint8Array> => new Uint8Array(Math.round(q * 1000))
    expect((await fitQuality(encode, 2000, 0.85)).length).toBe(850)
    const fitted = await fitQuality(encode, 400, 0.85)
    expect(fitted.length).toBeLessThanOrEqual(400)
    expect(fitted.length).toBeGreaterThan(350)
    expect((await fitQuality(encode, 10, 0.85)).length).toBeLessThan(60)
  })
})
