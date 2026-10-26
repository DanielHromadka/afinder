import { useEffect, useState } from 'react'
import { locale, t, type MessageKey } from '@shared/i18n'
import { formatNumber } from '@shared/tools/calc'
import { convertCurrency, type Rates } from '@shared/tools/rates'
import { convertUnit, UNIT_CATEGORIES, UNITS, type UnitCategory } from '@shared/tools/units'
import { api, CopyButton, ToolError, useStored } from './common'

type Category = UnitCategory | 'currency'

/** The pair each category starts with: the conversion people look up most. */
const START: Record<Category, [string, string]> = {
  length: ['km', 'mi'],
  mass: ['kg', 'lb'],
  temperature: ['°C', '°F'],
  area: ['m²', 'ft²'],
  volume: ['l', 'gal'],
  speed: ['km/h', 'mph'],
  data: ['GB', 'GiB'],
  time: ['h', 'min'],
  currency: ['EUR', 'CZK']
}

/** Units of every category, and currencies by today's CNB rates (fetched only when chosen). */
export default function Units(): React.JSX.Element {
  const [category, setCategory] = useStored<Category>('units.category', 'length')
  const [value, setValue] = useStored('units.value', '1')
  const [pairs, setPairs] = useStored<Record<string, [string, string]>>('units.pairs', {})
  const [rates, setRates] = useState<Rates | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (category !== 'currency' || rates) return
    api.tools.rates().then(setRates, (err: Error) => setError(err.message))
  }, [category, rates])

  const units = category === 'currency' ? Object.keys(rates?.czk ?? {}).sort() : Object.keys(UNITS[category])
  const defaults = START[category]
  const [from, to] = pairs[category] && units.includes(pairs[category][0]) && units.includes(pairs[category][1]) ? pairs[category] : defaults
  const setPair = (p: [string, string]): void => setPairs({ ...pairs, [category]: p })

  const number = parseFloat(value.replace(',', '.'))
  let result = ''
  if (Number.isFinite(number) && units.includes(from) && units.includes(to)) {
    const out = category === 'currency' ? (rates ? convertCurrency(number, rates, from, to) : NaN) : convertUnit(number, category, from, to)
    if (Number.isFinite(out)) result = formatNumber(out, locale())
  }

  const unitSelect = (v: string, on: (u: string) => void): React.JSX.Element => (
    <select className="tool-input" value={v} onChange={(e) => on(e.target.value)}>
      {units.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  )

  return (
    <div className="tool">
      <div className="tool-chips">
        {[...UNIT_CATEGORIES, 'currency' as const].map((c) => (
          <button key={c} className={`todo-btn${c === category ? ' on' : ''}`} onClick={() => setCategory(c)}>
            {t(`tools.unit.${c}` as MessageKey)}
          </button>
        ))}
      </div>
      {category === 'currency' && !rates ? (
        error ? <ToolError text={error} /> : <p className="tool-muted">{t('tools.ratesLoading')}</p>
      ) : (
        <>
          <div className="tool-row">
            <input className="tool-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('tools.value')} />
            {unitSelect(from, (u) => setPair([u, to]))}
            <button className="todo-btn" title={t('tools.swap')} onClick={() => setPair([to, from])}>
              ⇄
            </button>
            {unitSelect(to, (u) => setPair([from, u]))}
          </div>
          <div className="tool-output">
            <span className="tool-big">
              {result || '–'} <span className="tool-muted">{to}</span>
            </span>
            <CopyButton text={result} />
          </div>
          {category === 'currency' && rates && <p className="tool-muted">{t('tools.ratesNote', { date: rates.date })}</p>}
        </>
      )}
    </div>
  )
}
