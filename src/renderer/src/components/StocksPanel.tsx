import { useEffect, useMemo, useRef, useState } from 'react'
import { getLanguage, getOs, locale, t, type MessageKey } from '@shared/i18n'
import { cleanSymbol, MAX_STOCKS, moveStock, STOCK_PERIODS, tradingViewSymbol, type StockMatch, type StockQuote } from '@shared/stocks'
import { THEMES, type ThemeId } from '@shared/types'
import type { MenuState } from './ContextMenu'

const api = window.api
const POLL = 5 * 60_000
const TV_LOCALE: Record<string, string> = { en: 'en', de: 'de_DE', es: 'es', cs: 'en' }

interface Props {
  visible: boolean
  symbols: string[]
  theme: ThemeId
  onChange(symbols: string[]): void
  showMenu(menu: MenuState): void
}

const remembered = (): string | null => {
  try {
    return cleanSymbol(localStorage.getItem('afinder.stocks.last'))
  } catch {
    return null
  }
}

function money(value: number, currency: string): string {
  const digits = Math.abs(value) < 10 ? 3 : 2
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: digits }).format(value)
  } catch {
    // Not an ISO code (GBp pence on London) or none at all.
    return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value)} ${currency}`.trim()
  }
}

const pct = (v: number | null): string => (v === null ? '–' : `${v > 0 ? '+' : ''}${new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)} %`)
const trend = (v: number | null): string => (v === null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '')

/** Dark themes (by their background) and the macOS theme following a dark system get the dark chart. */
function useDarkChart(theme: ThemeId): boolean {
  const query = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), [])
  const [systemDark, setSystemDark] = useState(query.matches)
  useEffect(() => {
    const on = (): void => setSystemDark(query.matches)
    query.addEventListener('change', on)
    return () => query.removeEventListener('change', on)
  }, [query])
  if (theme === 'apple') return systemDark
  const bg = THEMES.find((x) => x.id === theme)?.background ?? '#ffffff'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b < 128
}

/** TradingView's free Advanced Chart widget. The renderer's CSP allows no foreign scripts, so the iframe the embed script would build is built here. */
function chartUrl(symbol: string, dark: boolean): string {
  const config = {
    symbol: tradingViewSymbol(symbol),
    interval: 'D',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
    theme: dark ? 'dark' : 'light',
    style: '1',
    allow_symbol_change: true,
    hide_side_toolbar: true,
    save_image: false,
    calendar: false,
    autosize: true,
    support_host: 'https://www.tradingview.com'
  }
  return `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=${TV_LOCALE[getLanguage()] ?? 'en'}#${encodeURIComponent(JSON.stringify(config))}`
}

/** The Stocks area: favourite tickers with their daily to yearly change, and a TradingView chart of the picked one. */
export function StocksPanel({ visible, symbols, theme, onChange, showMenu }: Props): React.JSX.Element {
  const [quotes, setQuotes] = useState<Map<string, StockQuote>>(new Map())
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [updated, setUpdated] = useState<number | null>(null)
  const [selected, setSelected] = useState<string | null>(() => remembered() ?? symbols[0] ?? null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<StockMatch[] | null>(null)
  const [cursor, setCursor] = useState(-1)
  const dark = useDarkChart(theme)
  const key = symbols.join()
  const reload = useRef<() => void>(() => {})

  // Prices only while the area is shown: nothing goes to the network for a hidden or never-opened area.
  useEffect(() => {
    if (!visible || symbols.length === 0) return
    let live = true
    const load = (): void => {
      setLoading(true)
      api.stockQuotes(symbols).then(
        (list) => {
          if (!live) return
          setQuotes(new Map(list.map((q) => [q.symbol, q])))
          setFailed(list.length === 0)
          setUpdated(Date.now())
          setLoading(false)
        },
        () => live && (setFailed(true), setLoading(false))
      )
    }
    reload.current = load
    load()
    const timer = setInterval(load, POLL)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [visible, key]) // `key` stands for the list

  // Look-up while typing, debounced.
  useEffect(() => {
    const q = query.trim()
    if (!q) return setMatches(null)
    let live = true
    const timer = setTimeout(() => void api.stockSearch(q).then((m) => live && (setMatches(m), setCursor(-1)), () => live && setMatches([])), 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  const select = (symbol: string): void => {
    setSelected(symbol)
    setQuery('')
    setMatches(null)
    try {
      localStorage.setItem('afinder.stocks.last', symbol)
    } catch {
      // Only a convenience.
    }
  }
  const isFavorite = (s: string): boolean => symbols.includes(s)
  const add = (s: string): void => {
    if (!isFavorite(s) && symbols.length < MAX_STOCKS) onChange([...symbols, s])
  }
  const remove = (s: string): void => onChange(symbols.filter((x) => x !== s))
  const move = (s: string, to: number): void => {
    const next = moveStock(symbols, s, to)
    if (next.join() !== key) onChange(next)
  }

  /** Where a dragged row would land: the index of the row it goes before (the list length = at the end). */
  const [drag, setDrag] = useState<{ symbol: string; slot: number } | null>(null)
  const dragged = useRef(false)
  const body = useRef<HTMLTableSectionElement>(null)
  // Pointer-driven like the areas: HTML drag and drop stays reserved for files and tabs.
  const startDrag = (e: React.MouseEvent, symbol: string): void => {
    dragged.current = false
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const y0 = e.clientY
    let slot: number | null = null
    const over = (ev: MouseEvent): void => {
      if (ev.buttons === 0) return up()
      if (!dragged.current && Math.abs(ev.clientY - y0) < 4) return
      dragged.current = true
      const rows = [...(body.current?.rows ?? [])]
      const i = rows.findIndex((r) => {
        const b = r.getBoundingClientRect()
        return ev.clientY < b.top + b.height / 2
      })
      slot = i < 0 ? rows.length : i
      setDrag({ symbol, slot })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', over)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      const from = symbols.indexOf(symbol)
      if (dragged.current && slot !== null) move(symbol, slot > from ? slot - 1 : slot)
    }
    window.addEventListener('mousemove', over)
    window.addEventListener('mouseup', up)
  }

  const moveKey = getOs() === 'mac' ? '⌥' : 'Alt+'
  const rowMenu = (e: React.MouseEvent, s: string): void => {
    e.preventDefault()
    select(s)
    const i = symbols.indexOf(s)
    const last = symbols.length - 1
    showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('stocks.moveUp'), shortcut: `${moveKey}↑`, disabled: i === 0, onClick: () => move(s, i - 1) },
        { label: t('stocks.moveDown'), shortcut: `${moveKey}↓`, disabled: i === last, onClick: () => move(s, i + 1) },
        { label: t('stocks.moveTop'), disabled: i === 0, onClick: () => move(s, 0) },
        { label: t('stocks.moveBottom'), disabled: i === last, onClick: () => move(s, last) },
        'separator',
        { label: t('stocks.remove'), icon: 'trash', onClick: () => remove(s) }
      ]
    })
  }
  /** ↑/↓ pick the neighbour, with Alt (Option) they move the picked favourite. */
  const onListKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const i = selected ? symbols.indexOf(selected) : -1
    const step = e.key === 'ArrowUp' ? -1 : 1
    if (e.altKey) {
      if (i >= 0) move(symbols[i], i + step)
    } else {
      const next = symbols[Math.max(0, Math.min(symbols.length - 1, i + step))]
      if (next) select(next)
    }
  }
  const typed = cleanSymbol(query)

  const onKey = (e: React.KeyboardEvent): void => {
    const n = matches?.length ?? 0
    if (e.key === 'ArrowDown' && n) (e.preventDefault(), setCursor((c) => (c + 1) % n))
    else if (e.key === 'ArrowUp' && n) (e.preventDefault(), setCursor((c) => (c <= 0 ? n - 1 : c - 1)))
    else if (e.key === 'Escape') (setQuery(''), setMatches(null))
    else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = matches?.[cursor]?.symbol ?? typed
      if (pick) select(pick)
    }
  }

  const sel = selected ? quotes.get(selected) : undefined

  return (
    <div className="stocks-panel">
      <div className="todo-add stocks-search">
        <input
          value={query}
          placeholder={t('stocks.placeholder')}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => setTimeout(() => setMatches(null), 150)}
        />
        <button className="todo-btn" disabled={!typed || isFavorite(typed) || symbols.length >= MAX_STOCKS} onClick={() => typed && (add(typed), select(typed))}>
          {t('stocks.add')}
        </button>
        {matches && (
          <div className="stocks-matches" role="listbox">
            {matches.length === 0 && <div className="stocks-match empty">{t('stocks.noMatch')}</div>}
            {matches.map((m, i) => (
              <div key={m.symbol} role="option" aria-selected={i === cursor} className={`stocks-match ${i === cursor ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => select(m.symbol)}>
                <b>{m.symbol}</b>
                <span className="stocks-match-name">{m.name}</span>
                <span className="stocks-match-ex">{[m.type, m.exchange].filter(Boolean).join(' · ')}</span>
                <button
                  className="todo-chip-x"
                  title={t('stocks.add')}
                  disabled={isFavorite(m.symbol)}
                  onClick={(e) => {
                    e.stopPropagation()
                    add(m.symbol)
                  }}
                >
                  {isFavorite(m.symbol) ? '★' : '+'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="stocks-list" tabIndex={0} onKeyDown={onListKey}>
        {symbols.length === 0 ? (
          <div className="todo-empty">{t('stocks.empty')}</div>
        ) : (
          <table className={`stocks-table ${drag ? 'dragging' : ''}`} title={t('stocks.reorderHint')}>
            <thead>
              <tr>
                <th>{t('stocks.symbol')}</th>
                <th className="num">{t('stocks.price')}</th>
                {STOCK_PERIODS.map((p) => (
                  <th key={p} className="num" title={t(`stocks.periodTitle.${p}` as MessageKey)}>
                    {t(`stocks.period.${p}` as MessageKey)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody ref={body}>
              {symbols.map((s, i) => {
                const q = quotes.get(s)
                return (
                  <tr
                    key={s}
                    className={[s === selected && 'on', drag?.symbol === s && 'dragged', drag?.slot === i && 'drop-before', drag?.slot === symbols.length && i === symbols.length - 1 && 'drop-after']
                      .filter(Boolean)
                      .join(' ')}
                    onMouseDown={(e) => startDrag(e, s)}
                    onClick={() => !dragged.current && select(s)}
                    onContextMenu={(e) => rowMenu(e, s)}
                  >
                    <td className="stocks-name" title={q?.name}>
                      <b>{s}</b>
                      {q && q.name !== s && <span>{q.name}</span>}
                    </td>
                    <td className="num">{q ? money(q.price, q.currency) : loading ? '…' : t('stocks.unknown')}</td>
                    {STOCK_PERIODS.map((p) => (
                      <td key={p} className={`num ${trend(q?.change[p] ?? null)}`}>
                        {q ? pct(q.change[p]) : ''}
                      </td>
                    ))}
                    <td>
                      <button
                        className="todo-chip-x"
                        title={t('stocks.remove')}
                        onClick={(e) => {
                          e.stopPropagation()
                          remove(s)
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {symbols.length > 0 && (
        <div className="todo-bar stocks-status">
          <span className="todo-count">
            {failed && !loading ? t('stocks.noData') : updated ? t('stocks.updated', { time: new Date(updated).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : t('stocks.loading')}
          </span>
          <div className="toolbar-spacer" />
          <button className="todo-btn" disabled={loading} onClick={() => reload.current()}>
            {t('stocks.refresh')}
          </button>
        </div>
      )}
      <div className="stocks-chart">
        {selected && (
          <div className="stocks-chart-head">
            <b>{selected}</b>
            {sel && <span>{sel.name}</span>}
            <div className="toolbar-spacer" />
            <button
              className="todo-btn"
              disabled={!isFavorite(selected) && symbols.length >= MAX_STOCKS}
              onClick={() => (isFavorite(selected) ? remove(selected) : add(selected))}
            >
              {isFavorite(selected) ? `★ ${t('stocks.remove')}` : `☆ ${t('stocks.add')}`}
            </button>
          </div>
        )}
        {!selected ? (
          <div className="todo-empty">{t('stocks.pick')}</div>
        ) : (
          visible && (
            <iframe
              key={`${selected}-${dark}`}
              className="stocks-frame"
              title={`TradingView ${selected}`}
              src={chartUrl(selected, dark)}
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )
        )}
      </div>
    </div>
  )
}
