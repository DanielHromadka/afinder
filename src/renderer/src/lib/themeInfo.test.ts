import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '@shared/i18n'
import { THEMES, type FileEntry, type SystemInfo } from '@shared/types'
import { formatAgo, formatBtc, formatUptime, isSuspect, THEME_SOURCE, themeInfo } from './themeInfo'

const nbsp = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ')

const entry = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/x/${name}`,
  isDir: false,
  isSymlink: false,
  hidden: false,
  kind: 'other',
  size: 1,
  modified: 0,
  ...extra
})

const GB = 1024 ** 3
const system: SystemInfo = {
  cpu: 0.25,
  memUsed: 6 * GB,
  memTotal: 8 * GB,
  uptime: 3 * 86400 + 4 * 3600,
  user: 'neo',
  host: 'nebuchadnezzar',
  diskFree: 30 * GB,
  diskTotal: 100 * GB
}

const input = { entries: [], system, now: 0 }

afterEach(() => setLanguage('cs'))

describe('themeInfo', () => {
  it('has a source for every theme', () => {
    for (const theme of THEMES) expect(THEME_SOURCE[theme.id]).toBeDefined()
  })

  it('waits for its data', () => {
    expect(themeInfo('xp', { ...input, system: null })).toBeNull()
    expect(themeInfo('bitcoin', input)).toBeNull()
  })

  it('shows disk and system stats', () => {
    expect(themeInfo('xp', input)?.text).toBe('Volné místo: 30 GB')
    expect(nbsp(themeInfo('jarvis', input)!.text)).toBe('CPU 25 % · RAM 75 % · Disk 70 %')
    expect(themeInfo('cyberpunk', input)?.text).toMatch(/^UPTIME 3 d 4 h · CPU/)
    expect(themeInfo('matrix', input)?.text).toBe('Operátor: neo@nebuchadnezzar')
    expect(nbsp(themeInfo('dos', input)!.text)).toBe(`${nbsp(new Intl.NumberFormat('cs').format(system.diskFree!))} bajtů volných`)
  })

  it('formats the BTC price in dollars', () => {
  })

  it('reads facts from the folder', () => {
    const entries = [
      entry('.env'),
      entry('id_ed25519'),
      entry('id_ed25519.pub'),
      entry('photo.jpg', { kind: 'image', modified: 1000 }),
      entry('setup.exe', { modified: 5 }),
      entry('src', { isDir: true, kind: 'folder', modified: 9_999_999 })
    ]
    const now = 1000 + 5 * 60_000
    expect(themeInfo('barbie', { ...input, entries })?.text).toBe('✨ Obrázky: 1')
    expect(themeInfo('batman', { ...input, entries })?.text).toBe('Podezřelé: 1')
    expect(themeInfo('fbi', { ...input, entries, now })?.text).toBe('Poslední aktivita: photo.jpg (před 5 min)')
    expect(themeInfo('fbi', input)?.text).toBe('Žádná aktivita')
  })

  it('follows the language', () => {
    setLanguage('en')
    expect(themeInfo('xp', input)?.text).toBe('Free space: 30 GB')
    expect(themeInfo('jarvis', input)?.text).toBe('CPU 25% · RAM 75% · Disk 70%')
  })
})

describe('helpers', () => {
  it('recognises sensitive files but not public keys', () => {
  })

  it('recognises programs and installers', () => {
    expect(isSuspect(entry('install.sh'))).toBe(true)
    expect(isSuspect(entry('Tool.app', { isDir: true, kind: 'app' }))).toBe(true)
    expect(isSuspect(entry('notes.txt'))).toBe(false)
  })

  it('formats uptime and age', () => {
    expect(formatUptime(4500)).toBe('1 h 15 min')
    expect(formatUptime(59)).toBe('0 min')
    expect(formatAgo(3 * 3600_000)).toBe('3 h')
    expect(formatAgo(5 * 86400_000)).toBe('5 d')
  })
})

describe('formatBtc', () => {
  const nbsp = (s: string | null): string | null => s && s.replace(/\u00a0/g, ' ')
  it('shows the price and the seven-day change with its direction', () => {
    expect(formatBtc({ price: 62345.6, change7d: 3.21 })).toMatchObject({ price: '$62,346', trend: 'up' })
    expect(nbsp(formatBtc({ price: 1, change7d: 3.21 }).change)).toMatch(/^▲ \+3,2 % 7d$/)
    expect(nbsp(formatBtc({ price: 1, change7d: -4.56 }).change)).toMatch(/^▼ [−-]4,6 % 7d$/)
    expect(formatBtc({ price: 1, change7d: 0.01 }).trend).toBe('flat')
    expect(formatBtc({ price: 1, change7d: null })).toEqual({ price: '$1', change: null, trend: 'flat' })
  })
})
