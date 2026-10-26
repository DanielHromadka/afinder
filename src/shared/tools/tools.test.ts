import { describe, expect, it } from 'vitest'
import { CalcError, evaluate, formatNumber } from './calc'
import { contrastText, parseColor, toHex, toHslText, toRgbText } from './color'
import { decodeText, encodeText, ENCODINGS } from './encode'
import { generatePassword, passwordBits } from './password'
import { convertCurrency, parseCnbRates } from './rates'
import { squarify } from './treemap'
import { convertUnit } from './units'

describe('calculator', () => {
  it('follows precedence and associativity', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7)
    expect(evaluate('(1 + 2) * 3')).toBe(9)
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512)
    expect(evaluate('-2 ^ 2')).toBe(-4)
    expect(evaluate('10 / 4')).toBe(2.5)
    expect(evaluate('7 − 2 × 3 ÷ 2')).toBe(4)
  })

  it('reads decimal commas, percent, factorial and implicit multiplication', () => {
    expect(evaluate('1,5 + 0.25')).toBe(1.75)
    expect(evaluate('50%')).toBe(0.5)
    expect(evaluate('200 + 10%')).toBe(220)
    expect(evaluate('200 - 25%')).toBe(150)
    expect(evaluate('5!')).toBe(120)
    expect(evaluate('2pi')).toBeCloseTo(2 * Math.PI)
    expect(evaluate('3(4+1)')).toBe(15)
  })

  it('knows functions in degrees or radians, and the last answer', () => {
    expect(evaluate('sin 30')).toBeCloseTo(0.5)
    expect(evaluate('cos(pi)', { angle: 'rad' })).toBeCloseTo(-1)
    expect(evaluate('√16 + log(1000) + ln(e)')).toBe(8)
    expect(evaluate('ans * 2', { ans: 21 })).toBe(42)
  })

  it('refuses what it cannot read, and never runs code', () => {
    for (const bad of ['', '1 +', '(1', 'foo(2)', 'alert(1)', '1 $ 2', '(-1)!']) expect(() => evaluate(bad)).toThrow(CalcError)
    expect(evaluate('1/0')).toBe(Infinity)
  })

  it('formats results for people', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(1234567.5, 'cs')).toBe('1 234 567,5')
    expect(formatNumber(1 / 0)).toBe('∞')
    expect(formatNumber(6.02e23)).toBe('6.02e+23')
  })
})

describe('units and currencies', () => {
  it('converts through the base unit', () => {
    expect(convertUnit(1, 'length', 'mi', 'km')).toBeCloseTo(1.609344)
    expect(convertUnit(100, 'temperature', '°C', '°F')).toBeCloseTo(212)
    expect(convertUnit(0, 'temperature', 'K', '°C')).toBeCloseTo(-273.15)
    expect(convertUnit(1, 'data', 'GiB', 'MB')).toBeCloseTo(1073.741824)
    expect(convertUnit(36, 'speed', 'km/h', 'm/s')).toBeCloseTo(10)
  })

  it('reads the CNB daily file', () => {
    const rates = parseCnbRates('13.10.2026 #198\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,350\nJaponsko|jen|100|JPY|15,512\nUSA|dolar|1|USD|22,120\n')
    expect(rates.date).toBe('13.10.2026')
    expect(rates.czk.JPY).toBeCloseTo(0.15512)
    expect(convertCurrency(100, rates, 'EUR', 'CZK')).toBeCloseTo(2435)
    expect(convertCurrency(22.12, rates, 'CZK', 'USD')).toBeCloseTo(1)
    expect(() => parseCnbRates('<html>error</html>')).toThrow()
  })
})

describe('treemap', () => {
  it('fills the rectangle with the sizes in proportion', () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1, 0], { x: 0, y: 0, w: 6, h: 4 })
    const area = rects.reduce((a, r) => a + r.w * r.h, 0)
    expect(area).toBeCloseTo(24)
    expect(rects[0].w * rects[0].h).toBeCloseTo(6)
    expect(rects[7]).toMatchObject({ w: 0, h: 0 })
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(6.0001)
      expect(r.y + r.h).toBeLessThanOrEqual(4.0001)
    }
  })
})

describe('encodings', () => {
  it('round-trips UTF-8 text through every encoding', () => {
    const text = 'Žluťoučký kůň <b>&"\'</b> 🐎 a+b=c?'
    for (const enc of ENCODINGS) expect(decodeText(encodeText(text, enc), enc)).toBe(text)
    expect(encodeText('Ahoj', 'base64')).toBe('QWhvag==')
    expect(encodeText('ü', 'hex')).toBe('c3 bc')
    expect(decodeText('&#x1F40E; &amp; &nbsp;', 'html')).toBe('🐎 &  ')
    expect(() => decodeText('%%%', 'base64')).toThrow()
  })
})

describe('passwords', () => {
  const opts = { length: 20, lower: true, upper: true, digits: true, symbols: false, unambiguous: true }
  it('uses every chosen set and leaves out ambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword(opts)
      expect(p).toHaveLength(20)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).not.toMatch(/[0Oo1lI|!@#]/)
    }
    expect(generatePassword({ ...opts, lower: false, upper: false, digits: false })).toBe('')
    expect(passwordBits(opts)).toBe(Math.floor(20 * Math.log2(57)))
  })
})

describe('colours', () => {
  it('converts between notations', () => {
    const c = parseColor('#36c')!
    expect(c).toEqual({ r: 51, g: 102, b: 204 })
    expect(toHex(c)).toBe('#3366cc')
    expect(toRgbText(c)).toBe('rgb(51, 102, 204)')
    expect(toHslText(c)).toBe('hsl(220, 60%, 50%)')
    expect(parseColor('hsl(220, 60%, 50%)')).toEqual(c)
    expect(parseColor('rgb(300, 0, 0)')).toBeNull()
    expect(contrastText({ r: 255, g: 255, b: 255 })).toBe('#000')
  })
})
