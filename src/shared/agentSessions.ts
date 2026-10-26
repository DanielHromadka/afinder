// Past sessions of the AI agents (Claude Code, Codex, OpenCode), read from their own history so that a closed
// conversation can be resumed in the console. Only the start of each file is parsed: the folder, the id and
// a title. Pure functions, shared with the tests.

export const AGENT_KINDS = ['claude', 'codex', 'opencode'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

/** Product names, the same in every language. */
export const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

export interface AgentSession {
  agent: AgentKind
  id: string
  /** The folder the session ran in; agents resume only there. */
  cwd: string
  /** The agent's summary, else the first prompt. */
  title: string
  /** Last write to the transcript. */
  updated: number
}

/** Claude Code and Codex session ids are UUIDs; anything else is never typed into a shell. */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** OpenCode's ids: "ses_" and an alphanumeric sortable id. */
export const OPENCODE_ID = /^ses_[0-9A-Za-z]{16,40}$/

export const validSessionId = (agent: AgentKind, id: string): boolean => (agent === 'opencode' ? OPENCODE_ID : SESSION_ID).test(id)

/** Claude Code's folder for a project: every character other than a letter or digit becomes '-'. */
export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** The command line that resumes a session (typed into the user's shell). */
export function resumeCommand(agent: AgentKind, id: string): string {
  if (!validSessionId(agent, id)) throw new Error('Invalid session id')
  return agent === 'claude' ? `claude --resume ${id}` : agent === 'codex' ? `codex resume ${id}` : `opencode -s ${id}`
}

/** OpenCode names a session "New session - <ISO time>" until it has generated a title. */
export const OPENCODE_DEFAULT_TITLE = /^(New|Child) session - \d{4}-\d{2}-\d{2}T/

const MAX_TITLE = 200

/** One line, shortened; null for prompts that are really tool or command wrappers (`<command-name>` …). */
export function promptTitle(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean || clean.startsWith('<') || clean.startsWith('Caveat:')) return null
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1)}…` : clean
}

function lines(head: string): unknown[] {
  // The last line may be cut off by the read limit.
  return head
    .split('\n')
    .slice(0, -1)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter((v) => typeof v === 'object' && v !== null)
}

/**
 * Claude Code transcript (`<id>.jsonl`): cwd from any line; the title is the user's own name for the session
 * (/rename), else the one Claude Code generated, a summary line, or the first real user prompt.
 */
export function parseClaude(head: string, id: string): Omit<AgentSession, 'updated'> | null {
  let cwd: string | null = null
  let custom: string | null = null
  let summary: string | null = null
  let prompt: string | null = null
  for (const raw of lines(head)) {
    const l = raw as Record<string, unknown>
    if (!cwd && typeof l.cwd === 'string') cwd = l.cwd
    if (l.type === 'custom-title') custom = promptTitle(l.customTitle) ?? custom
    if ((l.type === 'ai-title' || l.type === 'summary') && !summary) summary = promptTitle(l.aiTitle ?? l.summary)
    if (l.type === 'user' && !prompt && l.isMeta !== true && l.isSidechain !== true) {
      const content = (l.message as { content?: unknown } | undefined)?.content
      if (typeof content === 'string') prompt = promptTitle(content)
      else if (Array.isArray(content)) prompt = promptTitle(content.find((c) => c?.type === 'text')?.text)
    }
    if (cwd && custom && prompt) break
  }
  const title = custom ?? summary ?? prompt
  return cwd && title && SESSION_ID.test(id) ? { agent: 'claude', id, cwd, title } : null
}

/** Codex rollout (`rollout-…-<id>.jsonl`): a session_meta line, then the user's messages. */
export function parseCodex(head: string): Omit<AgentSession, 'updated'> | null {
  let id: string | null = null
  let cwd: string | null = null
  let prompt: string | null = null
  for (const raw of lines(head)) {
    const l = raw as { type?: string; payload?: Record<string, unknown> }
    const p = l.payload ?? {}
    if (l.type === 'session_meta') {
      if (typeof p.id === 'string') id = p.id
      if (typeof p.cwd === 'string') cwd = p.cwd
    } else if (!prompt && l.type === 'event_msg' && p.type === 'user_message') {
      prompt = promptTitle(p.message)
    } else if (!prompt && l.type === 'response_item' && p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
      for (const c of p.content as { type?: string; text?: unknown }[]) {
        if (c?.type === 'input_text' && (prompt = promptTitle(c.text))) break
      }
    }
    if (id && cwd && prompt) break
  }
  return id && cwd && prompt && SESSION_ID.test(id) ? { agent: 'codex', id, cwd, title: prompt } : null
}
