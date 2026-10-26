import { useEffect, useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import { AGENT_KINDS, AGENT_NAMES, type AgentKind, type AgentSession } from '@shared/agentSessions'
import { match } from '@shared/matcher'
import { resizeCursor, resizeDialog } from '@renderer/lib/dragDialog'
import { DialogTitleBar, useModalDialog } from './Dialog'
import { formatDate, formatRelative } from '@renderer/lib/format'
import { folderLabel } from '@renderer/lib/places'
import { PROFILE_BADGE } from './ConsolePanel'

interface Props {
  /** The folder of the focused tab; its sessions are listed first. */
  folder: string
  installed: Record<AgentKind, boolean>
  onResume(session: AgentSession): void
  onClose(): void
}

/** Earlier Claude Code, Codex and OpenCode conversations, read from the agents' own history, to reopen in the console. */
export function AgentSessionsDialog({ folder, installed, onResume, onClose }: Props): React.JSX.Element {
  const modal = useModalDialog(onClose)
  const [everywhere, setEverywhere] = useState(false)
  const [agent, setAgent] = useState<AgentKind | ''>('')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<AgentSession[] | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setList(null)
    setError('')
    window.api.terminal.sessions(everywhere ? null : folder).then(
      (l) => live && setList(l),
      (e: Error) => live && (setError(e.message), setList([]))
    )
    return () => {
      live = false
    }
  }, [everywhere, folder])

  const shown = useMemo(() => {
    // Case and diacritics do not matter, as in the file filter.
    return (list ?? []).filter((s) => (!agent || s.agent === agent) && match(`${s.title} ${s.cwd}`, query, false) !== null)
  }, [list, agent, query])

  const current = shown.find((s) => s.id === picked) ?? null
  const resume = (s: AgentSession | null): void => {
    if (s && installed[s.agent]) onResume(s)
  }

  return (
    <dialog
      ref={modal.ref}
      className="xp-window dialog agent-sessions-dialog"
      onPointerDown={resizeDialog}
      onPointerMove={resizeCursor}
      aria-labelledby="agent-sessions-title"
      onCancel={modal.onCancel}
    >
      <DialogTitleBar title={t('console.past.title')} titleId="agent-sessions-title" onClose={onClose} />
      <div className="agent-sessions-content">
        <div className="agent-sessions-filter">
          <input autoFocus placeholder={t('console.past.search')} aria-label={t('console.past.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label={t('console.past.agent')} value={agent} onChange={(e) => setAgent(e.target.value as AgentKind | '')}>
            <option value="">{t('console.past.allAgents')}</option>
            {AGENT_KINDS.map((a) => (
              <option key={a} value={a}>
                {AGENT_NAMES[a]}
              </option>
            ))}
          </select>
          <label className="settings-check">
            <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
            {t('console.past.everywhere')}
          </label>
        </div>
        {!everywhere && <p className="settings-note" title={folder}>{t('console.past.inFolder', { folder: folderLabel(folder) })}</p>}
        {error && <p className="activity-error" role="alert">{error}</p>}
        <div className="agent-sessions-list" role="listbox" aria-busy={list === null}>
          {list === null && <p className="settings-note">{t('preview.loading')}</p>}
          {list !== null && shown.length === 0 && <p className="settings-note">{t(everywhere ? 'console.past.none' : 'console.past.noneHere')}</p>}
          {shown.map((s) => (
            <div
              key={`${s.agent}:${s.id}`}
              role="option"
              aria-selected={s.id === picked}
              className={`as-item${s.id === picked ? ' current' : ''}${installed[s.agent] ? '' : ' unavailable'}`}
              title={`${s.cwd}\n${formatDate(s.updated)}`}
              onClick={() => setPicked(s.id)}
              onDoubleClick={() => resume(s)}
            >
              <span className={`console-badge ${s.agent}`}>{PROFILE_BADGE[s.agent]}</span>
              <span className="as-title">{s.title}</span>
              {everywhere && <span className="as-place">{folderLabel(s.cwd)}</span>}
              <span className="as-time">{formatRelative(s.updated)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="dialog-buttons">
        {current && !installed[current.agent] && <span className="settings-note">{t('console.notInstalled', { name: AGENT_NAMES[current.agent] })}</span>}
        <button className="xp-button" disabled={!current || !installed[current.agent]} onClick={() => resume(current)}>
          {t('console.past.resume')}
        </button>
        <button className="xp-button" onClick={onClose}>
          {t('preview.close')}
        </button>
      </div>
    </dialog>
  )
}
