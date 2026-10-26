import { net } from 'electron'
import { cleanSymbol, stockChanges, type StockMatch, type StockQuote } from '@shared/stocks'

// Free Yahoo Finance endpoints without a key (unofficial, so every field is checked). Requests go only
// from the Stocks area while it is shown; quotes are cached for all windows and kept while offline.

const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const SEARCH = 'https://query2.finance.yahoo.com/v1/finance/search'
const TTL = 5 * 60_000

const cache = new Map<string, { quote: StockQuote; at: number }>()
const pending = new Map<string, Promise<StockQuote | null>>()

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown): string => (typeof v === 'string' ? v : '')

async function getJson(url: string): Promise<unknown> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

interface ChartResult {
  meta?: { symbol?: unknown; currency?: unknown; regularMarketPrice?: unknown; regularMarketTime?: unknown; longName?: unknown; shortName?: unknown; instrumentType?: unknown }
  timestamp?: unknown
  indicators?: { quote?: { close?: unknown }[] }
}

async function fetchQuote(symbol: string): Promise<StockQuote | null> {
  const json = (await getJson(`${CHART}${encodeURIComponent(symbol)}?range=2y&interval=1d`)) as { chart?: { result?: ChartResult[] } }
  const r = json?.chart?.result?.[0]
  const price = r?.meta?.regularMarketPrice
  if (!r || !finite(price)) return null
  const times = Array.isArray(r.timestamp) ? r.timestamp.map((t) => (finite(t) ? t * 1000 : 0)) : []
  const closes = r.indicators?.quote?.[0]?.close
  const time = r.meta?.regularMarketTime
  return {
    symbol,
    name: text(r.meta?.longName) || text(r.meta?.shortName) || symbol,
    // Index points are no money.
    currency: r.meta?.instrumentType === 'INDEX' ? '' : text(r.meta?.currency),
    price,
    change: stockChanges(times, Array.isArray(closes) ? closes : [], price),
    time: finite(time) ? time * 1000 : Date.now()
  }
}

/** One request per symbol at most every five minutes; the last known quote when Yahoo fails. */
function quote(symbol: string): Promise<StockQuote | null> {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.quote)
  let p = pending.get(symbol)
  if (!p) {
    p = fetchQuote(symbol)
      .then((q) => {
        if (q) cache.set(symbol, { quote: q, at: Date.now() })
        return q ?? hit?.quote ?? null
      })
      .catch(() => hit?.quote ?? null)
      .finally(() => pending.delete(symbol))
    pending.set(symbol, p)
  }
  return p
}

/** Quotes in the order asked; unknown symbols and failures are left out. */
export async function stockQuotes(symbols: unknown): Promise<StockQuote[]> {
  const list = (Array.isArray(symbols) ? symbols : []).map(cleanSymbol).filter((s): s is string => !!s).slice(0, 40)
  const quotes = await Promise.all(list.map(quote))
  return quotes.filter((q): q is StockQuote => !!q)
}

export async function stockSearch(query: unknown): Promise<StockMatch[]> {
  const q = typeof query === 'string' ? query.trim().slice(0, 60) : ''
  if (!q) return []
  const json = (await getJson(`${SEARCH}?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`)) as { quotes?: Record<string, unknown>[] }
  const out: StockMatch[] = []
  for (const r of Array.isArray(json?.quotes) ? json.quotes : []) {
    const symbol = cleanSymbol(r.symbol)
    if (!symbol || r.isYahooFinance === false) continue
    out.push({ symbol, name: text(r.longname) || text(r.shortname) || symbol, exchange: text(r.exchDisp) || text(r.exchange), type: text(r.typeDisp) || text(r.quoteType) })
  }
  return out
}
