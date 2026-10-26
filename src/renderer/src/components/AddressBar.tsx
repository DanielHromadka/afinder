import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { displayPath, resolveDisplayPath } from '@shared/remote'
import { withShortcut } from '@renderer/lib/keys'
import { remoteMounts } from '@renderer/lib/remotes'
import { Icon } from './Icon'

export function AddressBar({
  path,
  virtualFolder,
  onNavigate,
  onLeaveVirtual
}: {
  path: string
  /** Label of the group opened as a virtual folder, shown after the real path. */
  virtualFolder: string | null
  onNavigate(path: string): void
  onLeaveVirtual(): void
}): React.JSX.Element {
  // Remote folders show as URLs (sftp://…, s3://…); typed URLs are turned back into paths.
  const shown = displayPath(path, remoteMounts())
  const [value, setValue] = useState(shown)
  useEffect(() => setValue(shown), [shown])

  return (
    <form
      className="addressbar"
      onSubmit={(e) => {
        e.preventDefault()
        onNavigate(resolveDisplayPath(value.trim(), remoteMounts()))
      }}
    >
      <span className="address-label">{t('address.label')}</span>
      <div className="address-input">
        <Icon name="folder" size={16} />
        <input
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue(shown)
              e.currentTarget.blur()
            }
          }}
        />
        {virtualFolder && (
          <button type="button" className="virtual-crumb" title={withShortcut(t('address.leaveVirtual'), 'up')} onClick={onLeaveVirtual}>
            ⟩ {virtualFolder} <span className="virtual-close">✕</span>
          </button>
        )}
      </div>
      <button type="submit" className="go-btn">
        <Icon name="go" size={18} />
        {t('address.go')}
      </button>
    </form>
  )
}
