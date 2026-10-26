// Squarified treemap (Bruls, Huizing, van Wijk): lays out sizes as rectangles that stay close to
// squares, so even small items in the disk map remain clickable.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Rectangles for `sizes` (any order; the result keeps it) filling `rect`. Zero sizes get empty boxes. */
export function squarify(sizes: number[], rect: Rect): Rect[] {
  const out: Rect[] = sizes.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }))
  const total = sizes.reduce((a, b) => a + Math.max(0, b), 0)
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out
  const scale = (rect.w * rect.h) / total
  const order = sizes.map((s, i) => ({ i, a: Math.max(0, s) * scale })).filter((o) => o.a > 0).sort((p, q) => q.a - p.a)

  let { x, y, w, h } = rect
  const worst = (row: number[], side: number): number => {
    const sum = row.reduce((a, b) => a + b, 0)
    const max = Math.max(...row)
    const min = Math.min(...row)
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }
  let row: typeof order = []
  const place = (): void => {
    const sum = row.reduce((a, o) => a + o.a, 0)
    if (w >= h) {
      // Column on the left.
      const cw = sum / h
      let cy = y
      for (const o of row) {
        const ch = o.a / cw
        out[o.i] = { x, y: cy, w: cw, h: ch }
        cy += ch
      }
      x += cw
      w -= cw
    } else {
      const rh = sum / w
      let cx = x
      for (const o of row) {
        const cw = o.a / rh
        out[o.i] = { x: cx, y, w: cw, h: rh }
        cx += cw
      }
      y += rh
      h -= rh
    }
    row = []
  }
  for (const o of order) {
    const side = Math.min(w, h)
    if (row.length && worst([...row.map((r) => r.a), o.a], side) > worst(row.map((r) => r.a), side)) place()
    row.push(o)
  }
  if (row.length) place()
  return out
}
