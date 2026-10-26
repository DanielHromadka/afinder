// Reads what an agent in the console is doing from the transcript it writes itself: Claude Code to
// ~/.claude/projects/<folder>/<session>.jsonl, Codex to ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// OpenCode keeps a database instead (opencodeStore.ts).
// Nothing here talks to the agents or the network – the files are only read, a few new bytes at a time.

import { open, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_AGENT_TURNS, type AgentState, type AgentTurn } from '@shared/types'

import { claudeProjectDir, type AgentKind } from '@shared/agentSessions'

export { claudeProjectDir, type AgentKind }

/** What one transcript says so far. */
export interface TranscriptState {
  thread: string | null
  /** /rename in Claude Code wins over the generated title. */
  customThread: string | null
  activity: string | null
  model: string | null
  contextTokens: number | null
  contextWindow: number | null
  /** Codex keeps thread names in a separate index, keyed by this id. */
  sessionId: string | null
  /** Codex: a turn is running (task_started) or finished (task_complete, turn_aborted). */
  state: AgentState | null
  turns: AgentTurn[]
}

export const emptyTranscript = (): TranscriptState => ({
  thread: null,
  customThread: null,
  activity: null,
  model: null,
  contextTokens: null,
  contextWindow: null,
  sessionId: null,
  state: null,
  turns: []
})

const CLAUDE_WINDOW = 200_000
const LONG_WINDOW = 1_000_000
const ACTIVITY_MAX = 160

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** First line, without markdown noise, shortened. */
export function oneLine(s: string): string {
  const line = s.split(/\r?\n/).map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*|`/g, '').trim()).find(Boolean) ?? ''
  return line.length > ACTIVITY_MAX ? `${line.slice(0, ACTIVITY_MAX - 1)}…` : line
}

const base = (p: unknown): string | null => {
  const s = str(p)
  return s ? s.split(/[\\/]/).pop() || s : null
}

/** "Bash: Run the tests", "Edit: App.tsx" – the tool and the one argument that says the most. */
export function claudeTool(name: string, input: Json): string {
  const detail =
    str(input.description) ??
    base(input.file_path ?? input.notebook_path) ??
    str(input.pattern) ??
    str(input.query) ??
    str(input.url) ??
    str(input.skill) ??
    str(input.command) ??
    str(input.prompt)
  return oneLine(detail ? `${name}: ${detail}` : name)
}

/** The context window of a Claude model: "[1m]" variants (or usage beyond 200k) have a million tokens. */
const claudeWindow = (model: string | null, tokens: number): number =>
  (model && /\[1m\]$/i.test(model)) || tokens > CLAUDE_WINDOW ? LONG_WINDOW : CLAUDE_WINDOW

const PROMPT_MAX = 400

/**
 * The text of a prompt the user typed, or null for what only looks like one: slash commands, their output,
 * `!` shell lines (all wrapped in tags) and notes such as "[Request interrupted by user]". Pasted blocks stay.
 */
export function promptText(text: string): string | null {
  const t = text.trim()
  if (!t || /^<(?!pasted_content)/.test(t) || /^\[Request interrupted/.test(t) || /^# AGENTS\.md/.test(t)) return null
  const flat = t.replace(/<\/?pasted_content[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > PROMPT_MAX ? `${flat.slice(0, PROMPT_MAX - 1)}…` : flat || null
}

const time = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) || 0 : 0)

export function startTurn(s: TranscriptState, prompt: string, start: number): void {
  s.turns.push({ prompt, start, durationMs: null })
  if (s.turns.length > MAX_AGENT_TURNS) s.turns.splice(0, s.turns.length - MAX_AGENT_TURNS)
}

/** The agent finished (or was stopped): every prompt still open – including ones sent mid-turn – ends now. */
export function endTurns(s: TranscriptState, end: number): void {
  if (!end) return
  for (const turn of s.turns) if (turn.durationMs === null) turn.durationMs = Math.max(0, end - turn.start)
}

/** Applies one line of a Claude Code transcript. Sub-agent (sidechain) lines do not count. */
export function applyClaude(s: TranscriptState, line: Json): void {
  if (line.isSidechain === true) return
  switch (line.type) {
    case 'custom-title':
      s.customThread = str(line.customTitle) ?? s.customThread
      return
    case 'ai-title':
      s.thread = str(line.aiTitle) ?? s.thread
      return
    case 'summary':
      s.thread ??= str(line.summary)
      return
    case 'user': {
      if (line.isMeta === true || line.isCompactSummary === true) return
      const content = obj(line.message)?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) && !content.some((c) => obj(c)?.type === 'tool_result')
        ? content.map((c) => (obj(c)?.type === 'text' ? String(obj(c)!.text ?? '') : '')).join('\n') : ''
      if (/^\s*\[Request interrupted/.test(text)) return endTurns(s, time(line.timestamp))
      const prompt = promptText(text)
      if (prompt) startTurn(s, prompt, time(line.timestamp))
      return
    }
    case 'system':
      if (line.subtype === 'turn_duration') endTurns(s, time(line.timestamp))
      return
    case 'model': {
      const id = str(obj(line.identity)?.modelId)
      if (id) {
        s.model = id
        if (s.contextTokens !== null) s.contextWindow = claudeWindow(id, s.contextTokens)
      }
      return
    }
    case 'assistant': {
      const msg = obj(line.message)
      if (!msg) return
      const model = str(msg.model)
      // A [1m] id from the "model" line is more precise than the API model name.
      if (model && model !== '<synthetic>' && !s.model?.startsWith(model)) s.model = model
      const usage = obj(msg.usage)
      if (usage && model !== '<synthetic>') {
        const tokens = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens)
        if (tokens > 0) {
          s.contextTokens = tokens
          s.contextWindow = claudeWindow(s.model, tokens)
        }
      }
      const content = Array.isArray(msg.content) ? msg.content.map(obj).filter((c): c is Json => c !== null) : []
      const tool = content.filter((c) => c.type === 'tool_use').at(-1)
      const text = content.filter((c) => c.type === 'text').map((c) => str(c.text)).filter(Boolean).at(-1)
      if (tool) s.activity = claudeTool(String(tool.name ?? 'Tool'), obj(tool.input) ?? {})
      else if (text) s.activity = oneLine(text)
      return
    }
  }
}

/** The command of a Codex exec call, from its JSON arguments or its code-mode input. */
function codexCommand(payload: Json): string | null {
  const args = str(payload.arguments)
  if (args) {
    try {
      const a = obj(JSON.parse(args))
      if (a) return str(a.title) ?? str(a.cmd) ?? (Array.isArray(a.command) ? a.command.map(String).join(' ') : str(a.command))
    } catch {
      // not JSON – fall through
    }
  }
  const input = str(payload.input)
  const cmd = input && /\bcmd\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(input)
  if (cmd) {
    try {
      return JSON.parse(`"${cmd[1]}"`) as string
    } catch {
      return cmd[1]
    }
  }
  return input
}

/** Applies one line of a Codex rollout. */
export function applyCodex(s: TranscriptState, line: Json): void {
  const p = obj(line.payload)
  if (!p) return
  if (line.type === 'session_meta') s.sessionId = str(p.id) ?? s.sessionId
  else if (line.type === 'turn_context') s.model = str(p.model) ?? s.model
  else if (line.type === 'event_msg' && p.type === 'token_count') {
    const info = obj(p.info)
    const last = obj(info?.last_token_usage)
    if (last) s.contextTokens = num(last.total_tokens) || num(last.input_tokens) + num(last.output_tokens)
    if (info && num(info.model_context_window)) s.contextWindow = num(info.model_context_window)
  } else if (line.type === 'event_msg' && p.type === 'task_started') s.state = 'busy'
  else if (line.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) {
    s.state = 'idle'
    endTurns(s, time(line.timestamp))
  }
  else if (line.type === 'event_msg' && p.type === 'thread_name_updated') s.thread = str(p.thread_name) ?? s.thread
  else if (line.type === 'response_item') {
    if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      const name = String(p.name ?? 'shell')
      const detail = codexCommand(p)
      s.activity = oneLine(detail ? `${name}: ${detail}` : name)
    } else if (p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
      // Codex also sends its environment and AGENTS.md as user messages; those start with a tag or heading.
      const prompt = promptText(p.content.map((c) => (obj(c)?.type === 'input_text' ? String(obj(c)!.text ?? '') : '')).join('\n'))
      if (prompt) startTurn(s, prompt, time(line.timestamp))
    } else if (p.type === 'message' && p.role === 'assistant' && Array.isArray(p.content)) {
      const text = p.content.map(obj).map((c) => str(c?.text)).filter(Boolean).at(-1)
      if (text) s.activity = oneLine(text)
    }
  }
}

/** Claude Code's project folder name: every character other than a letter or digit becomes "-". */

export interface Candidate {
  file: string
  /** Last write (ms). */
  mtime: number
  /** Creation (ms); 0 where the file system does not know it. */
  birth: number
}

/** Transcript files written since `since` that may belong to an agent started in `cwd`. */
export async function candidates(kind: Exclude<AgentKind, 'opencode'>, cwd: string, since: number, home = os.homedir()): Promise<Candidate[]> {
  if (kind === 'claude') return fresh(path.join(home, '.claude', 'projects', claudeProjectDir(cwd)), since)
  // Codex sorts rollouts by day; an agent started before midnight keeps writing into yesterday's folder.
  const days = [...new Set([since, Date.now()].map((t) => {
    const d = new Date(t)
    return path.join(home, '.codex', 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()))
  }))]
  const all = (await Promise.all(days.map((d) => fresh(d, since)))).flat()
  const out: Candidate[] = []
  for (const c of all) if ((await codexMeta(c.file))?.cwd === cwd) out.push(c)
  return out
}

const pad = (n: number): string => String(n).padStart(2, '0')

async function fresh(dir: string, since: number): Promise<Candidate[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const out: Candidate[] = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(dir, name)
    const st = await stat(file).catch(() => null)
    if (st?.isFile() && st.mtimeMs >= since) out.push({ file, mtime: st.mtimeMs, birth: st.birthtimeMs || 0 })
  }
  return out
}

interface CodexMeta {
  id: string | null
  cwd: string | null
}

/** Session id and folder of a Codex rollout, from its first line; they never change, so they are cached. */
const codexMetas = new Map<string, CodexMeta>()
export async function codexMeta(file: string): Promise<CodexMeta | null> {
  if (codexMetas.has(file)) return codexMetas.get(file)!
  const head = await readRange(file, 0, 64 * 1024).catch(() => '')
  // The first line carries the whole base prompt and is often longer than this – take the fields directly.
  const cut = head.indexOf('"base_instructions"')
  const meta = cut < 0 ? head : head.slice(0, cut)
  const field = (name: string): string | null => {
    const m = new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`).exec(meta)
    if (!m) return null
    try {
      return JSON.parse(`"${m[1]}"`) as string
    } catch {
      return m[1]
    }
  }
  if (!head.includes('"session_meta"')) return null // not written yet
  const found = { id: field('id'), cwd: field('cwd') }
  codexMetas.set(file, found)
  return found
}

async function readBytes(file: string, start: number, length: number): Promise<Buffer> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await fh.read(buf, 0, length, start)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

const readRange = async (file: string, start: number, length: number): Promise<string> =>
  (await readBytes(file, start, length)).toString('utf8')

/** A long transcript is read from this far before its end the first time; titles repeat often enough. */
const FIRST_READ_MAX = 8 * 1024 * 1024
const READ_CHUNK = 4 * 1024 * 1024

/** What the agent monitor follows for one session: a transcript file, or a session in OpenCode's database. */
export interface AgentTail {
  /** The transcript file, or the session id where there is no file. */
  readonly file: string
  readonly state: TranscriptState
  /** Returns whether anything new was read. */
  update(): Promise<boolean>
}

/** Follows one transcript file: each update() parses only the complete lines appended since the last one. */
export class TranscriptTail implements AgentTail {
  readonly state = emptyTranscript()
  private offset = -1

  constructor(
    readonly file: string,
    private readonly kind: Exclude<AgentKind, 'opencode'>
  ) {}

  /** Returns whether anything new was read. */
  async update(): Promise<boolean> {
    const st = await stat(this.file).catch(() => null)
    if (!st) return false
    let skipFirst = false
    if (this.offset < 0 && this.kind === 'codex') this.state.sessionId = (await codexMeta(this.file))?.id ?? null
    if (this.offset < 0 || st.size < this.offset) {
      // First read (or the file was rewritten): start near the end, dropping the cut first line.
      this.offset = Math.max(0, st.size - FIRST_READ_MAX)
      skipFirst = this.offset > 0
    }
    let changed = false
    while (st.size > this.offset) {
      const buf = await readBytes(this.file, this.offset, Math.min(st.size - this.offset, READ_CHUNK)).catch(() => null)
      if (!buf?.length) break
      const end = buf.lastIndexOf(0x0a)
      if (end < 0) {
        // An unfinished line: wait for the rest, unless it alone is bigger than a chunk (then skip it).
        if (buf.length === READ_CHUNK) this.offset += buf.length
        break
      }
      this.offset += end + 1
      const lines = buf.subarray(0, end).toString('utf8').split('\n')
      if (skipFirst) lines.shift()
      skipFirst = false
      this.apply(lines)
      changed = true
    }
    return changed
  }

  private apply(lines: string[]): void {
    const apply = this.kind === 'claude' ? applyClaude : applyCodex
    for (const l of lines) {
      if (!l.trim()) continue
      try {
        const line = obj(JSON.parse(l))
        if (line) apply(this.state, line)
      } catch {
        // a damaged line – skip it
      }
    }
  }
}

/** Codex thread names live in ~/.codex/session_index.jsonl, appended on every rename; the last entry wins. */
export async function codexThreadName(sessionId: string, home = os.homedir()): Promise<string | null> {
  const file = path.join(home, '.codex', 'session_index.jsonl')
  const st = await stat(file).catch(() => null)
  if (!st) return null
  const start = Math.max(0, st.size - 256 * 1024)
  const text = await readRange(file, start, st.size - start).catch(() => '')
  let name: string | null = null
  for (const l of text.split('\n')) {
    if (!l.includes(sessionId)) continue
    try {
      const e = obj(JSON.parse(l))
      if (e?.id === sessionId) name = str(e.thread_name) ?? name
    } catch {
      // partial first line
    }
  }
  return name
}
