import { t } from '@shared/i18n'
import { Icon } from './Icon'

/** `extra` sits right after the title (the Bitcoin theme's ticker). */
export function TitleBar({ title, extra }: { title: string; extra?: React.ReactNode }): React.JSX.Element {
  const w = window.api.window
  return (
    <div className={`titlebar${extra ? ' has-extra' : ''}`} onDoubleClick={w.toggleMaximize}>
      <Icon name="open" size={16} />
      <span className="titlebar-text">{title}</span>
      {extra}
      <div className="titlebar-buttons" onDoubleClick={(e) => e.stopPropagation()}>
        <button className="tb-btn" title={t('window.minimize')} onClick={w.minimize}>
          <span className="glyph-min" />
        </button>
        <button className="tb-btn" title={t('window.maximize')} onClick={w.toggleMaximize}>
          <span className="glyph-max" />
        </button>
        <button className="tb-btn tb-close" title={t('window.close')} onClick={w.close}>
          <span className="glyph-close">✕</span>
        </button>
      </div>
    </div>
  )
}
