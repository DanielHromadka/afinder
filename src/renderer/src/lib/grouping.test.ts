import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '@shared/i18n'
import type { FileEntry } from '@shared/types'
import { compareGroups, groupOf } from './grouping'

const entry = (name: string, modified: number, extra: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/x/${name}`,
  isDir: false,
  isSymlink: false,
  hidden: false,
  kind: 'other',
  size: 10,
  modified,
  ...extra
})

const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime()
const sizeOf = (e: FileEntry): number => e.size ?? 0

describe('groupOf', () => {
  it('groups by year and month', () => {
    expect(groupOf(entry('a', at(2025, 3, 4)), 'year', 0, sizeOf).label).toBe('2025')
    expect(groupOf(entry('a', at(2025, 3, 4)), 'month', 0, sizeOf).label).toBe('Březen 2025')
  })

  it('uses ISO weeks, including the turn of the year', () => {
    expect(groupOf(entry('a', at(2026, 10, 8)), 'week', 0, sizeOf).key).toBe('w2026-41')
    // 1 Jan 2027 is a Friday – it belongs to week 53 of 2026.
    expect(groupOf(entry('a', at(2027, 1, 1)), 'week', 0, sizeOf).key).toBe('w2026-53')
    expect(groupOf(entry('a', at(2026, 10, 5)), 'week', 0, sizeOf).key).toBe(groupOf(entry('b', at(2026, 10, 11)), 'week', 0, sizeOf).key)
  })

  it('labels today and yesterday', () => {
    const now = at(2026, 10, 8, 9)
    expect(groupOf(entry('a', at(2026, 10, 8, 1)), 'day', now, sizeOf).label).toBe('Dnes')
    expect(groupOf(entry('a', at(2026, 10, 7, 23)), 'day', now, sizeOf).label).toBe('Včera')
  })

  it('groups by extension, folders and extension-less files separately', () => {
    expect(groupOf(entry('Report.PDF', 0), 'extension', 0, sizeOf).label).toBe('.pdf')
    expect(groupOf(entry('Makefile', 0), 'extension', 0, sizeOf).label).toBe('Bez přípony')
    expect(groupOf(entry('src', 0, { isDir: true, size: null }), 'extension', 0, sizeOf).label).toBe('Složky')
  })

  it('buckets sizes', () => {
    const g = (size: number): string => groupOf(entry('f', 0, { size }), 'size', 0, sizeOf).label
    expect(g(0)).toBe('Prázdné (0 B)')
    expect(g(1000)).toBe('Drobné (< 16 KB)')
    expect(g(500_000)).toBe('Malé (< 1 MB)')
    expect(g(5 * 1024 ** 3)).toBe('Obrovské (≥ 1 GB)')
  })

  it('localizes labels', () => {
    setLanguage('es')
    expect(groupOf(entry('a', at(2025, 3, 4)), 'month', 0, sizeOf).label).toBe('Marzo de 2025')
    expect(groupOf(entry('Makefile', 0), 'extension', 0, sizeOf).label).toBe('Sin extensión')
    setLanguage('en')
    expect(groupOf(entry('a', at(2026, 10, 8, 1)), 'day', at(2026, 10, 8, 9), sizeOf).label).toBe('Today')
  })

  afterEach(() => setLanguage('cs'))

  it('orders groups', () => {
    const small = groupOf(entry('f', 0, { size: 1 }), 'size', 0, sizeOf)
    const big = groupOf(entry('f', 0, { size: 2 * 1024 ** 3 }), 'size', 0, sizeOf)
    expect(compareGroups(small, big)).toBeLessThan(0)
  })
})
