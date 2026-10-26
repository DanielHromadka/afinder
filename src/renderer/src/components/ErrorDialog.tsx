import { useRef } from 'react'
import { t } from '@shared/i18n'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

export function ErrorDialog({ message, onClose }: { message: string; onClose(): void }): React.JSX.Element {
  const ok = useRef<HTMLButtonElement>(null)
  return (
    <Dialog title={t('dialog.error')} role="alertdialog" onClose={onClose} closeOnBackdrop initialFocus={ok}>
      <div className="dialog-body">
        <Icon name="error" size={32} />
        <p>{message}</p>
      </div>
      <div className="dialog-buttons">
        <button ref={ok} className="xp-button" onClick={onClose}>
          {t('dialog.ok')}
        </button>
      </div>
    </Dialog>
  )
}
