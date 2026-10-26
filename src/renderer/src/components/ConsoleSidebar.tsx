import { t } from '@shared/i18n'
import { compactTokens, shortModel, type SessionStatus } from '@shared/consoleStatus'
import { baseName } from '@shared/paths'
import { PROFILE_BADGE, type ConsoleSession } from './ConsolePanel'

interface Props {
  sessions: ConsoleSession[]
  active: string | null
  statuses: Record<string, SessionStatus>
  attention: ReadonlySet<string>
  onSelect(id: string): void
  onClose(id: string): void
}

/** The console's sessions on the left, like aTerminal's overview: what each agent works on and how far it got. */
export function ConsoleSidebar(p: Props): React.JSX.Element {
  const agents = p.sessions.filter((s) => s.profile !== 'shell' && s.exitCode === null)
  const count = (status: SessionStatus): number => agents.filter((s) => p.statuses[s.id] === status).length
  const working = count('working')
  const waiting = count('waiting')

  return (
    <aside className="console-side">
      <div className="console-side-head">
        <span>{t('console.sessions')}</span>
        <span className="console-side-summary">
          {working > 0 && (
            <span className="cs-count working" title={t('console.summary.working')}>
              <span className="status-dot working" /> {working}
            </span>
          )}
          {waiting > 0 && (
            <span className="cs-count waiting" title={t('console.summary.waiting')}>
              <span className="status-dot waiting" /> {waiting}
            </span>
          )}
        </span>
      </div>
      <div className="console-side-list">
        {p.sessions.map((s) => {
          const status = p.statuses[s.id] ?? 'ready'
          const a = s.agent
          const percent = a?.contextTokens && a.contextWindow ? Math.min(100, Math.round((a.contextTokens / a.contextWindow) * 100)) : null
          return (
            <div
              key={s.id}
              className={`cs-item${s.id === p.active ? ' current' : ''}${p.attention.has(s.id) ? ' attention' : ''}`}
              title={s.cwd}
              onMouseDown={(e) => {
                if (e.button === 0) p.onSelect(s.id)
                if (e.button === 1) p.onClose(s.id)
              }}
            >
              <div className="cs-line">
                <span className={`console-badge ${s.profile}`}>{PROFILE_BADGE[s.profile]}</span>
                <span className="cs-name">{a?.thread || s.title}</span>
                <button
                  className="tab-close"
                  title={t('console.close')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => p.onClose(s.id)}
                >
                  ✕
                </button>
              </div>
              <div className="cs-status">
                <span className={`status-dot ${status}`} />
                <span className="cs-status-label">{p.attention.has(s.id) && status !== 'waiting' ? t('console.status.done') : t(`console.status.${status}` as const)}</span>
                {a?.model && <span className="cs-model">{shortModel(a.model)}</span>}
              </div>
              {a?.activity && status !== 'ended' && (
                <div className="cs-activity" title={a.activity}>
                  {a.activity}
                </div>
              )}
              {percent !== null && (
                <div
                  className={`cs-context${percent >= 90 ? ' full' : percent >= 70 ? ' high' : ''}`}
                  title={t('console.context', { used: a!.contextTokens!.toLocaleString(), total: a!.contextWindow!.toLocaleString(), percent })}
                >
                  <span className="cs-meter">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <span>
                    {compactTokens(a!.contextTokens!)} / {compactTokens(a!.contextWindow!)} · {percent} %
                  </span>
                </div>
              )}
              <div className="cs-place">{baseName(s.cwd) || s.cwd}</div>
            </div>
          )
        })}
        {p.sessions.length === 0 && <div className="cs-empty">{t('console.empty')}</div>}
      </div>
    </aside>
  )
}
