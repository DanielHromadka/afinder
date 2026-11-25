import { describe, expect, it } from 'vitest'
import { dHash, greyOf, groupSimilar, hamming } from './phash'

const gradient = (shift: number): Uint8Array => Uint8Array.from({ length: 72 }, (_, i) => ((i % 9) * 20 + Math.floor(i / 9) * 3 + shift) % 256)

describe('phash', () => {
  it('hashes and compares', () => {
    const a = dHash(gradient(0))
    expect(a).toEqual([0, 0])
    const reversed = dHash(Uint8Array.from(gradient(0)).reverse())
    expect(hamming(a, reversed)).toBe(64)
    // Brighter everywhere: the same hash.
    expect(hamming(a, dHash(gradient(10)))).toBe(0)
  })
  it('groups close hashes transitively', () => {
    const groups = groupSimilar(
      [
        [0, 0],
        [0b111, 0],
        [0xffffffff, 0xffffffff],
        [0b111111, 0]
      ],
      4
    )
    expect(groups).toEqual([[0, 1, 3]])
  })
  it('turns RGBA into grey', () => {
    expect([...greyOf(Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([255, 0])
  })
})
