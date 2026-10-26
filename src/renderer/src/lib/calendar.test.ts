import { describe, expect, it } from 'vitest'
import { isoWeek, monthGrid, sameDay, weekStart } from './calendar'

describe('calendar', () => {
  it('computes ISO week numbers', () => {
    expect(isoWeek(new Date(2026, 9, 8))).toBe(41)
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1) // Thursday
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53) // Friday belongs to 2026-W53
    expect(isoWeek(new Date(2024, 11, 30))).toBe(1) // Monday of 2025-W01
  })

  it('builds a six-week grid starting on Monday', () => {
    const weeks = monthGrid(2026, 9, 1) // October 2026 starts on Thursday
    expect(weeks).toHaveLength(6)
    expect(weeks[0].days[0].date).toEqual(new Date(2026, 8, 28))
    expect(weeks[0].days[0].inMonth).toBe(false)
    expect(weeks[0].days[3]).toEqual({ date: new Date(2026, 9, 1), inMonth: true })
    expect(weeks[0].number).toBe(40)
    expect(weeks.flatMap((w) => w.days).filter((d) => d.inMonth)).toHaveLength(31)
  })

  it('builds a grid starting on Sunday', () => {
    const weeks = monthGrid(2026, 1, 0) // February 2026 starts on Sunday
    expect(weeks[0].days[0]).toEqual({ date: new Date(2026, 1, 1), inMonth: true })
    expect(weeks[0].number).toBe(6) // the row's Monday is 2 Feb
  })

  it('wraps months across years', () => {
    const weeks = monthGrid(2026, 12, 1) // = January 2027
    expect(weeks[0].days.find((d) => d.inMonth)!.date).toEqual(new Date(2027, 0, 1))
  })

  it('knows the first weekday of a locale', () => {
    expect(weekStart('cs-CZ')).toBe(1)
    expect(weekStart('en-US')).toBe(0)
    expect(sameDay(new Date(2026, 9, 8, 23, 59), new Date(2026, 9, 8, 0, 0))).toBe(true)
  })
})
