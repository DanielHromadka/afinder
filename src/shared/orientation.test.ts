import { describe, expect, it } from 'vitest'
import { turnedOrientation, turnTransform } from './orientation'

describe('orientation', () => {
  it('composes turns with the EXIF orientation', () => {
    expect(turnedOrientation(1, 'right')).toBe(6)
    expect(turnedOrientation(6, 'right')).toBe(3)
    expect(turnedOrientation(3, 'right')).toBe(8)
    expect(turnedOrientation(8, 'right')).toBe(1)
    expect(turnedOrientation(1, 'left')).toBe(8)
    expect(turnedOrientation(6, 'left')).toBe(1)
    expect(turnedOrientation(1, 'flipH')).toBe(2)
    expect(turnedOrientation(2, 'flipH')).toBe(1)
    expect(turnedOrientation(1, 'flipV')).toBe(4)
    expect(turnedOrientation(1, 'half')).toBe(3)
    // Mirror then rotate 270° CW is 5; mirror then rotate 90° CW is 7.
    expect(turnedOrientation(2, 'left')).toBe(5)
    expect(turnedOrientation(2, 'right')).toBe(7)
    expect(turnedOrientation(0, 'right')).toBe(6)
  })
  it('maps the image into the output canvas', () => {
    const r = turnTransform('right', 40, 30)
    expect([r.width, r.height]).toEqual([30, 40])
    const [a, b, c, d, e, f] = r.matrix
    // The top-left pixel ends up at the top right.
    expect([a * 0 + c * 0 + e, b * 0 + d * 0 + f]).toEqual([30, 0])
    const h = turnTransform('flipH', 40, 30)
    expect([h.width, h.height, h.matrix[4]]).toEqual([40, 30, 40])
  })
})
