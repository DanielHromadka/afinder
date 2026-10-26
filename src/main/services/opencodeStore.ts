// OpenCode keeps its sessions in a SQLite database (~/.local/share/opencode/opencode.db, in WAL mode) instead
// of transcript files. It is read here only: past sessions for the resume list, and what a running agent in
// the console is doing. A read-only connection is opened for each read (OpenCode keeps writing meanwhile),
// and every query is bound to a session id or folder through parameters.

import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { OPENCODE_DEFAULT_TITLE, OPENCODE_ID, promptTitle, type AgentSession } from '@shared/agentSessions'
import { emptyTranscript, endTurns, oneLine, promptText, startTurn, type AgentTail, type Candidate, type TranscriptState } from './agentTranscripts'

/** OpenCode puts its files in the XDG folders on every platform. */
const xdg = (name: 'XDG_DATA_HOME' | 'XDG_CACHE_HOME', fallback: string[], home: string): string =>
  process.env[name] || path.join(home, ...fallback)

export const opencodeDb = (home = os.homedir()): string => path.join(xdg('XDG_DATA_HOME', ['.local', 'share'], home), 'opencode', 'opencode.db')
const modelsFile = (home = os.homedir()): string => path.join(xdg('XDG_CACHE_HOME', ['.cache'], home), 'opencode', 'models.json')

type Row = Record<string, unknown>

/** Runs `read` on a read-only connection; null when OpenCode has no database (not installed or never run). */
async function withDb<T>(file: string, read: (db: DatabaseSync) => T): Promise<T | null> {
  if (!(await stat(file).catch(() => null))?.isFile()) return null
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 1000')
    return read(db)
  } finally {
    db.close()
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : 0)

/** The user's own text of a message: synthetic parts (editor context, "continue" after a compaction) do not count. */
const PROMPT_PARTS = `select p.message_id as message, substr(json_extract(p.data, '$.text'), 1, 4000) as text
  from part p join message m on m.id = p.message_id
  where p.session_id = ? and json_extract(m.data, '$.role') = 'user' and json_extract(p.data, '$.type') = 'text'
    and coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
  order by p.time_created, p.id`

/** The session's own title, else its first real prompt; null for a session nobody wrote into. */
export function sessionTitle(title: unknown, prompts: unknown[]): string | null {
  const own = str(title)
  if (own && !OPENCODE_DEFAULT_TITLE.test(own)) return promptTitle(own)
  for (const p of prompts) {
    const t = promptTitle(p)
    if (t) return t
  }
  return null
}

/** Main sessions (not sub-agents, not archived), newest first; with a folder, only the ones that ran in it. */
export async function opencodeSessions(folder: string | null, limit: number, file = opencodeDb()): Promise<AgentSession[]> {
  const found = await withDb(file, (db) => {
    const where = folder ? 'and directory = ?' : ''
    const rows = db
      .prepare(`select id, directory, title, time_updated from session where parent_id is null and time_archived is null ${where} order by time_updated desc limit ?`)
      .all(...(folder ? [folder, limit] : [limit])) as Row[]
    const prompts = db.prepare(`${PROMPT_PARTS} limit 5`)
    const out: AgentSession[] = []
    for (const r of rows) {
      const id = str(r.id)
      const cwd = str(r.directory)
      if (!id || !cwd || !OPENCODE_ID.test(id)) continue
      const generated = !str(r.title) || OPENCODE_DEFAULT_TITLE.test(String(r.title))
      const title = sessionTitle(r.title, generated ? (prompts.all(id) as Row[]).map((p) => p.text) : [])
      if (title) out.push({ agent: 'opencode', id, cwd, title, updated: num(r.time_updated) })
    }
    return out
  })
  return found ?? []
}

/** Sessions in `cwd` written to since `since`, shaped like transcript files for the agent monitor (file = id). */
export async function opencodeCandidates(cwd: string, since: number, file = opencodeDb()): Promise<Candidate[]> {
  const rows = await withDb(
    file,
    (db) =>
      db
        .prepare('select id, time_created, time_updated from session where parent_id is null and time_archived is null and directory = ? and time_updated >= ?')
        .all(cwd, Math.floor(since)) as Row[]
  )
  return (rows ?? []).filter((r) => typeof r.id === 'string' && OPENCODE_ID.test(r.id)).map((r) => ({ file: String(r.id), mtime: num(r.time_updated), birth: num(r.time_created) }))
}

/** One message of a session, only the fields the console shows. */
export interface OpencodeMessage {
  id: string
  role: string
  created: number
  /** When the assistant finished this step; null while it still streams. */
  completed: number | null
  /** "tool-calls" means another step follows. */
  finish: string | null
  error: boolean
  provider: string | null
  model: string | null
  input: number
  cacheRead: number
  cacheWrite: number
}

/** The last thing the assistant did: a tool call or a piece of text. */
export interface OpencodePart {
  type: string
  tool: string | null
  title: string | null
  /** The tool's input as JSON text. */
  input: string | null
  text: string | null
}

export interface OpencodeRead {
  id: string
  title: string | null
  messages: OpencodeMessage[]
  /** message id → the user's first own text in it */
  prompts: Map<string, string>
  last: OpencodePart | null
}

const base = (p: unknown): string | null => {
  const s = str(p)
  return s ? s.split(/[\\/]/).pop() || s : null
}

/** "bash: Run the tests", "edit: App.tsx" – OpenCode's tool name and the one argument that says the most. */
export function opencodeTool(tool: string, title: string | null, input: string | null): string {
  let i: Row = {}
  try {
    const parsed: unknown = input ? JSON.parse(input) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) i = parsed as Row
  } catch {
    // not JSON – the title still says something
  }
  const detail = str(i.description) ?? base(i.filePath) ?? str(title) ?? str(i.pattern) ?? str(i.query) ?? str(i.url) ?? str(i.command) ?? str(i.prompt)
  return oneLine(detail ? `${tool}: ${detail}` : tool)
}

/** What a session says so far; recomputed from its rows whenever OpenCode wrote something new. */
export function opencodeTranscript(read: OpencodeRead): TranscriptState & { provider: string | null } {
  const s = { ...emptyTranscript(), provider: null as string | null }
  s.sessionId = read.id
  s.thread = read.title && !OPENCODE_DEFAULT_TITLE.test(read.title) ? read.title : null
  for (const m of read.messages) {
    if (m.role === 'user') {
      const prompt = promptText(read.prompts.get(m.id) ?? '')
      if (prompt) startTurn(s, prompt, m.created)
      continue
    }
    if (m.model) {
      s.model = m.model
      s.provider = m.provider
    }
    const tokens = m.input + m.cacheRead + m.cacheWrite
    if (tokens > 0) s.contextTokens = tokens
    // A step that ends in tool calls is followed by another one; anything else (or an error) ends the turn.
    const done = m.completed ?? (m.error ? m.created : null)
    if (done && (m.error || m.finish !== 'tool-calls')) endTurns(s, done)
  }
  const last = read.messages.at(-1)
  if (last) s.state = last.role === 'user' || (!last.error && (last.completed === null || last.finish === 'tool-calls')) ? 'busy' : 'idle'
  if (read.last?.type === 'tool' && read.last.tool) s.activity = opencodeTool(read.last.tool, read.last.title, read.last.input)
  else if (read.last?.text) s.activity = oneLine(read.last.text)
  return s
}

const MESSAGES = `select id, time_created, json_extract(data, '$.role') as role, json_extract(data, '$.time.completed') as completed,
    json_extract(data, '$.finish') as finish, json_extract(data, '$.error') is not null as error,
    json_extract(data, '$.providerID') as provider, json_extract(data, '$.modelID') as model,
    json_extract(data, '$.tokens.input') as input, json_extract(data, '$.tokens.cache.read') as cache_read,
    json_extract(data, '$.tokens.cache.write') as cache_write
  from message where session_id = ? order by time_created, id`

/** The newest tool call or text of the assistant; tool output is left in the database. */
const LAST_PART = `select json_extract(p.data, '$.type') as type, json_extract(p.data, '$.tool') as tool,
    json_extract(p.data, '$.state.title') as title, substr(json_extract(p.data, '$.state.input'), 1, 4000) as input,
    substr(json_extract(p.data, '$.text'), 1, 2000) as text
  from part p join message m on m.id = p.message_id
  where p.session_id = ? and json_extract(m.data, '$.role') = 'assistant' and json_extract(p.data, '$.type') in ('tool', 'text')
    and coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
  order by p.time_created desc, p.id desc limit 1`

/** Follows one session in the database; a cheap change stamp decides whether the rest is read again. */
export class OpencodeTail implements AgentTail {
  state: TranscriptState = emptyTranscript()
  private stamp = ''

  constructor(
    /** The session id. */
    readonly file: string,
    private readonly db = opencodeDb()
  ) {}

  async update(): Promise<boolean> {
    const read = await withDb(this.db, (db) => {
      const head = db
        .prepare(
          `select title, time_updated, (select max(time_updated) from message where session_id = s.id) as m,
            (select max(time_updated) from part where session_id = s.id) as p from session s where id = ?`
        )
        .get(this.file) as Row | undefined
      if (!head) return null
      const stamp = `${head.time_updated}/${head.m}/${head.p}`
      if (stamp === this.stamp) return null
      const prompts = new Map<string, string>()
      for (const p of db.prepare(PROMPT_PARTS).all(this.file) as Row[]) {
        if (typeof p.message === 'string' && typeof p.text === 'string' && !prompts.has(p.message)) prompts.set(p.message, p.text)
      }
      const messages = (db.prepare(MESSAGES).all(this.file) as Row[]).map(
        (r): OpencodeMessage => ({
          id: String(r.id),
          role: String(r.role),
          created: num(r.time_created),
          completed: num(r.completed) || null,
          finish: str(r.finish),
          error: num(r.error) === 1,
          provider: str(r.provider),
          model: str(r.model),
          input: num(r.input),
          cacheRead: num(r.cache_read),
          cacheWrite: num(r.cache_write)
        })
      )
      const p = db.prepare(LAST_PART).get(this.file) as Row | undefined
      const last = p ? { type: String(p.type), tool: str(p.tool), title: str(p.title), input: str(p.input), text: str(p.text) } : null
      return { stamp, read: { id: this.file, title: str(head.title), messages, prompts, last } }
    }).catch(() => null)
    if (!read) return false
    this.stamp = read.stamp
    const { provider, ...state } = opencodeTranscript(read.read)
    state.contextWindow = state.model ? await contextWindow(provider, state.model) : null
    this.state = state
    return true
  }
}

/** "provider/model" → context window, from OpenCode's copy of models.dev; read again when it changes. */
let models: { mtime: number; windows: Map<string, number> } | null = null

async function contextWindow(provider: string | null, model: string): Promise<number | null> {
  const file = modelsFile()
  const st = await stat(file).catch(() => null)
  if (!st) return null
  if (models?.mtime !== st.mtimeMs) {
    const windows = new Map<string, number>()
    try {
      const all = JSON.parse(await readFile(file, 'utf8')) as Record<string, { models?: Record<string, { limit?: { context?: unknown } }> }>
      for (const [p, entry] of Object.entries(all)) {
        for (const [m, info] of Object.entries(entry?.models ?? {})) {
          const n = num(info?.limit?.context)
          if (n > 0) windows.set(`${p}/${m}`, n)
        }
      }
    } catch {
      // half-written or foreign file – no window then
    }
    models = { mtime: st.mtimeMs, windows }
  }
  return modelWindow(models.windows, provider, model)
}

/** Exact model first, then without trailing variants: "gpt-5.6-sol-fast" has the window of "gpt-5.6-sol". */
export function modelWindow(windows: Map<string, number>, provider: string | null, model: string): number | null {
  for (let m = model; m; m = m.includes('-') ? m.slice(0, m.lastIndexOf('-')) : '') {
    const n = windows.get(`${provider}/${m}`)
    if (n) return n
  }
  return null
}
