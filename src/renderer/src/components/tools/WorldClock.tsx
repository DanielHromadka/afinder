import { useEffect, useState } from 'react'
import { locale, t } from '@shared/i18n'
import { useStored, type ToolProps } from './common'

const ZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
})()
const city = (zone: string): string => zone.split('/').pop()!.replace(/_/g, ' ')

/** Minutes the zone is ahead of this computer at `when`. */
function offset(zone: string, when: Date): number {
  const inZone = new Date(when.toLocaleString('en-US', { timeZone: zone }))
  const here = new Date(when.toLocaleString('en-US'))
  return Math.round((inZone.getTime() - here.getTime()) / 60_000)
}

/** Clocks for the time zones the user added. */
export default function WorldClock({ visible }: Pick<ToolProps, 'visible'>): React.JSX.Element {
  const [zones, setZones] = useStored<string[]>('clock.zones', ['Europe/London', 'America/New_York', 'Asia/Tokyo'])
  const [adding, setAdding] = useState('')
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [visible])

  const add = (): void => {
    const zone = ZONES.find((z) => z.toLowerCase() === adding.trim().toLowerCase() || city(z).toLowerCase() === adding.trim().toLowerCase())
    if (zone && !zones.includes(zone)) setZones([...zones, zone])
    setAdding('')
  }
  const time = (zone: string): string => new Intl.DateTimeFormat(locale(), { timeStyle: 'medium', timeZone: zone }).format(now)
  const day = (zone: string): string => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).format(now)

  return (
    <div className="tool">
      <div className="tool-row">
        <input className="tool-input grow" list="tools-zones" value={adding} placeholder={t('tools.addCity')} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <datalist id="tools-zones">
          {ZONES.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <button className="todo-btn" onClick={add}>
          {t('tools.add')}
        </button>
      </div>
      {zones.map((zone) => {
        const diff = offset(zone, now)
        return (
          <div key={zone} className="clock-row">
            <div>
              <div className="clock-city">{city(zone)}</div>
              <div className="tool-muted">
                {day(zone)} · {diff === 0 ? t('tools.sameTime') : `${diff > 0 ? '+' : '−'}${Math.floor(Math.abs(diff) / 60)}${Math.abs(diff) % 60 ? `:${String(Math.abs(diff) % 60).padStart(2, '0')}` : ''} h`}
              </div>
            </div>
            <div className="clock-time">{time(zone)}</div>
            <button className="todo-chip-x" title={t('tools.remove')} onClick={() => setZones(zones.filter((z) => z !== zone))}>
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
