import { t } from '@shared/i18n'
import type { ThemeInfoText } from '@renderer/lib/themeInfo'
import { Clock } from './Clock'

export function StatusBar(props: { left: string; middle: string; right: string; branch: string | null; info: ThemeInfoText | null }): React.JSX.Element {
  const { left, middle, right, branch, info } = props
  return (
    <div className="statusbar">
      <div className="status-field grow">{left}</div>
      <div className="status-field">{middle}</div>
      <div className="status-field">{right}</div>
      {branch && (
        <div className="status-field status-branch" title={t('git.branch')}>
          {branch}
        </div>
      )}
      {info && (
        <div className="status-field status-theme-info" title={info.title}>
          {info.text}
        </div>
      )}
      <Clock />
    </div>
  )
}
