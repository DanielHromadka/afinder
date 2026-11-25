// Turning and mirroring photos. The eight EXIF orientations are the eight symmetries of a rectangle, kept
// here as 2×2 matrices that map stored pixels to what is shown, so a turn is a matrix product: JPEGs get a
// new orientation value (lossless, instant), other formats are redrawn with the same matrix.

export type Turn = 'left' | 'right' | 'half' | 'flipH' | 'flipV'
export const TURNS: Turn[] = ['right', 'left', 'half', 'flipH', 'flipV']

type Matrix = [number, number, number, number] // [m00, m01, m10, m11]: (x, y) → (m00·x + m01·y, m10·x + m11·y), y down

/** Matrix of each EXIF orientation value (1–8). */
const ORIENTATION: Record<number, Matrix> = {
  1: [1, 0, 0, 1],
  2: [-1, 0, 0, 1],
  3: [-1, 0, 0, -1],
  4: [1, 0, 0, -1],
  5: [0, 1, 1, 0],
  6: [0, -1, 1, 0],
  7: [0, -1, -1, 0],
  8: [0, 1, -1, 0]
}

const TURN: Record<Turn, Matrix> = { right: ORIENTATION[6], left: ORIENTATION[8], half: ORIENTATION[3], flipH: ORIENTATION[2], flipV: ORIENTATION[4] }

const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]]

/** The orientation after applying a turn to a photo shown with `orientation`. */
export function turnedOrientation(orientation: number, turn: Turn): number {
  const m = multiply(TURN[turn], ORIENTATION[orientation] ?? ORIENTATION[1])
  return Number(Object.keys(ORIENTATION).find((k) => ORIENTATION[Number(k)].every((v, i) => v === m[i])))
}

/** Canvas transform (a, b, c, d, e, f) and output size that draw a w×h image turned. */
export function turnTransform(turn: Turn, w: number, h: number): { width: number; height: number; matrix: [number, number, number, number, number, number] } {
  const [m00, m01, m10, m11] = TURN[turn]
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h]
  ].map(([x, y]) => [m00 * x + m01 * y, m10 * x + m11 * y])
  const minX = Math.min(...corners.map((c) => c[0]))
  const minY = Math.min(...corners.map((c) => c[1]))
  const swap = m00 === 0
  return { width: swap ? h : w, height: swap ? w : h, matrix: [m00, m10, m01, m11, -minX, -minY] }
}
