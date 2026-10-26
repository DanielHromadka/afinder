import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@shared/i18n'
import { sessionStatus, type SessionStatus } from '@shared/consoleStatus'
import { lastOutputAt } from '@renderer/lib/consoleStream'
import { withShortcut } from '@renderer/lib/keys'
import { PROFILE_BADGE, type ConsoleSession } from './ConsolePanel'
import { Icon } from './Icon'

/** Payload of a tab being dragged to another position or pane. */
export const TAB_MIME = 'application/x-afinder-tab'
export interface TabDrag {
  pane: number
  tab: number
}

interface Props {
  pane: number
  /** `agents`: agent sessions running in the tab's folder. */
  tabs: { id: string; title: string; agents?: ConsoleSession[] }[]
  active: number
  paneActive: boolean
  onSelect(index: number): void
  onClose(index: number): void
  onNew(): void
  onContextMenu(index: number, e: React.MouseEvent): void
  onDropTab(drag: TabDrag, index: number): void
  /** Shows the agent's session in the console. */
  onOpenAgent(id: string): void
  /** Shown before the tabs (the Files area's handle in the first pane). */
  lead?: React.ReactNode
}

export function TabStrip(p: Props): React.JSX.Element {
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const indexAt = (e: React.DragEvent): number => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.tab')
    if (!tab) return p.tabs.length
    const r = tab.getBoundingClientRect()
    const i = Number(tab.dataset.index)
    return e.clientX > r.left + r.width / 2 ? i + 1 : i
  }

  return (
    <div
      className={`tabstrip${p.paneActive ? ' active' : ''}`}
      onDoubleClick={(e) => e.target === e.currentTarget && p.onNew()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropIndex(indexAt(e))
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null)
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(TAB_MIME)
        setDropIndex(null)
        if (!raw) return
        e.preventDefault()
        p.onDropTab(JSON.parse(raw) as TabDrag, indexAt(e))
      }}
    >
      {p.lead}
      {p.tabs.map((tab, i) => (
        <div
          key={tab.id}
          data-index={i}
          className={`tab${i === p.active ? ' current' : ''}${dropIndex === i ? ' drop-before' : ''}${dropIndex === i + 1 && i === p.tabs.length - 1 ? ' drop-after' : ''}`}
          title={tab.title}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_MIME, JSON.stringify({ pane: p.pane, tab: i } satisfies TabDrag))
            e.dataTransfer.effectAllowed = 'move'
          }}
          onMouseDown={(e) => {
            if (e.button === 0) p.onSelect(i)
            if (e.button === 1) {
              e.preventDefault()
              p.onClose(i)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            p.onContextMenu(i, e)
          }}
        >
          <Icon name="folder" size={14} />
          <span className="tab-title">{tab.title}</span>
          {tab.agents && tab.agents.length > 0 && <TabAgents agents={tab.agents} onOpen={p.onOpenAgent} />}
          <button
            className="tab-close"
            title={withShortcut(t('tabs.close'), 'closeTab')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => p.onClose(i)}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="tab-new" title={withShortcut(t('tabs.new'), 'newTab')} onClick={p.onNew}>
        +
      </button>
    </div>
  )
}

/** The most pressing status wins the tab's dot: an agent asking beats one working beats one done. */
const RANK: SessionStatus[] = ['waiting', 'working', 'idle']

/** Badge of the agents running in a tab's folder; hovering lists them, a click goes to the agent's console session. */
function TabAgents(p: { agents: ConsoleSession[]; onOpen(id: string): void }): React.JSX.Element {
  const [now, setNow] = useState(Date.now)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const hide = useRef<number | undefined>(undefined)
  // Output activity has no event of its own (as in the console), so the status is re-evaluated each second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => () => clearTimeout(hide.current), [])

  const status = (s: ConsoleSession): SessionStatus => sessionStatus(s, lastOutputAt(s.id), now)
  const sorted = [...p.agents].sort((a, b) => RANK.indexOf(status(a)) - RANK.indexOf(status(b)))
  const top = status(sorted[0])
  const kinds = [...new Set(sorted.map((s) => s.profile))]
  const open = (e: React.MouseEvent<HTMLElement>): void => {
    clearTimeout(hide.current)
    const r = e.currentTarget.getBoundingClientRect()
    setAt({ x: Math.min(r.left, window.innerWidth - 284), y: r.bottom + 2 })
  }
  // A short grace period lets the pointer travel from the badge to the list.
  const close = (): void => {
    clearTimeout(hide.current)
    hide.current = window.setTimeout(() => setAt(null), 200)
  }
  const go = (id: string): void => {
    setAt(null)
    p.onOpen(id)
  }

  return (
    <>
      <span
        className="tab-agents"
        onMouseEnter={open}
        onMouseLeave={close}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => go(sorted[0].id)}
      >
        <span className={`status-dot ${top}`} />
        {kinds.map((k) => (
          <span key={k} className={`console-badge ${k}`}>
            {PROFILE_BADGE[k]}
          </span>
        ))}
        {sorted.length > 1 && <span className="tab-agents-count">{sorted.length}</span>}
      </span>
      {at &&
        createPortal(
          <div className="tab-agents-popover" style={{ left: at.x, top: at.y }} onMouseEnter={() => clearTimeout(hide.current)} onMouseLeave={close}>
            <div className="tab-agents-head">{t('tabs.agents')}</div>
            {sorted.map((s) => {
              const st = status(s)
              return (
                <button key={s.id} className="tab-agents-item" title={t('tabs.agents.open')} onClick={() => go(s.id)}>
                  <span className="cs-line">
                    <span className={`console-badge ${s.profile}`}>{PROFILE_BADGE[s.profile]}</span>
                    <span className="cs-name">{s.agent?.thread || s.title}</span>
                  </span>
                  <span className="cs-status">
                    <span className={`status-dot ${st}`} />
                    <span className="cs-status-label">{t(`console.status.${st}` as const)}</span>
                  </span>
                  {s.agent?.activity && <span className="cs-activity">{s.agent.activity}</span>}
                </button>
              )
            })}
            <div className="tab-agents-hint">{t('tabs.agents.open')}</div>
          </div>,
          document.body
        )}
    </>
  )
}
