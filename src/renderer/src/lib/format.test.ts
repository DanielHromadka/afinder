import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '@shared/i18n'
import { formatCount, formatSize } from './format'

// Intl uses a no-break space as the thousands separator in Czech.
const nbsp = (s: string): string => s.replace(/ /g, ' ')

describe('formatSize', () => {
  it('formats bytes and binary units with a decimal comma', () => {
    expect(nbsp(formatSize(0))).toBe('0 B')
    expect(nbsp(formatSize(1023))).toBe('1 023 B')
    expect(nbsp(formatSize(1536))).toBe('1,5 KB')
    expect(nbsp(formatSize(5 * 1024 ** 3))).toBe('5 GB')
    expect(nbsp(formatSize(150 * 1024 ** 2))).toBe('150 MB')
  })
})

describe('formatCount', () => {
  it('uses Czech plural forms', () => {
    expect(formatCount(1)).toBe('1 objekt')
    expect(formatCount(3)).toBe('3 objekty')
    expect(formatCount(5)).toBe('5 objektů')
    expect(formatCount(0)).toBe('0 objektů')
  })
})

describe('other languages', () => {
  afterEach(() => setLanguage('cs'))

  it('formats sizes and counts in English and German', () => {
    setLanguage('en')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatCount(1)).toBe('1 item')
    expect(formatCount(1200)).toBe('1,200 items')
    setLanguage('de')
    expect(formatSize(1536)).toBe('1,5 KB')
    expect(formatCount(2)).toBe('2 Objekte')
  })
})
