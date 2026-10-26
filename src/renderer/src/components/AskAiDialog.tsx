import { useState } from 'react'
import { Dialog } from './Dialog'
import { t } from '@shared/i18n'

interface Props {
  /** Names of the files or folders the question is about. */
  names: string[]
  /** The agent's name, e.g. "Claude Code". */
  agent: string
  onAsk(question: string): void
  onCancel(): void
}

/** The question for "Ask AI…"; the answer comes in a new console session with the agent. */
export function AskAiDialog({ names, agent, onAsk, onCancel }: Props): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const submit = (): void => {
    if (question.trim()) onAsk(question.trim())
  }
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')

  return (
    <Dialog title={t('ai.askTitle')} className="ask-ai" onClose={onCancel} resizable onSubmit={() => submit()}>
        <div className="ask-ai-body">
          <p className="ask-ai-about">{t('ai.askAbout', { items: shown })}</p>
          <textarea
            autoFocus
            rows={4}
            value={question}
            placeholder={t('ai.askPlaceholder')}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter starts a new line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <p className="remote-note">{t('ai.askNote', { agent })}</p>
        </div>
        <div className="dialog-buttons right">
          <button type="submit" className="xp-button" disabled={!question.trim()}>
            {t('ai.askSend')}
          </button>
          <button type="button" className="xp-button" onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
        </div>
    </Dialog>
  )
}
