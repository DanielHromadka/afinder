// Layout of a contact sheet: a grid of pictures with their names under a title, as one image.

export interface SheetOptions {
  columns: number
  /** Width of one picture's box; its height is three quarters of it. */
  thumbWidth: number
  names: boolean
  format: 'jpg' | 'png'
}

export const DEFAULT_SHEET: SheetOptions = { columns: 5, thumbWidth: 240, names: true, format: 'jpg' }

export const SHEET_PAD = 12
export const SHEET_TITLE = 36
export const SHEET_LABEL = 18
/** Canvas limit Chromium is happy with on every platform. */
export const MAX_SHEET_SIDE = 16000

export interface SheetLayout {
  width: number
  height: number
  thumbHeight: number
  /** Top-left corner of each picture's box. */
  cells: { x: number; y: number }[]
}

export function sheetLayout(count: number, o: Pick<SheetOptions, 'columns' | 'thumbWidth' | 'names'>): SheetLayout {
  const columns = Math.max(1, Math.min(count || 1, Math.round(o.columns)))
  const thumbWidth = Math.max(32, Math.round(o.thumbWidth))
  const thumbHeight = Math.round(thumbWidth * 0.75)
  const cellH = thumbHeight + (o.names ? SHEET_LABEL : 0) + SHEET_PAD
  const rows = Math.ceil(count / columns)
  const cells = Array.from({ length: count }, (_, i) => ({
    x: SHEET_PAD + (i % columns) * (thumbWidth + SHEET_PAD),
    y: SHEET_TITLE + Math.floor(i / columns) * cellH
  }))
  return { width: SHEET_PAD + columns * (thumbWidth + SHEET_PAD), height: SHEET_TITLE + rows * cellH, thumbHeight, cells }
}

/** How many pictures fit before the sheet would grow past the canvas limit. */
export function sheetCapacity(o: Pick<SheetOptions, 'columns' | 'thumbWidth' | 'names'>): number {
  const one = sheetLayout(1, o)
  const cellH = one.height - SHEET_TITLE
  const rows = Math.floor((MAX_SHEET_SIDE - SHEET_TITLE) / cellH)
  return one.width > MAX_SHEET_SIDE ? 0 : rows * Math.max(1, Math.round(o.columns))
}

/** A name cut to fit `max` characters, with an ellipsis in the middle so the extension stays. */
export function shortName(name: string, max: number): string {
  if (name.length <= max) return name
  const keep = Math.max(1, max - 1)
  const tail = Math.ceil(keep / 3)
  return `${name.slice(0, keep - tail)}…${name.slice(name.length - tail)}`
}
