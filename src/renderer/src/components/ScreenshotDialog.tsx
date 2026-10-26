import { useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { baseName, dirOf } from '@shared/paths'
import { previewUrl } from '@shared/preview'
import type { ScreenshotResult } from '@shared/types'
import { Dialog } from './Dialog'

interface Props {
  shot: ScreenshotResult
  onEdit(): void
  onClose(): void
}

/** After a screenshot: a look at it and the next step – edit (crop first where only the display was taken) or copy. */
export function ScreenshotDialog({ shot, onEdit, onClose }: Props): React.JSX.Element {
  const edit = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (): void => {
    window.api.copyImage(shot.path).then(
      () => setCopied(t('screenshot.copied')),
      (err: Error) => setCopied(err.message)
    )
  }
  return (
    <Dialog title={t('screenshot.title')} className="screenshot-dialog" onClose={onClose} closeOnBackdrop initialFocus={edit}>
        <div className="screenshot-body">
          <img src={previewUrl(shot.path)} alt="" draggable={false} />
          <p>
            {t('screenshot.saved', { name: baseName(shot.path) })}
            <br />
            <span className="muted" title={dirOf(shot.path)}>{dirOf(shot.path)}</span>
          </p>
          <p>{t(shot.crop ? 'screenshot.askCrop' : 'screenshot.ask')}</p>
          {copied && <p className="muted">{copied}</p>}
        </div>
        <div className="dialog-buttons">
          <button ref={edit} className="xp-button" onClick={onEdit}>
            {t(shot.crop ? 'screenshot.crop' : 'preview.edit')}
          </button>
          <button className="xp-button" onClick={copy}>
            {t('screenshot.copy')}
          </button>
          <button className="xp-button" onClick={onClose}>
            {t('preview.close')}
          </button>
        </div>
    </Dialog>
  )
}
