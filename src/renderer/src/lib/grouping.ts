// Grouping of file list rows into "virtual folders" by date, kind, extension or size.

import { t, type MessageKey } from '@shared/i18n'
import type { FileEntry, FileKind, GroupBy } from '@shared/types'
import { dateFormat } from './format'

export interface Group {
  key: string
  label: string
  /** Groups are ordered by this value (ascending before the direction is applied). */
  order: number | string
  /** Always listed first, whatever the direction (the folders group). */
  pinned?: boolean
}

export const groupByLabel = (by: GroupBy): string => t(`group.by.${by}` as MessageKey)

/** Sort column that corresponds to a grouping; clicking it reverses the group order too. */
export const GROUP_SORT_KEY: Record<GroupBy, 'modified' | 'kind' | 'size' | null> = {
  none: null,
  year: 'modified',
  month: 'modified',
  week: 'modified',
  day: 'modified',
  kind: 'kind',
  extension: 'kind',
  size: 'size'
}

/** Newest dates and biggest sizes first unless the list is sorted by that column. */
export const GROUP_DEFAULT_ASC: Record<GroupBy, boolean> = {
  none: true,
  year: false,
  month: false,
  week: false,
  day: false,
  kind: true,
  extension: true,
  size: false
}

const KIND_GROUPS: FileKind[] = ['folder', 'app', 'document', 'pdf', 'text', 'code', 'image', 'audio', 'video', 'archive', 'other']

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024
/** Upper limits of the size buckets; labels are group.size.<index>. */
const SIZE_LIMITS = [0, 16 * KB, MB, 100 * MB, GB, Infinity]

const monthFmt = (): Intl.DateTimeFormat => dateFormat('month', { month: 'long', year: 'numeric' })
const dayFmt = (): Intl.DateTimeFormat => dateFormat('day', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })
const shortFmt = (): Intl.DateTimeFormat => dateFormat('short', { day: 'numeric', month: 'numeric' })
const fullFmt = (): Intl.DateTimeFormat => dateFormat('date', { day: 'numeric', month: 'numeric', year: 'numeric' })
const capitalize = (s: string): string => s[0].toLocaleUpperCase() + s.slice(1)

const DAY_MS = 86_400_000
const startOfDay = (ms: number): Date => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Monday of the ISO week and the ISO week number. */
function isoWeek(ms: number): { monday: Date; week: number; year: number } {
  const monday = startOfDay(ms)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  // The ISO year is the year of that week's Thursday.
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3)
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
  return { monday, week, year: thursday.getFullYear() }
}

/**
 * Returns the group an entry belongs to. `sizeOf` gives the (possibly computed) size; folders are
 * kept in their own group for size and extension grouping since their size may still be changing.
 */
export function groupOf(entry: FileEntry, by: GroupBy, now: number, sizeOf: (e: FileEntry) => number): Group {
  const time = entry.modified
  switch (by) {
    case 'none':
      return { key: '', label: '', order: 0 }
    case 'year': {
      const y = new Date(time).getFullYear()
      return { key: `y${y}`, label: String(y), order: y }
    }
    case 'month': {
      const d = new Date(time)
      return { key: `m${d.getFullYear()}-${d.getMonth()}`, label: capitalize(monthFmt().format(d)), order: d.getFullYear() * 12 + d.getMonth() }
    }
    case 'week': {
      const { monday, week, year } = isoWeek(time)
      const sunday = new Date(monday.getTime() + 6 * DAY_MS)
      return {
        key: `w${year}-${week}`,
        label: t('group.week', { week, year, from: shortFmt().format(monday), to: fullFmt().format(sunday) }),
        order: monday.getTime()
      }
    }
    case 'day': {
      const day = startOfDay(time).getTime()
      const today = startOfDay(now).getTime()
      const label = day === today ? t('group.today') : day === today - DAY_MS ? t('group.yesterday') : dayFmt().format(day)
      return { key: `d${day}`, label: capitalize(label), order: day }
    }
    case 'kind': {
      const kind: FileKind = entry.isDir ? 'folder' : entry.kind
      return { key: `k${kind}`, label: t(`group.kind.${kind}` as MessageKey), order: KIND_GROUPS.indexOf(kind), pinned: kind === 'folder' }
    }
    case 'extension': {
      if (entry.isDir) return { key: 'x/', label: t('group.folders'), order: '', pinned: true }
      const dot = entry.name.lastIndexOf('.')
      const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : ''
      return ext ? { key: `x${ext}`, label: `.${ext}`, order: ext } : { key: 'x', label: t('group.noExtension'), order: '\uffff' }
    }
    case 'size': {
      if (entry.isDir) return { key: 's/', label: t('group.folders'), order: -1, pinned: true }
      const bytes = sizeOf(entry)
      const index = SIZE_LIMITS.findIndex((limit, i) => (i === 0 ? bytes === 0 : bytes < limit))
      return { key: `s${index}`, label: t(`group.size.${index}` as MessageKey), order: index }
    }
  }
}

/** Compares by `order`; pinned groups are handled by the caller since they ignore the direction. */
export function compareGroups(a: Group, b: Group): number {
  if (typeof a.order === 'number' && typeof b.order === 'number') return a.order - b.order
  return String(a.order).localeCompare(String(b.order))
}
