import { useEffect, useMemo, useState } from 'react'
import type { BtcQuote, FileEntry, SystemInfo, ThemeId } from '@shared/types'
import { THEME_SOURCE, themeInfo, type ThemeInfoText } from './themeInfo'

const SYSTEM_EVERY = 3_000
/** Ages like "before 5 min" go stale while the folder stays the same. */
const CLOCK_EVERY = 60_000

/** The theme field for the status bar; polls only what the active theme needs, and only while enabled. */
export function useThemeInfo(theme: ThemeId, enabled: boolean, path: string, entries: FileEntry[]): ThemeInfoText | null {
  const source = THEME_SOURCE[theme]
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled || source !== 'system') return
    let live = true
    const poll = (): void => {
      window.api.systemInfo(path).then((info) => live && setSystem(info), () => live && setSystem(null))
    }
    poll()
    const timer = setInterval(poll, SYSTEM_EVERY)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [enabled, source, path])

  useEffect(() => {
    if (!enabled || source !== 'entries') return
    const timer = setInterval(() => setNow(Date.now()), CLOCK_EVERY)
    return () => clearInterval(timer)
  }, [enabled, source])

  return useMemo(
    () => (enabled ? themeInfo(theme, { entries, system, now: Math.max(now, Date.now()) }) : null),
    [enabled, theme, entries, system, now]
  )
}

const BTC_EVERY = 5 * 60_000

/** The Bitcoin theme's quote, polled only while that theme and its info field are on (it contacts CoinGecko). */
export function useBtcQuote(enabled: boolean): BtcQuote | null {
  const [quote, setQuote] = useState<BtcQuote | null>(null)
  useEffect(() => {
    if (!enabled) return setQuote(null)
    let live = true
    const poll = (): void => void window.api.btcPrice().then((q) => live && q && setQuote(q), () => {})
    poll()
    const timer = setInterval(poll, BTC_EVERY)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [enabled])
  return quote
}
