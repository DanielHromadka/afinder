// The difference of two images of the same size: unchanged pixels faded to grey, changed ones in red with
// strength by how much they differ, and the share of pixels that changed.

/** Channel difference below which a pixel counts as the same (JPEG noise). */
export const DIFF_THRESHOLD = 16

export function diffPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = DIFF_THRESHOLD): { image: Uint8ClampedArray; changed: number } {
  const n = Math.min(a.length, b.length)
  const image = new Uint8ClampedArray(n)
  let changed = 0
  for (let i = 0; i < n; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]))
    if (d > threshold) {
      changed++
      image[i] = 255
      image[i + 1] = 255 - Math.min(255, d * 2)
      image[i + 2] = 255 - Math.min(255, d * 2)
    } else {
      // The first image, light and grey, so the changes stand out.
      const grey = 200 + ((a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) * 55) / 255
      image[i] = image[i + 1] = image[i + 2] = grey
    }
    image[i + 3] = 255
  }
  return { image, changed: changed / Math.max(1, n / 4) }
}
