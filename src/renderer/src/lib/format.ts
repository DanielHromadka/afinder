import { locale, plural } from '@shared/i18n'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** Intl formatters are not cheap to create – keep one per locale and options. */
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>()
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(key: string, make: (loc: string) => T): T {
  const k = `${locale()}|${key}`
  let f = cache.get(k) as T | undefined
  if (!f) cache.set(k, (f = make(locale())))
  return f
}

export const numberFormat = (digits: number): Intl.NumberFormat =>
  cached(`n${digits}`, (l) => new Intl.NumberFormat(l, { maximumFractionDigits: digits }))

export const dateFormat = (name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
  cached(`d${name}`, (l) => new Intl.DateTimeFormat(l, options))

/** 1536 → "1,5 KB" in Czech, "1.5 KB" in English (binary units). */
export function formatSize(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${numberFormat(unit === 0 || value >= 100 ? 0 : 1).format(value)} ${UNITS[unit]}`
}

export function formatDate(ms: number): string {
  return dateFormat('full', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms)
}

const RELATIVE: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12]]

/** "před 3 dny" / "3 days ago": the largest unit that fits, rounded. */
export function formatRelative(ms: number, now = Date.now()): string {
  const f = cached('rel', (l) => new Intl.RelativeTimeFormat(l, { numeric: 'auto' }))
  let value = (ms - now) / 1000
  for (const [unit, size] of RELATIVE) {
    if (Math.abs(value) < size) return f.format(Math.round(value), unit)
    value /= size
  }
  return f.format(Math.round(value), 'year')
}

/** "1 objekt", "3 objekty", "12 objektů" / "1 item", "12 items" … */
export function formatCount(n: number): string {
  return plural('count.items', n, { n: numberFormat(0).format(n) })
}
