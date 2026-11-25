// Finding photos that look alike: a difference hash (64 bits from a 9×8 greyscale picture, each bit says
// whether a pixel is brighter than its right neighbour) survives resizing, recompression and small edits,
// and photos whose hashes differ in few bits are grouped.

/** Hashes this many bits apart or fewer count as the same picture. */
export const SIMILAR_DISTANCE = 10
/** Comparing every pair grows quadratically; beyond this the search refuses. */
export const MAX_SIMILAR_IMAGES = 10_000

/** 72 grey values (9 wide, 8 high, row by row) to the hash as two 32-bit halves. */
export function dHash(grey: Uint8Array | Uint8ClampedArray): [number, number] {
  let hi = 0
  let lo = 0
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const bit = grey[y * 9 + x] > grey[y * 9 + x + 1] ? 1 : 0
      const n = y * 8 + x
      if (n < 32) hi = (hi | (bit << (31 - n))) >>> 0
      else lo = (lo | (bit << (63 - n))) >>> 0
    }
  return [hi, lo]
}

/** RGBA pixels of the 9×8 picture to grey. */
export function greyOf(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2)
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) out[p] = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114)
  return out
}

const popcount = (v: number): number => {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export const hamming = (a: [number, number], b: [number, number]): number => popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0)

/** Indices of the hashes in groups of two or more that are (transitively) within `distance` of each other. */
export function groupSimilar(hashes: [number, number][], distance = SIMILAR_DISTANCE): number[][] {
  const parent = hashes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  for (let i = 0; i < hashes.length; i++)
    for (let j = i + 1; j < hashes.length; j++) {
      if (hamming(hashes[i], hashes[j]) > distance) continue
      const a = find(i)
      const b = find(j)
      if (a !== b) parent[b] = a
    }
  const groups = new Map<number, number[]>()
  hashes.forEach((_, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), i])
  })
  return [...groups.values()].filter((g) => g.length > 1)
}
