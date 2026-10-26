import { describe, expect, it } from 'vitest'
import { cleanSymbol, moveStock, sanitizeStocks, stockChanges, tradingViewSymbol } from './stocks'

const DAY = 86_400_000
const t0 = Date.UTC(2025, 0, 1)

describe('stockChanges', () => {
  it('compares with the previous session and the last close N days back', () => {
    // 400 daily bars, close = 100 + index.
    const times = Array.from({ length: 400 }, (_, i) => t0 + i * DAY)
    const closes = times.map((_, i) => 100 + i)
    const c = stockChanges(times, closes, 500)
    expect(c.d).toBeCloseTo((500 / 498 - 1) * 100)
    expect(c.w).toBeCloseTo((500 / (100 + 392) - 1) * 100)
    expect(c.m).toBeCloseTo((500 / (100 + 369) - 1) * 100)
    expect(c.y).toBeCloseTo((500 / (100 + 34) - 1) * 100)
  })

  it('skips gaps and leaves periods longer than the history empty', () => {
    const times = [t0, t0 + DAY, t0 + 2 * DAY, t0 + 10 * DAY]
    const c = stockChanges(times, [10, null, 20, 25], 30)
    expect(c.d).toBeCloseTo(50)
    expect(c.w).toBeCloseTo(50)
    expect(c.m).toBeNull()
    expect(c.y).toBeNull()
  })

  it('returns nothing without enough data', () => {
    expect(stockChanges([t0], [10], 10)).toEqual({ d: null, w: null, m: null, y: null })
  })
})

describe('symbols', () => {
  it('accepts Yahoo symbols only', () => {
    expect(cleanSymbol(' aapl ')).toBe('AAPL')
    expect(cleanSymbol('^GSPC')).toBe('^GSPC')
    expect(cleanSymbol('BRK-B')).toBe('BRK-B')
    expect(cleanSymbol('a b')).toBeNull()
    expect(cleanSymbol('../x')).toBeNull()
    expect(sanitizeStocks(['aapl', 'AAPL', 7, 'msft'])).toEqual(['AAPL', 'MSFT'])
  })

  it('translates to TradingView symbols', () => {
    expect(tradingViewSymbol('AAPL')).toBe('AAPL')
    expect(tradingViewSymbol('BRK-B')).toBe('BRK.B')
    expect(tradingViewSymbol('CEZ.PR')).toBe('PSE:CEZ')
    expect(tradingViewSymbol('SAP.DE')).toBe('XETR:SAP')
    expect(tradingViewSymbol('^GSPC')).toBe('SP:SPX')
    expect(tradingViewSymbol('BTC-USD')).toBe('BTCUSD')
    expect(tradingViewSymbol('EURUSD=X')).toBe('FX:EURUSD')
  })
})

describe('moveStock', () => {
  const list = ['A', 'B', 'C', 'D']
  it('moves within the list and clamps to the ends', () => {
    expect(moveStock(list, 'A', 2)).toEqual(['B', 'C', 'A', 'D'])
    expect(moveStock(list, 'D', 0)).toEqual(['D', 'A', 'B', 'C'])
    expect(moveStock(list, 'B', 99)).toEqual(['A', 'C', 'D', 'B'])
    expect(moveStock(list, 'C', -1)).toEqual(['C', 'A', 'B', 'D'])
    expect(moveStock(list, 'X', 0)).toBe(list)
  })
})
