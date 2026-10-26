import { t } from '@shared/i18n'
import type { BtcQuote } from '@shared/types'
import { formatBtc } from '@renderer/lib/themeInfo'

/** The Bitcoin theme's price in the title bar, green or red by the change over the last seven days. */
export function BtcTicker({ quote }: { quote: BtcQuote }): React.JSX.Element {
  const q = formatBtc(quote)
  return (
    <span className={`btc-ticker ${q.trend}`} title={t('themeInfo.btcTitle')}>
      <span className="btc-price">{q.price}</span>
      {q.change && <span className="btc-change">{q.change}</span>}
    </span>
  )
}
