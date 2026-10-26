import { afterEach, describe, expect, it } from 'vitest'
import { cs } from './cs'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { plural, resolveLanguage, setLanguage, setOs, t, tos } from './index'

afterEach(() => {
  setLanguage('cs')
  setOs('darwin')
})

describe('i18n', () => {
  it('has every key in every language, with the same placeholders', () => {
    const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const dict of [en, de, es]) {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(cs).sort())
      for (const [key, value] of Object.entries(cs)) {
        expect(placeholders((dict as Record<string, string>)[key]), key).toEqual(placeholders(value))
      }
    }
  })

  it('interpolates and picks plural forms', () => {
    expect(plural('count.items', 1)).toBe('1 objekt')
    expect(plural('count.items', 3)).toBe('3 objekty')
    expect(plural('count.items', 12)).toBe('12 objektů')
    setLanguage('en')
    expect(plural('count.items', 1)).toBe('1 item')
    expect(plural('count.items', 3)).toBe('3 items')
    expect(t('conflict.one', { name: 'a.txt' })).toBe('The destination already contains an item named “a.txt”.')
  })

  it('picks platform variants', () => {
    expect(tos('action.reveal')).toBe('Zobrazit ve Finderu')
    setOs('win32')
    expect(tos('action.reveal')).toBe('Zobrazit v Průzkumníkovi')
    setOs('linux')
    setLanguage('de')
    expect(tos('action.reveal')).toBe('Im Dateimanager zeigen')
  })

  it('resolves the language from the setting or the system', () => {
    expect(resolveLanguage('de', ['cs-CZ'])).toBe('de')
    expect(resolveLanguage('auto', ['fr-FR', 'es-MX'])).toBe('es')
    expect(resolveLanguage('auto', ['sk-SK'])).toBe('cs')
    expect(resolveLanguage('auto', ['ja-JP'])).toBe('en')
  })
})
