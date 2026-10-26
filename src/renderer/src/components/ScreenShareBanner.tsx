import { useEffect, useState } from 'react'
import type { CompanionStatus } from '@shared/types'
import { t } from '@shared/i18n'

const api = window.api

/** Shown in every window while a device watches (or controls) the screen, with a way to end it right there. */
export function ScreenShareBanner({ enabled }: { enabled: boolean }): React.JSX.Element | null {
  const [screen, setScreen] = useState<CompanionStatus['screen']>(null)
  useEffect(() => {
    // The status call would load the companion module; while it is off nothing can be shared anyway.
    if (enabled) void api.companion.status().then((s) => setScreen(s.screen), () => {})
    else setScreen(null)
    return api.companion.onChanged((s) => setScreen(s.screen))
  }, [enabled])
  if (!screen) return null
  return (
    <div className="screen-share-banner" role="status">
      <span className="screen-share-dot" aria-hidden />
      <span>{t(screen.control ? 'companion.controlling' : 'companion.sharing', { name: screen.device })}</span>
      <button className="xp-button" onClick={() => void api.companion.stopScreen()}>
        {t('companion.stopSharing')}
      </button>
    </div>
  )
}
