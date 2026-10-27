import { useState } from 'react'
import { Dialog } from './Dialog'
import { t } from '@shared/i18n'
import type { FeedbackDraft } from '@shared/types'

interface Props {
  onClose(): void
}

type Phase = { kind: 'edit'; error?: string } | { kind: 'sending' } | { kind: 'sent' }

/** Report a problem or suggest an improvement; nothing leaves the computer before Send. */
export function FeedbackDialog({ onClose }: Props): React.JSX.Element {
  const [kind, setKind] = useState<FeedbackDraft['kind']>('bug')
  const [message, setMessage] = useState('')
  const [includeInfo, setIncludeInfo] = useState(true)
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })
  const busy = phase.kind === 'sending'

  const send = (): void => {
    if (!message.trim() || busy) return
    setPhase({ kind: 'sending' })
    window.api.feedback.send({ kind, message, includeInfo }).then(
      () => setPhase({ kind: 'sent' }),
      (err: Error) => setPhase({ kind: 'edit', error: err.message })
    )
  }
  // Closing mid-send would hide whether it arrived.
  const close = (): void => void (!busy && onClose())

  return (
    <Dialog title={t('feedback.title')} className="feedback-dialog" onClose={close} onSubmit={() => send()}>
        {phase.kind === 'sent' ? (
          <>
            <p className="feedback-sent">{t('feedback.sent')}</p>
            <div className="dialog-buttons right">
              <button type="button" className="xp-button" autoFocus onClick={onClose}>
                {t('feedback.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="feedback-body">
              <div className="feedback-kind" role="radiogroup">
                {(['bug', 'idea'] as const).map((k) => (
                  <label key={k}>
                    <input type="radio" name="feedback-kind" checked={kind === k} disabled={busy} onChange={() => setKind(k)} />
                    {t(k === 'bug' ? 'feedback.bug' : 'feedback.idea')}
                  </label>
                ))}
              </div>
              <label className="feedback-field">
                {t('feedback.message')}
                <textarea
                  autoFocus
                  rows={6}
                  maxLength={5000}
                  value={message}
                  disabled={busy}
                  placeholder={t(kind === 'bug' ? 'feedback.bugPlaceholder' : 'feedback.ideaPlaceholder')}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <label className="feedback-check">
                <input type="checkbox" checked={includeInfo} disabled={busy} onChange={(e) => setIncludeInfo(e.target.checked)} />
                {t('feedback.info')}
              </label>
              <p className="remote-note">{t('feedback.privacy')}</p>
              {phase.kind === 'edit' && phase.error && (
                <p className="feedback-error" role="alert">
                  {phase.error}
                </p>
              )}
            </div>
            <div className="dialog-buttons right">
              <button type="submit" className="xp-button" disabled={!message.trim() || busy}>
                {busy ? t('feedback.sending') : t('feedback.send')}
              </button>
              <button type="button" className="xp-button" disabled={busy} onClick={close}>
                {t('dialog.cancel')}
              </button>
            </div>
          </>
        )}
    </Dialog>
  )
}
