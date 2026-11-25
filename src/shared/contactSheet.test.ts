import { describe, expect, it } from 'vitest'
import { DEFAULT_SHEET, MAX_SHEET_SIDE, SHEET_PAD, SHEET_TITLE, sheetCapacity, sheetLayout, shortName } from './contactSheet'

describe('contact sheet', () => {
  it('lays pictures out in rows under the title', () => {
    const l = sheetLayout(7, { columns: 3, thumbWidth: 100, names: true })
    expect(l.thumbHeight).toBe(75)
    expect(l.width).toBe(SHEET_PAD + 3 * (100 + SHEET_PAD))
    expect(l.cells[0]).toEqual({ x: SHEET_PAD, y: SHEET_TITLE })
    expect(l.cells[4]).toEqual({ x: SHEET_PAD + 112, y: SHEET_TITLE + 75 + 18 + SHEET_PAD })
    expect(l.height).toBe(SHEET_TITLE + 3 * (75 + 18 + SHEET_PAD))
    // Fewer pictures than columns: no empty columns.
    expect(sheetLayout(2, { columns: 5, thumbWidth: 100, names: false }).width).toBe(SHEET_PAD + 2 * 112)
  })
  it('knows how many pictures fit', () => {
    const n = sheetCapacity(DEFAULT_SHEET)
    expect(sheetLayout(n, DEFAULT_SHEET).height).toBeLessThanOrEqual(MAX_SHEET_SIDE)
    expect(sheetLayout(n + DEFAULT_SHEET.columns, DEFAULT_SHEET).height).toBeGreaterThan(MAX_SHEET_SIDE)
  })
  it('shortens names in the middle', () => {
    expect(shortName('short.jpg', 20)).toBe('short.jpg')
    const s = shortName('a-very-long-file-name-from-camera.jpg', 16)
    expect(s.length).toBe(16)
    expect(s.endsWith('.jpg')).toBe(true)
  })
})
