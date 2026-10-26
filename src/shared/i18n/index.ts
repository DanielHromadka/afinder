// Tiny i18n: one active language per process (main and each renderer), `{name}` interpolation,
// plural forms via Intl.PluralRules and platform variants of a message.

import { cs, type MessageKey } from './cs'
import { de } from './de'
import { en } from './en'
import { es } from './es'

export type { MessageKey }

export const LANGUAGES = [
  { id: 'cs', name: 'Čeština', locale: 'cs-CZ' },
  { id: 'en', name: 'English', locale: 'en-US' },
  { id: 'de', name: 'Deutsch', locale: 'de-DE' },
  { id: 'es', name: 'Español', locale: 'es-ES' }
] as const

export type Language = (typeof LANGUAGES)[number]['id']
export type LanguageSetting = Language | 'auto'
export type OsFamily = 'mac' | 'win' | 'linux'

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { cs, en, de, es }

let current: Language = 'cs'
let os: OsFamily = 'mac'

export function setLanguage(lang: Language): void {
  current = lang
}

export function getLanguage(): Language {
  return current
}

/** BCP 47 locale of the active language, for Intl formatters. */
export function locale(): string {
  return LANGUAGES.find((l) => l.id === current)!.locale
}

export function setOs(platform: string): void {
  os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'
}

export function getOs(): OsFamily {
  return os
}

/** Picks a supported language for the setting, falling back to the system languages, then English. */
export function resolveLanguage(setting: unknown, systemLanguages: readonly string[]): Language {
  const ids = LANGUAGES.map((l) => l.id) as readonly string[]
  if (typeof setting === 'string' && ids.includes(setting)) return setting as Language
  for (const tag of systemLanguages) {
    const base = tag.toLowerCase().split(/[-_]/)[0]
    if (ids.includes(base)) return base as Language
    if (base === 'sk') return 'cs' // Slovak readers are better served by Czech than English
  }
  return 'en'
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === 'auto' || LANGUAGES.some((l) => l.id === value)
}

type Params = Record<string, string | number>

function format(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

export function t(key: MessageKey, params?: Params): string {
  return format(DICTIONARIES[current][key] ?? cs[key] ?? key, params)
}

/** Platform variant: tos('action.reveal') → 'action.reveal.mac' / '.win' / '.linux'. */
export function tos(key: string, params?: Params): string {
  return t(`${key}.${os}` as MessageKey, params)
}

/** Plural form: plural('count.items', 3) → 'count.items.few' in Czech, '.other' in English. */
export function plural(key: string, n: number, params?: Params): string {
  const category = new Intl.PluralRules(locale()).select(n)
  const dict = DICTIONARIES[current] as Record<string, string>
  const k = `${key}.${category}` in dict ? `${key}.${category}` : `${key}.other`
  return t(k as MessageKey, { n, ...params })
}
