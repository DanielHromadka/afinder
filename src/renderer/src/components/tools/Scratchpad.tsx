import { t } from '@shared/i18n'
import { CopyButton, useStored } from './common'

/** Free text that is not about any file; kept on this computer between runs. */
export default function Scratchpad(): React.JSX.Element {
  const [text, setText] = useStored('scratch.text', '')
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return (
    <div className="tool scratch">
      <textarea className="tool-input tool-text scratch-text" value={text} placeholder={t('tools.scratchPlaceholder')} onChange={(e) => setText(e.target.value)} />
      <div className="tool-row">
        <span className="tool-muted">{t('tools.counts', { chars: text.length, words })}</span>
        <CopyButton text={text} />
        <button className="todo-btn" disabled={!text} onClick={() => setText('')}>
          {t('tools.clear')}
        </button>
      </div>
    </div>
  )
}
