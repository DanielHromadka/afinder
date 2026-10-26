// Mac App Store build only: the sandbox shows aFinder just the folders the user granted. The offer comes
// at every start until something is granted; the settings list what was granted and add more.
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'

export function useDiskGrants(): [string[] | null, () => void] {
  const [grants, setGrants] = useState<string[] | null>(null)
  const reload = (): void => void window.api.diskAccess.list().then(setGrants, () => setGrants([]))
  useEffect(reload, [])
  return [grants, reload]
}

/** Shown over the window like the tour offer; picking the whole disk makes the build work like the web one. */
export function DiskAccessOffer({ onGranted, onDismiss }: { onGranted(path: string): void; onDismiss(): void }): React.JSX.Element {
  const grant = (): void =>
    void window.api.diskAccess.grant('/').then((p) => p && onGranted(p))
  return (
    <div className="tour-offer" role="status">
      <button className="tour-offer-close" title={t('diskAccess.later')} onClick={onDismiss}>
        ✕
      </button>
      <strong>{t('diskAccess.title')}</strong>
      <p>{t('diskAccess.offer')}</p>
      <div className="tour-buttons">
        <span className="tour-spacer" />
        <button className="xp-button" onClick={onDismiss}>
          {t('diskAccess.later')}
        </button>
        <button className="xp-button tour-next" onClick={grant}>
          {t('diskAccess.grantDisk')}
        </button>
      </div>
    </div>
  )
}

export function DiskAccessSettings(): React.JSX.Element {
  const [grants, reload] = useDiskGrants()
  return (
    <div className="settings-field disk-access">
      <span>{t('diskAccess.title')}</span>
      {grants?.length ? (
        <ul className="disk-access-list">
          {grants.map((p) => (
            <li key={p}>
              <code>{p === '/' ? 'Macintosh HD' : p}</code>
              <button className="link-button" onClick={() => void window.api.diskAccess.revoke(p).then(reload)}>
                {t('diskAccess.remove')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-note">{t('diskAccess.none')}</p>
      )}
      <p className="settings-note">
        <button className="link-button" onClick={() => void window.api.diskAccess.grant(grants?.length ? undefined : '/').then(reload)}>
          {t('diskAccess.add')}
        </button>{' '}
        {t('diskAccess.hint')}
      </p>
    </div>
  )
}
