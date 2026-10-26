// Exchange rates of the Czech National Bank (free, no key, published every working day). The daily
// file lists how many CZK one `amount` of each currency costs.

export interface Rates {
  /** The CNB's date of the rates, as printed (e.g. "13.10.2026"). */
  date: string
  /** Currency code → CZK for one unit (CZK itself is 1). */
  czk: Record<string, number>
}

export const CNB_URL = 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt'

/** Parses "13.10.2026 #198 / země|měna|množství|kód|kurz / Austrálie|dolar|1|AUD|15,234 …". */
export function parseCnbRates(text: string): Rates {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const date = /^(\d{1,2}\.\d{1,2}\.\d{4})/.exec(lines[0] ?? '')?.[1]
  if (!date) throw new Error('Unexpected CNB format')
  const czk: Record<string, number> = { CZK: 1 }
  for (const line of lines.slice(2)) {
    const cols = line.split('|')
    if (cols.length < 5) continue
    const amount = Number(cols[2])
    const code = cols[3].trim()
    const rate = Number(cols[4].replace(/\s/g, '').replace(',', '.'))
    if (/^[A-Z]{3}$/.test(code) && amount > 0 && rate > 0) czk[code] = rate / amount
  }
  if (Object.keys(czk).length < 2) throw new Error('Unexpected CNB format')
  return { date, czk }
}

export const convertCurrency = (value: number, rates: Rates, from: string, to: string): number => (value * rates.czk[from]) / rates.czk[to]
