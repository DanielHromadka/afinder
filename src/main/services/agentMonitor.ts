// Watches the agent sessions of the console and tells their window what each agent is doing: its state,
// the thread name, the last step and how full the context is. Polls only while an agent session exists.
//
// Claude Code registers every running instance in ~/.claude/sessions/<pid>.json (session id, status), so
// the agent found in the terminal's process tree leads straight to its transcript. Codex has no such
// registry; its rollout is the one created in the same folder after the agent started. OpenCode's sessions
// live in its database (opencodeStore.ts) and are matched the same way, by folder and time.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { IPC, type AgentInfo, type AgentState } from '@shared/types'
import { candidates, claudeProjectDir, codexThreadName, TranscriptTail, type AgentKind, type AgentTail, type Candidate } from './agentTranscripts'
import { opencodeCandidates, OpencodeTail } from './opencodeStore'

const POLL_MS = 2000
const LONG_WINDOW = 1_000_000
/** Clock skew between the agent's start and its first write, and coarse file system timestamps. */
const SLACK_MS = 3000

interface Watched {
  id: string
  owner: WebContents
  kind: AgentKind
  cwd: string
  startedAt: number
  /** The terminal's shell; the agent runs as its descendant. */
  shellPid: number
  tail: AgentTail | null
  /** The transcript came from the agent's own registration (not guessed from the folder). */
  exact: boolean
  last: string
}

interface Proc {
  ppid: number
  command: string
}

export class AgentMonitor {
  private watched = new Map<string, Watched>()
  private timer: NodeJS.Timeout | null = null
  private busy = false

  /**
   * `session` is the one being resumed, where only its id leads to it (OpenCode keeps writing into the old
   * session, which no match by start time would find). A newer session the agent starts still takes over.
   */
  add(id: string, owner: WebContents, kind: AgentKind, cwd: string, shellPid: number, session?: string): void {
    const tail = kind === 'opencode' && session ? new OpencodeTail(session) : null
    this.watched.set(id, { id, owner, kind, cwd, startedAt: Date.now(), shellPid, tail, exact: false, last: '' })
    this.timer ??= setInterval(() => void this.poll(), POLL_MS)
  }

  /** A window was replaced by a new one (terminals.handover): its agents report there from now on. */
  handover(from: WebContents, to: WebContents): void {
    for (const w of this.watched.values()) {
      if (w.owner.id !== from.id) continue
      w.owner = to
      w.last = '' // reports again, so the new window learns what is running
    }
  }

  remove(id: string): void {
    this.watched.delete(id)
    if (this.watched.size === 0 && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async poll(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const procs = await processTable()
      const states = new Map<string, { pid: number | null; state: AgentState | null }>()
      for (const w of this.watched.values()) {
        const pid = procs ? agentPid(procs, w.shellPid, w.kind) : null
        const reg = pid && w.kind === 'claude' ? await claudeRegistration(pid) : null
        if (reg) {
          const file = path.join(os.homedir(), '.claude', 'projects', claudeProjectDir(reg.cwd), `${reg.sessionId}.jsonl`)
          if (w.tail?.file !== file) w.tail = new TranscriptTail(file, 'claude')
          w.exact = true
        }
        states.set(w.id, { pid, state: reg?.state ?? null })
      }
      await this.guess()
      for (const w of [...this.watched.values()]) {
        const s = states.get(w.id)
        // Without a process table (Windows) the agent is assumed to run until the terminal ends.
        await this.report(w, procs ? s?.pid != null : true, s?.state ?? null)
      }
    } finally {
      this.busy = false
    }
  }

  /**
   * Finds transcripts for sessions without a registration (Codex, OpenCode, older Claude Code). Several agents may run
   * in one folder, so a file belongs to one session only, newer sessions choose first, and only files born
   * after the agent started count – an older file written to now is more likely an agent running outside
   * aFinder. A session moves on when its agent starts a newer file (a new thread).
   */
  private async guess(): Promise<void> {
    const groups = new Map<string, Watched[]>()
    for (const w of this.watched.values()) {
      const key = `${w.kind}\n${w.cwd}`
      groups.set(key, [...(groups.get(key) ?? []), w])
    }
    for (const group of groups.values()) {
      const open = group.filter((w) => !w.exact)
      if (open.length === 0) continue
      const { kind, cwd } = group[0]
      const since = Math.min(...open.map((w) => w.startedAt)) - SLACK_MS
      const found = kind === 'opencode' ? opencodeCandidates(cwd, since) : candidates(kind, cwd, since)
      const files = (await found.catch(() => [] as Candidate[])).sort((a, b) => b.mtime - a.mtime)
      const taken = new Set(group.map((w) => w.tail?.file).filter(Boolean))
      for (const w of open.sort((a, b) => b.startedAt - a.startedAt)) {
        const current = files.find((c) => c.file === w.tail?.file)
        // Where the file system does not know the birth time, the last write decides.
        const next = files.find((c) => (c.birth || c.mtime) >= w.startedAt - SLACK_MS && !taken.has(c.file))
        if (next && (!current || next.mtime > current.mtime)) {
          if (w.tail) taken.delete(w.tail.file)
          w.tail = kind === 'opencode' ? new OpencodeTail(next.file) : new TranscriptTail(next.file, kind)
          taken.add(next.file)
        }
      }
    }
  }

  private async report(w: Watched, running: boolean, registered: AgentState | null): Promise<void> {
    if (w.owner.isDestroyed()) return this.remove(w.id)
    if (w.tail) await w.tail.update().catch(() => false)
    const s = w.tail?.state
    let thread = s ? (s.customThread ?? s.thread) : null
    if (w.kind === 'codex' && s?.sessionId) thread = (await codexThreadName(s.sessionId).catch(() => null)) ?? thread
    const info: AgentInfo = {
      id: w.id,
      running,
      state: running ? (registered ?? s?.state ?? null) : null,
      thread,
      activity: s?.activity ?? null,
      model: s?.model ?? null,
      contextTokens: s?.contextTokens ?? null,
      turns: s?.turns ?? [],
      contextWindow: s?.contextWindow && w.kind === 'claude' && s.model && (await claudeLongContext(s.model)) ? Math.max(s.contextWindow, LONG_WINDOW) : (s?.contextWindow ?? null)
    }
    const key = JSON.stringify(info)
    if (key === w.last || !this.watched.has(w.id)) return
    w.last = key
    w.owner.send(IPC.terminalAgent, info)
  }
}

/** pid → parent and command line of every process; null on Windows or when ps fails. */
function processTable(): Promise<Map<number, Proc> | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      const map = new Map<number, Proc>()
      for (const line of stdout.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
        if (m) map.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] })
      }
      resolve(map)
    })
  })
}

const LAUNCHERS = new Set(['node', 'bun', 'deno'])
const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** "claude", "/x/codex --yolo", "node /x/bin/codex.js" – only the program (or a launcher's script) counts. */
export function isAgentCommand(command: string, kind: AgentKind): boolean {
  const tokens = command.trim().split(/\s+/)
  const names = [basename(tokens[0] ?? '')]
  if (LAUNCHERS.has(names[0])) names.push(basename(tokens.slice(1).find((t) => !t.startsWith('-')) ?? ''))
  return names.some((n) => n.replace(/\.(c?js|mjs)$/, '') === kind)
}

/** The outermost process of the agent below the shell (a Node launcher, not the native binary it starts). */
export function agentPid(procs: Map<number, Proc>, shellPid: number, kind: AgentKind): number | null {
  const children = new Map<number, number[]>()
  for (const [pid, p] of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), pid])
  const queue = [...(children.get(shellPid) ?? [])]
  while (queue.length) {
    const pid = queue.shift()!
    if (isAgentCommand(procs.get(pid)!.command, kind)) return pid
    queue.push(...(children.get(pid) ?? []))
  }
  return null
}

/** What a running Claude Code wrote about itself into ~/.claude/sessions/<pid>.json. */
async function claudeRegistration(pid: number): Promise<{ sessionId: string; cwd: string; state: AgentState | null } | null> {
  try {
    const r = JSON.parse(await readFile(path.join(os.homedir(), '.claude', 'sessions', `${pid}.json`), 'utf8')) as Record<string, unknown>
    if (typeof r.sessionId !== 'string' || !/^[\w-]+$/.test(r.sessionId) || typeof r.cwd !== 'string') return null
    return { sessionId: r.sessionId, cwd: r.cwd, state: claudeState(r.status) }
  } catch {
    return null
  }
}

/**
 * Transcripts name the API model without the "[1m]" of the million-token variant; the user's default model
 * in ~/.claude/settings.json (e.g. "opus[1m]") tells whether the session runs with it.
 */
async function claudeLongContext(model: string): Promise<boolean> {
  try {
    const { model: chosen } = JSON.parse(await readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')) as { model?: unknown }
    if (typeof chosen !== 'string' || !/\[1m\]$/i.test(chosen)) return false
    const base = chosen.replace(/\[1m\]$/i, '').toLowerCase()
    return base !== '' && model.toLowerCase().includes(base)
  } catch {
    return false
  }
}

/** Claude Code's status: "busy" (and "shell" for a ! command) works, "waiting" asks for permission. */
export const claudeState = (status: unknown): AgentState | null =>
  status === 'busy' || status === 'shell' ? 'busy' : status === 'waiting' ? 'waiting' : status === 'idle' ? 'idle' : null
