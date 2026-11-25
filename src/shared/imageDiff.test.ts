import { describe, expect, it } from 'vitest'
import { diffPixels } from './imageDiff'

describe('diffPixels', () => {
  it('marks changed pixels and counts them', () => {
    const a = Uint8ClampedArray.from([10, 10, 10, 255, 0, 0, 0, 255])
    const b = Uint8ClampedArray.from([12, 10, 10, 255, 200, 0, 0, 255])
    const { image, changed } = diffPixels(a, b)
    expect(changed).toBe(0.5)
    expect(image[0]).toBe(image[1])
    expect([image[4], image[5], image[6]]).toEqual([255, 0, 0])
  })
})
