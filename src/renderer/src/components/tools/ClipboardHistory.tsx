import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { ClipboardEntry } from '@shared/types'
import { formatDate } from '@renderer/lib/format'
import { api, type ToolProps } from './common'

/** The last texts copied anywhere; off by default and never written to disk. */
export default function ClipboardHistory({ settings, updateSettings }: Pick<ToolProps, 'settings' | 'updateSettings'>): React.JSX.Element {
  const [entries, setEntries] = useState<ClipboardEntry[]>([])
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const on = settings.clipboardHistory

  useEffect(() => {
    void api.tools.clipboard().then(setEntries)
    return api.tools.onClipboard(setEntries)
  }, [])

  const shown = filter ? entries.filter((e) => e.text.toLowerCase().includes(filter.toLowerCase())) : entries
  return (
    <div className="tool">
      <label className="tool-check">
        <input type="checkbox" checked={on} onChange={(e) => updateSettings({ clipboardHistory: e.target.checked })} />
        {t('tools.clipboardOn')}
      </label>
      <p className="tool-muted">{t('tools.clipboardHint')}</p>
      {on && (
        <>
          <div className="tool-row">
            <input className="tool-input grow" value={filter} placeholder={t('tools.filter')} onChange={(e) => setFilter(e.target.value)} />
            <button className="todo-btn" disabled={!entries.length} onClick={() => void api.tools.clearClipboard()}>
              {t('tools.clear')}
            </button>
          </div>
          {shown.length === 0 && <p className="tool-muted">{t('tools.clipboardEmpty')}</p>}
          {shown.map((e) => (
            <button
              key={e.at}
              className="clip-entry"
              title={t('tools.clipboardCopy')}
              onClick={() => {
                void api.copyText(e.text)
                setCopied(e.at)
                setTimeout(() => setCopied(null), 1200)
              }}
            >
              <span className="clip-text">{e.text}</span>
              <span className="tool-muted clip-time">{copied === e.at ? '✓' : formatDate(e.at)}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
