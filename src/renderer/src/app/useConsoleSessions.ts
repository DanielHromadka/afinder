import { useEffect, useState } from 'react'
import { AGENT_NAMES, type AgentSession } from '@shared/agentSessions'
import { t } from '@shared/i18n'
import type { RunTarget, TerminalProfile, TerminalProfiles } from '@shared/types'
import { forget as forgetConsole, prime as primeConsole, quotePaths } from '@renderer/lib/consoleStream'
import { folderLabel } from '@renderer/lib/places'
import { remoteMountOf } from '@renderer/lib/remotes'
import type { ConsoleSession } from '../components/ConsolePanel'

// The integrated console's sessions: shells, agents (Claude Code, Codex, OpenCode), resumed conversations, project
// commands and container shells. Each opener starts the session in main, adds it and brings the console up.

const api = window.api

export const PROFILE_NAMES: Record<TerminalProfile, () => string> = {
  claude: () => AGENT_NAMES.claude,
  codex: () => AGENT_NAMES.codex,
  opencode: () => AGENT_NAMES.opencode,
  shell: () => t('console.shell')
}

export interface ConsoleSessions {
  sessions: ConsoleSession[]
  activeSession: string | null
  setActiveSession(id: string | null): void
  /** Installed agents (null until known). */
  profiles: TerminalProfiles | null
  refreshProfiles(): Promise<void>
  /** The active session while it still runs: paths can be typed into it. */
  liveSession: ConsoleSession | null
  /** Agents still running (not quit back to the shell) – their folder's tabs show a badge leading to them. */
  runningAgents: ConsoleSession[]
  /** `prompt` starts an agent with that first message (the AI actions on files). */
  open(profile: TerminalProfile, cwd: string, prompt?: string): Promise<void>
  /** Reopens an earlier agent conversation (claude --resume, codex resume, opencode -s) in its folder. */
  resume(session: AgentSession): Promise<boolean>
  /** A project command (npm script, Python entry point) for `path` in a new shell session. */
  run(path: string, target: RunTarget): Promise<void>
  /** A shell inside a container (docker exec); `cwd` is only where the session is listed. */
  containerShell(containerId: string, name: string, cwd: string): Promise<void>
  close(id: string): void
  /** Shows a session, e.g. an agent from a tab's badge. */
  show(id: string): void
  insertPaths(paths: string[]): void
  /** Sessions handed over from the window this one replaced; their output is replayed. */
  takeOver(sessions: ConsoleSession[], output: Record<string, string>, active: string | null): void
}

export function useConsoleSessions(options: { reveal(): void; showError(err: unknown): void }): ConsoleSessions {
  const { reveal, showError } = options
  const [sessions, setSessions] = useState<ConsoleSession[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<TerminalProfiles | null>(null)

  // Which agents are installed is asked once, through the login shell (it takes a moment).
  useEffect(() => {
    void api.terminal.profiles().then(setProfiles, () => setProfiles({ shell: true, claude: false, codex: false, opencode: false }))
  }, [])
  useEffect(() => api.terminal.onExit(({ id, code }) => setSessions((list) => list.map((s) => (s.id === id ? { ...s, exitCode: code } : s)))), [])
  useEffect(() => api.terminal.onAgent((agent) => setSessions((list) => list.map((s) => (s.id === agent.id ? { ...s, agent } : s)))), [])

  /** Adds a session started in main and shows it. */
  const add = (session: ConsoleSession): void => {
    setSessions((list) => [...list, session])
    setActiveSession(session.id)
    reveal()
  }
  const attempt = async (start: () => Promise<void>): Promise<boolean> => {
    try {
      await start()
      return true
    } catch (err) {
      showError(err)
      return false
    }
  }

  const open = async (profile: TerminalProfile, cwd: string, prompt?: string): Promise<void> => {
    await attempt(async () => {
      const id = await api.terminal.open(profile, cwd, 100, 24, prompt)
      // A shell in an SFTP folder runs on the server (main starts ssh there).
      const sftp = profile === 'shell' ? remoteMountOf(cwd)?.connection : undefined
      const title = sftp?.type === 'sftp' ? `SSH · ${sftp.username}@${sftp.host} · ${folderLabel(cwd)}` : `${PROFILE_NAMES[profile]()} · ${folderLabel(cwd)}`
      add({ id, profile, cwd, title, exitCode: null })
    })
  }

  const resume = (s: AgentSession): Promise<boolean> =>
    attempt(async () => {
      const id = await api.terminal.resume(s.agent, s.id, s.cwd, 100, 24)
      add({ id, profile: s.agent, cwd: s.cwd, title: `${PROFILE_NAMES[s.agent]()} · ${s.title}`, exitCode: null })
    })

  const run = async (path: string, target: RunTarget): Promise<void> => {
    await attempt(async () => {
      const id = await api.terminal.run(path, target.id, 100, 24)
      add({ id, profile: 'shell', cwd: target.cwd, title: `${target.command} · ${folderLabel(target.cwd)}`, exitCode: null })
    })
  }

  const containerShell = async (containerId: string, name: string, cwd: string): Promise<void> => {
    await attempt(async () => {
      const id = await api.docker.shell(containerId, 100, 24)
      add({ id, profile: 'shell', cwd, title: `docker · ${name}`, exitCode: null })
    })
  }

  const close = (id: string): void => {
    api.terminal.close(id)
    forgetConsole(id)
    setSessions((list) => {
      const rest = list.filter((s) => s.id !== id)
      setActiveSession((active) => (active === id ? (rest.at(-1)?.id ?? null) : active))
      return rest
    })
  }

  const liveSession = sessions.find((s) => s.id === activeSession && s.exitCode === null) ?? null

  return {
    sessions,
    activeSession,
    setActiveSession,
    profiles,
    refreshProfiles: () => api.terminal.profiles(true).then(setProfiles, showError),
    liveSession,
    runningAgents: sessions.filter((s) => s.profile !== 'shell' && s.exitCode === null && s.agent?.running !== false),
    open,
    resume,
    run,
    containerShell,
    close,
    show: (id) => {
      setActiveSession(id)
      reveal()
    },
    insertPaths: (paths) => {
      if (!liveSession || paths.length === 0) return
      api.terminal.write(liveSession.id, quotePaths(paths) + ' ')
      reveal()
    },
    takeOver: (list, output, active) => {
      for (const session of list) primeConsole(session.id, output[session.id] ?? '')
      setSessions(list)
      setActiveSession(active)
    }
  }
}
