import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { locale, t } from '@shared/i18n'
import { monthGrid, sameDay, weekStart } from '../lib/calendar'

const capitalize = (s: string): string => s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1)

/** Current time, re-rendered at every minute boundary (or second, for a live seconds display). */
function useNow(precision: 'minute' | 'second'): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const unit = precision === 'second' ? 1000 : 60_000
    const tick = (): void => {
      const d = new Date()
      setNow(d)
      timer = window.setTimeout(tick, unit - (d.getTime() % unit) + 20)
    }
    tick()
    // Timers are throttled while hidden and stop during sleep – catch up when the window comes back.
    const wake = (): void => {
      window.clearTimeout(timer)
      tick()
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [precision])
  return now
}

/** Status bar clock like the XP tray: date and time, click for a month calendar. */
export function Clock(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const now = useNow('minute')
  const loc = locale()
  const date = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }).format(now)
  const time = new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit' }).format(now)
  const long = capitalize(new Intl.DateTimeFormat(loc, { dateStyle: 'full' }).format(now))

  return (
    <>
      <div
        ref={ref}
        className={`status-field status-clock${open ? ' open' : ''}`}
        title={long}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="clock-date">{date}</span>
        <span className="clock-time">{time}</span>
      </div>
      {open && <CalendarPopup anchor={ref.current!} onClose={() => setOpen(false)} />}
    </>
  )
}

function CalendarPopup({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const now = useNow('second')
  const [view, setView] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }))
  const [pos, setPos] = useState({ right: 4, bottom: 28 })
  const loc = locale()
  const firstDay = weekStart(loc)
  const weeks = monthGrid(view.year, view.month, firstDay)
  const shown = new Date(view.year, view.month, 1)
  const isCurrentMonth = view.year === now.getFullYear() && view.month === now.getMonth()

  // Open above the clock, right-aligned with it.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    setPos({ right: Math.max(4, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 2 })
  }, [anchor])

  useEffect(() => {
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && (ref.current?.contains(e.target as Node) || anchor.contains(e.target as Node))) return
      if (e instanceof KeyboardEvent) e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', onClose)
    }
  }, [anchor, onClose])

  const step = (delta: number): void => setView((v) => ({ year: v.year + Math.floor((v.month + delta) / 12), month: (((v.month + delta) % 12) + 12) % 12 }))
  const weekdays = weeks[0].days.map((d) => new Intl.DateTimeFormat(loc, { weekday: 'narrow' }).format(d.date))

  return (
    <div
      ref={ref}
      className="context-menu calendar"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => step(e.deltaY > 0 ? 1 : -1)}
    >
      <div className="calendar-now">
        <div className="calendar-time">{new Intl.DateTimeFormat(loc, { timeStyle: 'medium' }).format(now)}</div>
        <div className="calendar-date">{capitalize(new Intl.DateTimeFormat(loc, { dateStyle: 'full' }).format(now))}</div>
      </div>
      <div className="calendar-head">
        <button className="calendar-nav" title={t('calendar.prevMonth')} onClick={() => step(-1)}>
          ‹
        </button>
        <span className="calendar-month">{capitalize(new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(shown))}</span>
        <button className="calendar-nav" title={t('calendar.nextMonth')} onClick={() => step(1)}>
          ›
        </button>
      </div>
      <table className="calendar-grid">
        <thead>
          <tr>
            <th className="calendar-week" title={t('calendar.weekTitle')}>
              {t('calendar.week')}
            </th>
            {weekdays.map((w, i) => (
              <th key={i}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.days[0].date.getTime()}>
              <td className="calendar-week">{week.number}</td>
              {week.days.map(({ date, inMonth }) => (
                <td
                  key={date.getDate()}
                  className={[!inMonth && 'other', sameDay(date, now) && 'today', (date.getDay() === 0 || date.getDay() === 6) && 'weekend']
                    .filter(Boolean)
                    .join(' ')}
                  title={capitalize(new Intl.DateTimeFormat(loc, { dateStyle: 'full' }).format(date))}
                >
                  {date.getDate()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="calendar-foot">
        <button className="calendar-today" disabled={isCurrentMonth} onClick={() => setView({ year: now.getFullYear(), month: now.getMonth() })}>
          {t('calendar.today')}
        </button>
      </div>
    </div>
  )
}
