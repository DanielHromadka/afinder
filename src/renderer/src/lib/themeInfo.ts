// The status bar's theme field: one short, playful fact per theme, from the folder or the machine.

import { locale, t } from '@shared/i18n'
import type { BtcQuote, FileEntry, SystemInfo, ThemeId } from '@shared/types'
import { formatSize } from './format'

/** What a theme's field needs: machine stats or only the folder's entries; Bitcoin shows its price in the title bar. */
export type ThemeSource = 'system' | 'entries' | 'none'

export const THEME_SOURCE: Record<ThemeId, ThemeSource> = {
  xp: 'system',
  apple: 'system',
  classic: 'system',
  cyberpunk: 'system',
  fbi: 'entries',
  jarvis: 'system',
  barbie: 'entries',
  batman: 'entries',
  bitcoin: 'none',
  matrix: 'system',
  dos: 'system'
}

export interface ThemeInfoInput {
  entries: FileEntry[]
  system: SystemInfo | null
  now: number
}

export interface ThemeInfoText {
  text: string
  title: string
}

/** Things that run or install something. */
const SUSPECT = /\.(exe|msi|bat|cmd|com|ps1|vbs|scr|sh|command|dmg|pkg|deb|rpm|appimage|apk|jar)$/i

export const isSuspect = (e: FileEntry): boolean => e.kind === 'app' || (!e.isDir && SUSPECT.test(e.name))

/** 0.42 → "42 %" in Czech, "42%" in English. */
const percent = (share: number): string => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(share)

/** 273600 s → "3 d 4 h", 4500 s → "1 h 15 min". */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

/** The field's text, or null while its data is not there yet (or does not apply here). */
export function themeInfo(theme: ThemeId, input: ThemeInfoInput): ThemeInfoText | null {
  const { entries, system: s } = input
  const diskUsed = s && s.diskFree !== null && s.diskTotal ? 1 - s.diskFree / s.diskTotal : null
  const mem = s ? s.memUsed / s.memTotal : null
  switch (theme) {
    case 'xp':
    case 'classic': {
      if (!s || s.diskFree === null || diskUsed === null) return null
      const free = formatSize(s.diskFree)
      return { text: t('themeInfo.freeSpace', { size: free }), title: t('themeInfo.freeSpaceTitle', { size: free, total: formatSize(s.diskTotal!), used: percent(diskUsed) }) }
    }
    case 'apple': {
      if (!s || s.diskFree === null) return null
      const free = formatSize(s.diskFree)
      return { text: t('themeInfo.available', { size: free }), title: t('themeInfo.freeSpaceTitle', { size: free, total: formatSize(s.diskTotal!), used: percent(diskUsed!) }) }
    }
    case 'cyberpunk': {
      if (!s) return null
      const cpu = s.cpu === null ? '–' : percent(s.cpu)
      return { text: `UPTIME ${formatUptime(s.uptime)} · CPU ${cpu}`, title: t('themeInfo.systemTitle') }
    }
    case 'jarvis': {
      if (!s || mem === null) return null
      const parts = [`CPU ${s.cpu === null ? '–' : percent(s.cpu)}`, `RAM ${percent(mem)}`]
      if (diskUsed !== null) parts.push(`${t('themeInfo.disk')} ${percent(diskUsed)}`)
      return { text: parts.join(' · '), title: t('themeInfo.systemTitle') }
    }
    case 'matrix': {
      if (!s) return null
      const operator = s.user ? `${s.user}@${s.host}` : s.host
      return { text: t('themeInfo.operator', { operator }), title: t('themeInfo.operatorTitle') }
    }
    case 'dos': {
      if (!s || s.diskFree === null) return null
      // The last line of DIR: "1 234 567 890 bytes free", grouped the way the language writes numbers.
      const bytes = new Intl.NumberFormat(locale()).format(s.diskFree)
      return { text: t('themeInfo.bytesFree', { bytes }), title: t('themeInfo.freeSpaceTitle', { size: formatSize(s.diskFree), total: formatSize(s.diskTotal!), used: percent(diskUsed!) }) }
    }
    case 'bitcoin':
      return null
    case 'fbi': {
      const files = entries.filter((e) => !e.isDir)
      if (files.length === 0) return { text: t('themeInfo.noActivity'), title: t('themeInfo.activityTitle') }
      const last = files.reduce((a, b) => (b.modified > a.modified ? b : a))
      return { text: t('themeInfo.lastActivity', { name: last.name, ago: formatAgo(input.now - last.modified) }), title: t('themeInfo.activityTitle') }
    }
    case 'barbie': {
      const n = entries.filter((e) => e.kind === 'image').length
      return { text: t('themeInfo.photos', { n }), title: t('themeInfo.photosTitle') }
    }
    case 'batman': {
      const n = entries.filter(isSuspect).length
      return { text: n ? t('themeInfo.suspects', { n }) : t('themeInfo.noSuspects'), title: t('themeInfo.suspectsTitle') }
    }
  }
}

/** Rough age: "5 min", "3 h", "12 d". */
export function formatAgo(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** The Bitcoin theme's ticker: "$62,346" and "▲ 3.2 % 7d", with the direction for its colour. */
export function formatBtc(q: BtcQuote): { price: string; change: string | null; trend: 'up' | 'down' | 'flat' } {
  const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(q.price)
  if (q.change7d === null) return { price, change: null, trend: 'flat' }
  // Below a twentieth of a percent it rounds to 0.0 – no arrow and no colour for that.
  const trend = Math.abs(q.change7d) < 0.05 ? 'flat' : q.change7d > 0 ? 'up' : 'down'
  const value = new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(trend === 'flat' ? 0 : q.change7d / 100)
  return { price, change: `${trend === 'up' ? '▲' : trend === 'down' ? '▼' : '•'} ${value} 7d`, trend }
}
