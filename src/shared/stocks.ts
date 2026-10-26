// Stocks area: favourite tickers with their price changes and a TradingView chart. Tickers are Yahoo
// Finance symbols (AAPL, CEZ.PR, BRK-B, ^GSPC), since Yahoo serves the free daily history the changes
// are computed from; the chart gets the symbol translated to TradingView's EXCHANGE:TICKER form.

export const MAX_STOCKS = 30

/** Daily, weekly, monthly and yearly change. */
export const STOCK_PERIODS = ['d', 'w', 'm', 'y'] as const
export type StockPeriod = (typeof STOCK_PERIODS)[number]
const PERIOD_DAYS: Record<StockPeriod, number> = { d: 1, w: 7, m: 30, y: 365 }

export interface StockQuote {
  symbol: string
  name: string
  currency: string
  price: number
  /** Change in percent (−3.2 = down 3.2 %); null when the history is too short. */
  change: Record<StockPeriod, number | null>
  /** Unix ms of the last price. */
  time: number
}

export interface StockMatch {
  symbol: string
  name: string
  exchange: string
  type: string
}

/** Yahoo symbols: letters, digits and . - ^ = (indices, share classes, futures, currencies). */
export function cleanSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim().toUpperCase()
  return /^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$/.test(s) ? s : null
}

export function sanitizeStocks(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const v of list) {
    const s = cleanSymbol(v)
    if (s && !out.includes(s)) out.push(s)
    if (out.length === MAX_STOCKS) break
  }
  return out
}

const DAY = 86_400_000

/**
 * Changes from daily closes (oldest first, gaps allowed). The daily change compares the price with the
 * previous session's close; the longer ones with the last close at least N days before the last bar,
 * so weekends and holidays fall back to the session before them.
 */
export function stockChanges(times: number[], closes: (number | null)[], price: number): Record<StockPeriod, number | null> {
  const bars: [number, number][] = []
  times.forEach((t, i) => {
    const c = closes[i]
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) bars.push([t, c])
  })
  const out = { d: null, w: null, m: null, y: null } as Record<StockPeriod, number | null>
  if (bars.length < 2 || !(price > 0)) return out
  const pct = (ref: number): number => (price / ref - 1) * 100
  const last = bars[bars.length - 1][0]
  out.d = pct(bars[bars.length - 2][1])
  for (const p of ['w', 'm', 'y'] as const) {
    const limit = last - PERIOD_DAYS[p] * DAY
    for (let i = bars.length - 2; i >= 0; i--) {
      if (bars[i][0] <= limit) {
        out[p] = pct(bars[i][1])
        break
      }
    }
  }
  return out
}

/** Yahoo suffix → TradingView exchange prefix. */
const EXCHANGES: Record<string, string> = {
  PR: 'PSE', DE: 'XETR', F: 'FWB', L: 'LSE', PA: 'EURONEXT', AS: 'EURONEXT', BR: 'EURONEXT', LS: 'EURONEXT', MI: 'MIL',
  MC: 'BME', SW: 'SIX', VI: 'VIE', WA: 'GPW', ST: 'OMXSTO', CO: 'OMXCOP', HE: 'OMXHEL', OL: 'OSL', TO: 'TSX', V: 'TSXV',
  HK: 'HKEX', T: 'TSE', AX: 'ASX', NS: 'NSE', BO: 'BSE', KS: 'KRX', SS: 'SSE', SZ: 'SZSE', SA: 'BMFBOVESPA', MX: 'BMV'
}
const INDICES: Record<string, string> = {
  '^GSPC': 'SP:SPX', '^DJI': 'DJ:DJI', '^IXIC': 'NASDAQ:IXIC', '^NDX': 'NASDAQ:NDX', '^RUT': 'TVC:RUT', '^VIX': 'TVC:VIX',
  '^GDAXI': 'XETR:DAX', '^FTSE': 'TVC:UKX', '^N225': 'TVC:NI225', '^STOXX50E': 'TVC:SX5E', '^FCHI': 'EURONEXT:PX1'
}

/** The symbol TradingView understands; plain US tickers stay bare and TradingView picks the exchange. */
export function tradingViewSymbol(symbol: string): string {
  if (INDICES[symbol]) return INDICES[symbol]
  const crypto = /^([A-Z0-9]+)-(USD|EUR|USDT|BTC)$/.exec(symbol)
  if (crypto) return `${crypto[1]}${crypto[2]}`
  const fx = /^([A-Z]{6})=X$/.exec(symbol)
  if (fx) return `FX:${fx[1]}`
  const dot = symbol.lastIndexOf('.')
  if (dot > 0 && EXCHANGES[symbol.slice(dot + 1)]) return `${EXCHANGES[symbol.slice(dot + 1)]}:${symbol.slice(0, dot).replace(/-/g, '.')}`
  return symbol.replace(/-/g, '.')
}

/** The list with `symbol` moved to index `to` (counted in the list without it), clamped to the ends. */
export function moveStock(list: string[], symbol: string, to: number): string[] {
  if (!list.includes(symbol)) return list
  const rest = list.filter((s) => s !== symbol)
  const at = Math.max(0, Math.min(rest.length, to))
  return [...rest.slice(0, at), symbol, ...rest.slice(at)]
}
