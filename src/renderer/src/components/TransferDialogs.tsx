import { useRef } from 'react'
import type { ConflictPolicy, TransferPlan, TransferProgress } from '@shared/types'
import { t } from '@shared/i18n'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

export function ConflictDialog(props: { plan: TransferPlan; onChoose(policy: ConflictPolicy | null): void }): React.JSX.Element {
  const keepBoth = useRef<HTMLButtonElement>(null)
  const { conflicts, sources } = props.plan
  const shown = conflicts.slice(0, 5)
  const cancel = (): void => props.onChoose(null)

  return (
    <Dialog title={t('conflict.title')} onClose={cancel} initialFocus={keepBoth}>
      <div className="dialog-body">
        <Icon name="documents" size={32} />
        <div>
          <p>
            {conflicts.length === 1
              ? t('conflict.one', { name: conflicts[0] })
              : t('conflict.many', { count: conflicts.length, total: sources.length })}
          </p>
          {conflicts.length > 1 && (
            <ul className="conflict-list">
              {shown.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {conflicts.length > shown.length && <li>{t('conflict.more', { n: conflicts.length - shown.length })}</li>}
            </ul>
          )}
          <p>{t('conflict.question')}</p>
        </div>
      </div>
      <div className="dialog-buttons">
        <button className="xp-button" onClick={() => props.onChoose('replace')}>
          {t('conflict.replace')}
        </button>
        <button ref={keepBoth} className="xp-button" onClick={() => props.onChoose('keepBoth')}>
          {t('conflict.keepBoth')}
        </button>
        <button className="xp-button" onClick={() => props.onChoose('skip')}>
          {t('conflict.skip')}
        </button>
        <button className="xp-button" onClick={cancel}>
          {t('dialog.cancel')}
        </button>
      </div>
    </Dialog>
  )
}

export function ProgressDialog(props: { progress: TransferProgress; onCancel(): void }): React.JSX.Element {
  const { mode, done, total, current } = props.progress
  const title = t(mode === 'copy' ? 'progress.copying' : mode === 'archive' ? 'progress.archiving' : 'progress.moving')
  // A single large item gives no useful percentage – show the XP "marquee" bar instead.
  const indeterminate = total <= 1
  return (
    <Dialog title={title} onClose={props.onCancel}>
      <div className="dialog-body progress-body">
        <div className="flying-papers">
          <Icon name="folder" size={32} />
          <span className="paper">
            <Icon name="other" size={18} />
          </span>
          <Icon name="open" size={32} />
        </div>
        <div className="progress-text">{current || ' '}</div>
        <div className={`xp-progress${indeterminate ? ' indeterminate' : ''}`}>
          <div className="xp-progress-fill" style={indeterminate ? undefined : { width: `${(done / total) * 100}%` }} />
        </div>
        <div className="progress-text muted">{indeterminate ? t('progress.running') : t('progress.count', { done, total })}</div>
      </div>
      <div className="dialog-buttons right">
        <button className="xp-button" onClick={props.onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
