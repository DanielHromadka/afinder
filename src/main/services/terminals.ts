// Integrated console: pseudo terminals (node-pty) running the user's shell, optionally starting an AI
// coding agent (Claude Code, Codex, OpenCode) in a folder. Output streams to the window that opened the session.
//
// The renderer can only pick a profile and a folder – never an arbitrary command line.

import { execFile } from 'node:child_process'
import os from 'node:os'
import { spawn, type IPty } from 'node-pty'
import type { WebContents } from 'electron'
import { IPC, TERMINAL_PROFILES, type TerminalProfile, type TerminalProfiles } from '@shared/types'
import { AGENT_KINDS, resumeCommand, type AgentKind } from '@shared/agentSessions'
import { AgentMonitor } from './agentMonitor'
import type { SshTarget } from './remote'

const isWindows = process.platform === 'win32'

/** Command typed into the shell for each agent profile. */
const AGENT_COMMANDS: Record<AgentKind, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode'
}

/** How the first message is passed: OpenCode's positional argument is the project folder, not a prompt. */
const promptArgs = (agent: AgentKind, quoted: string): string => (agent === 'opencode' ? ` --prompt ${quoted}` : ` ${quoted}`)

interface Session {
  pty: IPty
  owner: WebContents
  /** The end of the output, replayed when the session moves to a new window (handover). */
  tail: string
}

/** Enough for a full screen of an agent's UI and some history; a resize then makes it redraw. */
const TAIL_CHARS = 256 * 1024

export function userShell(): string {
  if (isWindows) return 'powershell.exe'
  return process.env.SHELL || os.userInfo().shell || '/bin/zsh'
}

/** Login + interactive, so the shell reads the user's profile and rc files (PATH, aliases, nvm…). */
export function shellArgs(shell: string): string[] {
  if (isWindows) return ['-NoLogo']
  return /\/(bash|zsh|fish|ksh)$/.test(shell) ? ['-l', '-i'] : ['-i']
}

export function sessionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    // Markers of whatever launched aFinder (Electron, a parent Claude Code session) must not leak into
    // the console: an agent started there would think it is a nested child session.
    if (v === undefined || k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS' || k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue
    env[k] = v
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'aFinder'
  // Apps started from the Dock or Finder get no locale; agents and shells then mangle UTF-8.
  if (!isWindows && !env.LANG) env.LANG = 'en_US.UTF-8'
  return env
}

export class TerminalService {
  private sessions = new Map<string, Session>()
  private seq = 0
  private profiles: Promise<TerminalProfiles> | null = null
  private agents = new AgentMonitor()

  /** Which agents are installed – asked through the user's shell, since the app's own PATH is minimal. */
  available(refresh = false): Promise<TerminalProfiles> {
    if (!this.profiles || refresh) this.profiles = this.detect()
    return this.profiles
  }

  /** `prompt` (agents only) starts the agent with that first message. */
  open(owner: WebContents, profile: TerminalProfile, cwd: string, cols: number, rows: number, prompt?: string): string {
    if (!TERMINAL_PROFILES.includes(profile)) throw new Error('Invalid profile.')
    const { id, pty } = this.shell(owner, cwd, cols, rows)
    // Typed into the interactive shell: when the agent quits, the user is back in a shell in that folder.
    if (profile !== 'shell') {
      const first = prompt ? promptArgs(profile, shellQuote(cleanPrompt(prompt))) : ''
      pty.write(`${AGENT_COMMANDS[profile]}${first}\r`)
      this.agents.add(id, owner, profile, cwd, pty.pid)
    }
    return id
  }

  /** Resumes an earlier agent session in its folder; the command is built from a validated session id. */
  resume(owner: WebContents, agent: AgentKind, sessionId: string, cwd: string, cols: number, rows: number): string {
    const command = resumeCommand(agent, sessionId)
    const { id, pty } = this.shell(owner, cwd, cols, rows)
    pty.write(`${command}\r`)
    this.agents.add(id, owner, agent, cwd, pty.pid, sessionId)
    return id
  }

  /**
   * A shell that runs a project command (`npm run dev`, `uv run main.py`). The command comes from
   * projectRunner, which builds it from the project's files – never from the renderer.
   */
  run(owner: WebContents, cwd: string, command: string, cols: number, rows: number): string {
    const { id, pty } = this.shell(owner, cwd, cols, rows)
    pty.write(`${command}\r`)
    return id
  }

  private shell(owner: WebContents, cwd: string, cols: number, rows: number): { id: string; pty: IPty } {
    const shell = userShell()
    const pty = spawn(shell, shellArgs(shell), {
      name: 'xterm-256color',
      cols: clamp(cols, 20, 1000),
      rows: clamp(rows, 5, 500),
      cwd,
      env: sessionEnv()
    })
    return { id: this.track(owner, pty), pty }
  }

  /**
   * A console session on an SFTP server: `ssh` straight into the folder, then the user's login shell
   * there. ssh runs without a local shell, so nothing is ever parsed locally; only the folder goes
   * to the remote shell, single-quoted. Host keys, the agent and password prompts are ssh's own.
   */
  openSsh(owner: WebContents, target: SshTarget, cols: number, rows: number): string {
    const identity = target.identity
      ? ['-i', target.identity.replace(/^~(?=$|[\\/])/, os.homedir()), '-o', 'IdentitiesOnly=yes']
      : []
    const remote = `cd ${posixQuote(target.dir)} 2>/dev/null; exec "$SHELL" -l`
    const pty = spawn(isWindows ? 'ssh.exe' : 'ssh', ['-t', '-p', String(target.port), '-l', target.user, ...identity, '--', target.host, remote], {
      name: 'xterm-256color',
      cols: clamp(cols, 20, 1000),
      rows: clamp(rows, 5, 500),
      cwd: os.homedir(),
      env: sessionEnv()
    })
    return this.track(owner, pty)
  }

  private track(owner: WebContents, pty: IPty): string {
    const id = `c${++this.seq}`
    const s: Session = { pty, owner, tail: '' }
    this.sessions.set(id, s)
    // s.owner, not owner: a handover moves the session to another window.
    pty.onData((data) => {
      s.tail = s.tail.length + data.length > TAIL_CHARS * 2 ? (s.tail + data).slice(-TAIL_CHARS) : s.tail + data
      if (!s.owner.isDestroyed()) s.owner.send(IPC.terminalData, { id, data })
    })
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.agents.remove(id)
      if (!s.owner.isDestroyed()) s.owner.send(IPC.terminalExit, { id, code: exitCode })
    })
    return id
  }

  write(owner: WebContents, id: string, data: string): void {
    const s = this.own(owner, id)
    if (s && typeof data === 'string') s.pty.write(data)
  }

  resize(owner: WebContents, id: string, cols: number, rows: number): void {
    const s = this.own(owner, id)
    if (s) s.pty.resize(clamp(cols, 20, 1000), clamp(rows, 5, 500))
  }

  close(owner: WebContents, id: string): void {
    const s = this.own(owner, id)
    if (!s) return
    this.sessions.delete(id)
    this.agents.remove(id)
    s.pty.kill()
  }

  /**
   * The window is being replaced by a new one (switching to or from native window buttons): its sessions keep
   * running and belong to the new window. Returns the recent output of each, for the new views to replay.
   */
  handover(from: WebContents, to: WebContents): Record<string, string> {
    const output: Record<string, string> = {}
    for (const [id, s] of this.sessions) {
      if (s.owner.id !== from.id) continue
      s.owner = to
      output[id] = s.tail.slice(-TAIL_CHARS)
    }
    this.agents.handover(from, to)
    return output
  }

  /** A window was closed – end its sessions. */
  forget(ownerId: number): void {
    for (const [id, s] of this.sessions) {
      if (s.owner.id !== ownerId) continue
      this.sessions.delete(id)
      this.agents.remove(id)
      s.pty.kill()
    }
  }

  dispose(): void {
    for (const [id, s] of this.sessions) {
      this.agents.remove(id)
      s.pty.kill()
    }
    this.sessions.clear()
  }

  private own(owner: WebContents, id: unknown): Session | undefined {
    const s = typeof id === 'string' ? this.sessions.get(id) : undefined
    return s && s.owner.id === owner.id ? s : undefined
  }

  private detect(): Promise<TerminalProfiles> {
    const names = Object.values(AGENT_COMMANDS)
    return new Promise((resolve) => {
      const done = (out: string): void => {
        const lines = out.split(/\r?\n/).map((l) => l.trim())
        const has = (name: string): boolean =>
          lines.some((l) => (isWindows ? l.toLowerCase().includes(`\\${name}`) : l.startsWith('/') && l.endsWith(`/${name}`)))
        const profiles = { shell: true } as TerminalProfiles
        for (const agent of AGENT_KINDS) profiles[agent] = has(AGENT_COMMANDS[agent])
        resolve(profiles)
      }
      if (isWindows) {
        execFile('where.exe', names, { timeout: 5000, windowsHide: true }, (_err, stdout) => done(String(stdout ?? '')))
        return
      }
      const shell = userShell()
      const script = names.map((n) => `command -v ${n}`).join('; ')
      execFile(shell, [...shellArgs(shell), '-c', script], { timeout: 8000, env: sessionEnv() }, (_err, stdout) =>
        done(String(stdout ?? ''))
      )
    })
  }
}

/** One line of plain text: control characters (which the shell would act on) become spaces. */
const cleanPrompt = (s: string): string =>
  s
    .slice(0, 8000)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()

/** Quoted for the user's interactive shell: PowerShell doubles single quotes, POSIX shells close and reopen them. */
export const shellQuote = (s: string): string => (isWindows ? `'${s.replace(/'/g, "''")}'` : posixQuote(s))

/** 'it'\''s' – safe inside any POSIX shell. */
const posixQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

const clamp = (n: unknown, min: number, max: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : min
