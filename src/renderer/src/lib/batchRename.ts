// Batch rename: new names from a pattern, and what is wrong with them – before anything is touched.

import { localIso } from '@shared/media'

/** 'ai': names suggested by an AI agent, passed to newNames(); 'date': from the date taken (or modified). */
export type RenameMode = 'replace' | 'add' | 'format' | 'date' | 'ai'
export type CaseChange = 'none' | 'lower' | 'upper' | 'title'

export interface RenameOptions {
  mode: RenameMode
  /** replace: text (or regular expression) to find and what to put instead. */
  find: string
  replace: string
  regex: boolean
  matchCase: boolean
  /** add: text put before or after the name. */
  text: string
  position: 'before' | 'after'
  /** format: base name followed (or preceded) by a running number. */
  base: string
  start: number
  digits: number
  /** date: tokens YYYY YY MM DD HH mm ss and {name}; files without a date taken use the modification date when dateFallback is on. */
  datePattern: string
  dateFallback: boolean
  /** Applied last, to the name without the extension when it is kept. */
  caseChange: CaseChange
  keepExtension: boolean
}

export const DEFAULT_OPTIONS: RenameOptions = {
  mode: 'replace',
  find: '',
  replace: '',
  regex: false,
  matchCase: false,
  text: '',
  position: 'after',
  base: '',
  start: 1,
  digits: 2,
  datePattern: 'YYYY-MM-DD HH.mm.ss',
  dateFallback: true,
  caseChange: 'none',
  keepExtension: true
}

export type RenameProblem = 'empty' | 'invalid' | 'duplicate' | 'exists' | 'regex'

/** "report.final.pdf" → ["report.final", ".pdf"]; dot files and folders keep their whole name. */
export function splitName(name: string, isDir: boolean): [string, string] {
  if (isDir) return [name, '']
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

function changeCase(s: string, c: CaseChange, locale?: string): string {
  switch (c) {
    case 'lower':
      return s.toLocaleLowerCase(locale)
    case 'upper':
      return s.toLocaleUpperCase(locale)
    case 'title':
      return s.toLocaleLowerCase(locale).replace(/(^|[\s_\-.(])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase(locale))
    default:
      return s
  }
}

/** Throws for an invalid regular expression (shown as a problem by the dialog). */
export function compileFind(o: RenameOptions): RegExp | null {
  if (o.find === '') return null
  const source = o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(source, o.matchCase ? 'g' : 'gi')
}

/** Fills the pattern's date tokens from `YYYY-MM-DDTHH:MM:SS` and {name} with the original name. */
export function dateName(pattern: string, iso: string, stem: string): string {
  const [Y, M, D, h, m, sec] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10), iso.slice(11, 13), iso.slice(14, 16), iso.slice(17, 19)]
  const tokens: Record<string, string> = { YYYY: Y, YY: Y.slice(2), MM: M, DD: D, HH: h, mm: m, ss: sec }
  return pattern.replace(/\{name\}|YYYY|YY|MM|DD|HH|mm|ss/g, (x) => (x === '{name}' ? stem : tokens[x]))
}

/**
 * New names for the items. `suggested` are the AI's names; `dates` the dates taken (`YYYY-MM-DDTHH:MM:SS`
 * or null) in item order for the date mode, where photos taken in the same second get `-2`, `-3` …
 */
export function newNames(items: { name: string; isDir: boolean; modified?: number }[], o: RenameOptions, locale?: string, suggested?: readonly string[], dates?: readonly (string | null)[]): string[] {
  const used = new Map<string, number>()
  let find: RegExp | null = null
  if (o.mode === 'replace') {
    try {
      find = compileFind(o)
    } catch {
      return items.map((i) => i.name) // shown as a regex problem instead
    }
  }
  return items.map((item, index) => {
    const [stem, ext] = o.keepExtension ? splitName(item.name, item.isDir) : [item.name, '']
    let name = stem
    if (o.mode === 'replace' && find) name = stem.replace(find, o.replace)
    else if (o.mode === 'add') name = o.position === 'before' ? o.text + stem : stem + o.text
    else if (o.mode === 'ai') {
      // A suggestion that changed the extension keeps the original one when extensions are kept.
      const s = suggested?.[index]?.trim()
      if (s) name = o.keepExtension ? splitName(s, item.isDir)[0] : s
    } else if (o.mode === 'format') {
      const n = String(Math.max(0, Math.floor(o.start)) + index).padStart(Math.max(1, Math.min(9, Math.floor(o.digits))), '0')
      name = o.base === '' ? n : o.position === 'before' ? `${n} ${o.base}` : `${o.base} ${n}`
    } else if (o.mode === 'date') {
      const iso = dates?.[index] ?? (o.dateFallback && item.modified ? localIso(item.modified) : null)
      if (iso && o.datePattern.trim()) {
        name = dateName(o.datePattern, iso, stem)
        const key = (name + ext).toLowerCase()
        const n = (used.get(key) ?? 0) + 1
        used.set(key, n)
        if (n > 1) name = `${name}-${n}`
      }
    }
    return changeCase(name, o.caseChange, locale) + ext
  })
}

const INVALID_POSIX = /[/\0]/
const INVALID_WINDOWS = /[/\\:*?"<>|\0]|[. ]$/

/**
 * Problems per item (null = fine). Names are compared case-insensitively, as on the default macOS and
 * Windows file systems; `others` are the names in the folder that are not being renamed.
 */
export function problems(oldNames: string[], names: string[], others: Iterable<string>, platform: string): (RenameProblem | null)[] {
  const invalid = platform === 'win32' ? INVALID_WINDOWS : INVALID_POSIX
  const key = (s: string): string => s.normalize('NFC').toLowerCase()
  const taken = new Set([...others].map(key))
  const counts = new Map<string, number>()
  for (const n of names) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1)
  return names.map((n, i) => {
    if (n.trim() === '' || n === '.' || n === '..') return 'empty'
    if (invalid.test(n)) return 'invalid'
    if (counts.get(key(n))! > 1) return 'duplicate'
    if (key(n) !== key(oldNames[i]) && taken.has(key(n))) return 'exists'
    return null
  })
}
