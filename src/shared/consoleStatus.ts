// Status of an integrated console session, and when it needs the user's attention. Agents report their
// own state where they can (Claude Code, Codex and OpenCode turns); otherwise the terminal output decides, as in aTerminal:
// an agent whose screen keeps changing is working, a quiet one waits.

import type { AgentInfo, TerminalProfile } from './types'

export type SessionStatus =
  /** The agent works on a task. */
  | 'working'
  /** The agent asks the user something (a permission, a question). */
  | 'waiting'
  /** The agent finished and waits for the next prompt. */
  | 'idle'
  /** A shell with output right now (a dev server, a build). */
  | 'running'
  /** A quiet shell. */
  | 'ready'
  /** The agent was quit; its shell still runs. */
  | 'ended'
  /** The terminal itself ended. */
  | 'exited'

export interface StatusInput {
  profile: TerminalProfile
  exitCode: number | null
  agent?: AgentInfo
}

/** Output within this window counts as activity (spinners redraw constantly). */
export const ACTIVE_MS = 2500
/** Codex and OpenCode do not record approval prompts: a running turn whose screen stopped changing is waiting for one. */
export const CODEX_PROMPT_MS = 5000
/** Short bursts of work (start-up, a quick answer while watching) do not ask for attention. */
export const MIN_WORK_MS = 4000

export function sessionStatus(s: StatusInput, lastOutputAt: number, now: number): SessionStatus {
  if (s.exitCode !== null) return 'exited'
  const quiet = now - lastOutputAt
  if (s.profile === 'shell') return quiet < ACTIVE_MS ? 'running' : 'ready'
  if (s.agent && !s.agent.running) return 'ended'
  switch (s.agent?.state) {
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
    case 'busy':
      return (s.profile === 'codex' || s.profile === 'opencode') && quiet >= CODEX_PROMPT_MS ? 'waiting' : 'working'
    default:
      return quiet < ACTIVE_MS ? 'working' : 'idle'
  }
}

/**
 * Whether a change of status should flag the session for the user: an agent that starts asking, or one that
 * finishes a longer piece of work – but only while the user is not looking at that session.
 */
export function needsAttention(from: SessionStatus, to: SessionStatus, workedMs: number, watched: boolean): boolean {
  if (watched || from === to) return false
  if (to === 'waiting') return true
  return from === 'working' && (to === 'idle' || to === 'ended' || to === 'exited') && workedMs >= MIN_WORK_MS
}

/** 45_300 → "45k", 1_250_000 → "1.3M". */
export function compactTokens(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(n >= 9_950_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

/** "claude-opus-5-5[1m]" → "opus-5-5 [1m]", "gpt-6.1-sol" stays. */
export const shortModel = (model: string): string => model.replace(/^claude-/, '').replace(/\[(\w+)\]$/, ' [$1]')

/** How long a turn took: 850 → "<1 s", 134_000 → "2 min 14 s", 3_900_000 → "1 h 05 min". */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 1) return '<1 s'
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}
