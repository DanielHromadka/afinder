import { useState } from 'react'
import { getLanguage, locale, t } from '@shared/i18n'
import { Output, ToolError, useStored } from './common'

/** Unix seconds or milliseconds, ISO 8601, or anything Date understands. */
function parseTime(text: string): Date | null {
  const s = text.trim()
  if (!s) return null
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    // Up to 11 digits are seconds (until the year 5138), longer ones milliseconds.
    return new Date(Math.abs(n) < 1e11 ? n * 1000 : n)
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** ISO week number (weeks start on Monday, week 1 holds the first Thursday). */
function isoWeek(d: Date): number {
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7))
  const year = new Date(Date.UTC(day.getUTCFullYear(), 0, 1))
  return Math.ceil(((day.getTime() - year.getTime()) / 86_400_000 + 1) / 7)
}

function relative(ms: number): string {
  const rtf = new Intl.RelativeTimeFormat(getLanguage(), { numeric: 'auto' })
  const diff = (ms - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_556_952], ['month', 2_629_746], ['day', 86_400], ['hour', 3600], ['minute', 60], ['second', 1]]
  for (const [unit, secs] of steps) if (Math.abs(diff) >= secs || unit === 'second') return rtf.format(Math.round(diff / secs), unit)
  return ''
}

/** Intl lists only canonical zones, which leaves out UTC itself. */
const ZONES = (() => {
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')]
  } catch {
    return ['UTC']
  }
})()

/** One moment in every notation: Unix time, ISO, local, another time zone, relative, week number. */
export default function TimeTool(): React.JSX.Element {
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)))
  const [zone, setZone] = useStored('time.zone', 'UTC')
  const date = parseTime(input)
  const full = (tz?: string): string => (date ? new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeStyle: 'long', timeZone: tz }).format(date) : '')

  return (
    <div className="tool">
      <div className="tool-row">
        <input className="tool-input grow mono" value={input} spellCheck={false} placeholder="1760000000 · 2026-10-13T10:00:00Z" onChange={(e) => setInput(e.target.value)} />
        <button className="todo-btn" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>
          {t('tools.now')}
        </button>
      </div>
      {!date ? (
        <ToolError text={input.trim() ? t('tools.timeUnreadable') : null} />
      ) : (
        <>
          <Output label={t('tools.unixSeconds')} value={String(Math.floor(date.getTime() / 1000))} />
          <Output label={t('tools.unixMs')} value={String(date.getTime())} />
          <Output label="ISO 8601 (UTC)" value={date.toISOString()} />
          <Output label={t('tools.localTime')} value={full()} mono={false} />
          <Output label={t('tools.relative')} value={relative(date.getTime())} mono={false} />
          <Output label={t('tools.week')} value={`${isoWeek(date)}`} />
          <div className="tool-row">
            <select className="tool-input" value={zone} onChange={(e) => setZone(e.target.value)}>
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <Output label={zone} value={full(zone)} mono={false} />
        </>
      )}
    </div>
  )
}
