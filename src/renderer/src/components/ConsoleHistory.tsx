import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { formatDuration, type SessionStatus } from '@shared/consoleStatus'
import type { AgentTurn } from '@shared/types'
import { reveal, shellTurns } from '@renderer/lib/consoleHistory'
import type { ConsoleSession } from './ConsolePanel'

interface Props {
  session: ConsoleSession | null
  status: SessionStatus | undefined
}

const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * The conversation of the active session on the right: each prompt, when it was sent and how long the agent
 * (or the command) ran. Clicking one scrolls the terminal to it. Re-rendered every second with the panel.
 */
export function ConsoleHistory({ session, status }: Props): React.JSX.Element {
  const turns: AgentTurn[] = !session ? [] : session.profile === 'shell' ? shellTurns(session.id) : (session.agent?.turns ?? [])
  const busy = status === 'working' || status === 'waiting' || status === 'running'
  const now = Date.now()
  // An unfinished turn runs on only while the session works; one left open by a quit agent has no duration.
  const duration = (turn: AgentTurn, i: number): number | null =>
    turn.durationMs ?? (i === turns.length - 1 && busy ? now - turn.start : null)
  const total = turns.reduce((sum, turn, i) => sum + (duration(turn, i) ?? 0), 0)

  const [picked, setPicked] = useState<number | null>(null)
  const [lost, setLost] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    setPicked(null)
    setLost(null)
    pinned.current = true
  }, [session?.id])

  // Follows new prompts unless the user scrolled up to read older ones.
  useEffect(() => {
    const list = listRef.current
    if (list && pinned.current) list.scrollTop = list.scrollHeight
  }, [turns.length, session?.id])

  return (
    <aside className="console-history">
      <div className="console-side-head">
        <span>{t('console.history.title')}</span>
        {turns.length > 0 && (
          <span className="console-side-summary" title={t('console.history.total')}>
            {turns.length} · {formatDuration(total)}
          </span>
        )}
      </div>
      <div
        ref={listRef}
        className="console-side-list"
        onScroll={(e) => {
          const l = e.currentTarget
          pinned.current = l.scrollHeight - l.scrollTop - l.clientHeight < 8
        }}
      >
        {turns.map((turn, i) => {
          const d = duration(turn, i)
          const running = turn.durationMs === null && d !== null
          return (
            <div
              key={`${turn.start}-${i}`}
              className={`ch-item${running ? ' running' : ''}${picked === turn.start ? ' current' : ''}${lost === turn.start ? ' lost' : ''}`}
              title={lost === turn.start ? t('console.history.lost') : turn.prompt}
              onClick={() => {
                if (!session) return
                setPicked(turn.start)
                setLost(reveal(session.id, turn) ? null : turn.start)
              }}
            >
              <div className="ch-prompt">{turn.prompt}</div>
              <div className="ch-meta">
                <span>{clock(turn.start)}</span>
                {running && <span className="status-dot working" />}
                <span className="ch-duration">{d === null ? '—' : formatDuration(d)}</span>
              </div>
            </div>
          )
        })}
        {turns.length === 0 && <div className="cs-empty">{t(session ? 'console.history.empty' : 'console.empty')}</div>}
      </div>
    </aside>
  )
}
