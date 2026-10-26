// Month grid for the status bar calendar: whole weeks, ISO week numbers, locale-aware first weekday.

export interface CalendarDay {
  date: Date
  /** Belongs to the shown month (the rest pads the first and last week). */
  inMonth: boolean
}

export interface CalendarWeek {
  /** ISO 8601 week number of the week's Thursday-anchored year. */
  number: number
  days: CalendarDay[]
}

/** First day of the week for a locale: 0 = Sunday, 1 = Monday … (Monday when the runtime cannot tell). */
export function weekStart(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?(): { firstDay: number }; weekInfo?: { firstDay: number } }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info) return info.firstDay % 7 // Intl uses 1–7 with 7 = Sunday
  } catch {
    // unknown locale – fall through
  }
  return 1
}

/** ISO 8601 week number: weeks start on Monday, week 1 contains the year's first Thursday. */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)) // Thursday of this week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.floor((d.getTime() - yearStart) / 86_400_000 / 7) + 1
}

/** Always six weeks, so the popup keeps its height while paging through months. */
export function monthGrid(year: number, month: number, firstDay: number): CalendarWeek[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() - firstDay + 7) % 7
  const weeks: CalendarWeek[] = []
  for (let w = 0; w < 6; w++) {
    const days: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(year, month, 1 - offset + w * 7 + d)
      days.push({ date, inMonth: date.getMonth() === ((month % 12) + 12) % 12 })
    }
    // The Monday of the row decides the ISO week, whichever weekday the row starts on.
    weeks.push({ number: isoWeek(days.find((x) => x.date.getDay() === 1)!.date), days })
  }
  return weeks
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
