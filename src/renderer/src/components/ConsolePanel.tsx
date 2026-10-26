import { memo, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { t } from '@shared/i18n'
import { needsAttention, sessionStatus, type SessionStatus } from '@shared/consoleStatus'
import type { AgentInfo, TerminalProfile } from '@shared/types'
import { register } from '@renderer/lib/consoleHistory'
import { attach, lastOutputAt, quotePaths, takeRedraw } from '@renderer/lib/consoleStream'
import { dragging } from '@renderer/lib/dnd'
import { keys, withShortcut } from '@renderer/lib/keys'
import { ConsoleHistory } from './ConsoleHistory'
import { ConsoleSidebar } from './ConsoleSidebar'

const api = window.api

export interface ConsoleSession {
  id: string
  profile: TerminalProfile
  cwd: string
  title: string
  /** Set once the process has ended. */
  exitCode: number | null
  /** What the agent reports about itself (agent sessions only, once it has started). */
  agent?: AgentInfo
}

export const PROFILE_BADGE: Record<TerminalProfile, string> = { shell: '>_', claude: '✳', codex: '◎', opencode: '▣' }

/** Terminal colours come from the active theme's --term-* CSS variables. */
function readTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback
  return {
    background: v('--term-bg', '#0c0c0c'),
    foreground: v('--term-fg', '#cccccc'),
    cursor: v('--term-cursor', '#ffffff'),
    cursorAccent: v('--term-bg', '#0c0c0c'),
    selectionBackground: v('--term-selection', 'rgba(255, 255, 255, 0.3)')
  }
}

interface Props {
  hidden: boolean
  sessions: ConsoleSession[]
  active: string | null
  theme: string
  /** The area handle (drag to move the console, editor menu); the console bar is the area's header. */
  handle?: React.ReactNode
  sidebar: boolean
  onToggleSidebar(): void
  history: boolean
  onToggleHistory(): void
  onSelect(id: string): void
  onClose(id: string): void
  onHide(): void
  onNewMenu(e: React.MouseEvent): void
  /** Earlier agent sessions to resume. */
  onPastSessions(): void
}

/**
 * Status of every session, re-evaluated each second (output activity has no event of its own), and the
 * sessions that changed status while the user was not looking at them.
 */
function useStatuses(sessions: ConsoleSession[], active: string | null, visible: boolean): {
  statuses: Record<string, SessionStatus>
  attention: ReadonlySet<string>
} {
  const [now, setNow] = useState(Date.now)
  const [attention, setAttention] = useState<ReadonlySet<string>>(new Set())
  const prev = useRef(new Map<string, { status: SessionStatus; since: number }>())

  useEffect(() => {
    if (sessions.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [sessions.length > 0])

  const statuses: Record<string, SessionStatus> = {}
  for (const s of sessions) statuses[s.id] = sessionStatus(s, lastOutputAt(s.id), now)

  useEffect(() => {
    const flagged = new Set([...attention].filter((id) => id !== active || !visible || !document.hasFocus()))
    for (const s of sessions) {
      const status = statuses[s.id]
      const before = prev.current.get(s.id)
      if (!before) prev.current.set(s.id, { status, since: now })
      else if (before.status !== status) {
        const watched = s.id === active && visible && document.hasFocus()
        if (needsAttention(before.status, status, now - before.since, watched)) flagged.add(s.id)
        prev.current.set(s.id, { status, since: now })
      }
    }
    for (const id of prev.current.keys()) if (!statuses[id]) prev.current.delete(id)
    for (const id of flagged) if (!statuses[id]) flagged.delete(id)
    if (flagged.size !== attention.size || [...flagged].some((id) => !attention.has(id))) setAttention(flagged)
  })

  return { statuses, attention }
}

export function ConsolePanel(p: Props): React.JSX.Element {
  const { statuses, attention } = useStatuses(p.sessions, p.active, !p.hidden)
  return (
    <div className={`console${p.hidden ? ' hidden' : ''}`}>
      <div className="console-bar">
        {p.handle}
        <button
          className={`console-hide${p.sidebar ? ' on' : ''}`}
          title={t('console.sidebar')}
          aria-pressed={p.sidebar}
          onClick={p.onToggleSidebar}
        >
          ☰
        </button>
        {!p.sidebar && p.sessions.map((s) => (
          <div
            key={s.id}
            className={`console-tab${s.id === p.active ? ' current' : ''}${s.exitCode !== null ? ' exited' : ''}`}
            title={s.cwd}
            onMouseDown={(e) => {
              if (e.button === 0) p.onSelect(s.id)
              if (e.button === 1) p.onClose(s.id)
            }}
          >
            <span className={`status-dot ${statuses[s.id]}${attention.has(s.id) ? ' attention' : ''}`} />
            <span className={`console-badge ${s.profile}`}>{PROFILE_BADGE[s.profile]}</span>
            <span className="console-tab-title">{s.agent?.thread || s.title}</span>
            <button
              className="tab-close"
              title={t('console.close')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => p.onClose(s.id)}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="tab-new" title={t('console.new')} onClick={p.onNewMenu}>
          +
        </button>
        <div className="toolbar-spacer" />
        <button className="console-hide" title={t('console.past.open')} onClick={p.onPastSessions}>
          ↺
        </button>
        <button
          className={`console-hide${p.history ? ' on' : ''}`}
          title={t('console.history')}
          aria-pressed={p.history}
          onClick={p.onToggleHistory}
        >
          ⏱
        </button>
        <button className="console-hide" title={withShortcut(t('console.hide'), 'toggleConsole')} onClick={p.onHide}>
          ▾
        </button>
      </div>
      <div className="console-body">
        {p.sidebar && (
          <ConsoleSidebar
            sessions={p.sessions}
            active={p.active}
            statuses={statuses}
            attention={attention}
            onSelect={p.onSelect}
            onClose={p.onClose}
          />
        )}
        <div className="console-screen">
          {p.sessions.map((s) => (
            <XtermView key={s.id} id={s.id} exitCode={s.exitCode} visible={!p.hidden && s.id === p.active} theme={p.theme} />
          ))}
          {p.sessions.length === 0 && !p.sidebar && <div className="console-empty">{t('console.empty')}</div>}
        </div>
        {p.history && <ConsoleHistory session={p.sessions.find((s) => s.id === p.active) ?? null} status={p.active ? statuses[p.active] : undefined} />}
      </div>
    </div>
  )
}

/** Memoized: the panel re-renders every second for the statuses, the terminals need not. */
const XtermView = memo(function XtermView({ id, exitCode, visible, theme }: { id: string; exitCode: number | null; visible: boolean; theme: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current!
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, "Cascadia Mono", "DejaVu Sans Mono", monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 10_000,
      theme: readTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const refit = (): void => {
      if (host.offsetParent === null) return // hidden – keep the last size
      fit.fit()
    }
    refit()
    api.terminal.resize(id, term.cols, term.rows)
    // Moved here from a replaced window: the replayed output may start mid-screen, a resize repaints agents' UIs.
    const redraw = takeRedraw(id)
      ? setTimeout(() => {
          api.terminal.resize(id, term.cols, Math.max(5, term.rows - 1))
          setTimeout(() => api.terminal.resize(id, term.cols, term.rows), 80)
        }, 80)
      : null

    const unregister = register(id, term)
    const detach = attach(id, (data) => term.write(data))
    const input = term.onData((data) => api.terminal.write(id, data))
    const resize = term.onResize(({ cols, rows }) => api.terminal.resize(id, cols, rows))

    // ⌘C / ⌘V go through the macOS Edit menu. Elsewhere Ctrl+C must stay an interrupt, so copy and
    // paste use Ctrl+Shift+C / Ctrl+Shift+V like other Linux and Windows terminals.
    term.attachCustomKeyEventHandler((e) => {
      if (keys.isMac || e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC') {
        if (term.hasSelection()) void api.copyText(term.getSelection())
        return false
      }
      if (e.code === 'KeyV') {
        void api.readText().then((text) => text && term.paste(text))
        return false
      }
      return true
    })

    const observer = new ResizeObserver(refit)
    observer.observe(host)
    return () => {
      if (redraw) clearTimeout(redraw)
      observer.disconnect()
      detach()
      unregister()
      input.dispose()
      resize.dispose()
      term.dispose()
      termRef.current = null
    }
  }, [id])

  useEffect(() => {
    if (!visible) return
    fitRef.current?.fit()
    termRef.current?.focus()
  }, [visible])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = readTheme()
  }, [theme])

  useEffect(() => {
    if (exitCode !== null) termRef.current?.write(`\r\n\x1b[2m${t('console.exited', { code: exitCode })}\x1b[0m\r\n`)
  }, [exitCode])

  return (
    <div
      ref={hostRef}
      className={`xterm-host${visible ? '' : ' hidden'}`}
      // Files dropped on the console are typed in as quoted paths – handy for pointing an agent at files.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragging.paths = []
        const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean)
        if (paths.length === 0) return
        api.terminal.write(id, quotePaths(paths) + ' ')
        termRef.current?.focus()
      }}
    />
  )
})
