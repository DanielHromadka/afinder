// The integrated console: profiles, sessions and the agents running in them.

/** What an integrated console session runs: the user's shell, or an AI coding agent in it. */
export const TERMINAL_PROFILES = ['shell', 'claude', 'codex', 'opencode'] as const
export type TerminalProfile = (typeof TERMINAL_PROFILES)[number]
/** Which profiles can be started (the agents must be installed). */
export type TerminalProfiles = Record<TerminalProfile, boolean>

/** A command that runs a project in a console session: a package.json script, a Python entry point or a static web server. */
export interface RunTarget {
  /** Identifies the command; the command line itself is built again in main from the files. */
  id: string
  /** The command line typed into the shell, e.g. `npm run dev`. */
  command: string
  /** The project folder it runs in. */
  cwd: string
  kind: 'node' | 'python' | 'web'
  /** Runs the clicked file itself (a Python script, or an HTML page opened in the browser). */
  file?: boolean
  /** Opened in the browser once the server listens on its port. */
  url?: string
}

export interface TerminalData {
  id: string
  data: string
}

export interface TerminalExit {
  id: string
  code: number
}

/** What the agent reports about itself: working, waiting for a permission, or done and waiting for the next prompt. */
export type AgentState = 'busy' | 'waiting' | 'idle'

/** What an agent session is doing, read from the agent's own files (Claude Code, Codex, OpenCode). */
export interface AgentInfo {
  id: string
  /** The agent is still running in the terminal (false once the user quit it back to the shell). */
  running: boolean
  /** null where the agent does not report it; the console then judges by the output. */
  state: AgentState | null
  /** Name of the conversation thread (the agent's own title for it). */
  thread: string | null
  /** The last tool call or answer, e.g. "Bash: Run tests". */
  activity: string | null
  model: string | null
  /** Tokens in the context window after the last turn. */
  contextTokens: number | null
  contextWindow: number | null
  /** The conversation so far, oldest first (the last MAX_AGENT_TURNS). */
  turns: AgentTurn[]
}

/** One prompt of the user and how long the agent worked on it. */
export interface AgentTurn {
  prompt: string
  /** When the prompt was sent (ms). */
  start: number
  /** null while the agent still works on it. */
  durationMs: number | null
}

export const MAX_AGENT_TURNS = 200
