// Lists past Claude Code, Codex and OpenCode sessions from the agents' own history (transcript folders,
// read-only and only the first part of each file; OpenCode's database), so the console can resume one. Nothing is read until the user opens the list.

import { open, readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { claudeProjectDir, parseClaude, parseCodex, SESSION_ID, type AgentSession } from '@shared/agentSessions'
import { opencodeSessions } from './opencodeStore'

/** Enough for the metadata and the first prompts; transcripts themselves can be tens of MB. */
const HEAD_BYTES = 256 * 1024
/** Newest transcripts parsed per agent. */
const MAX_FILES = 150
const MAX_RESULTS = 200

// Same locations as the agent monitor (agentTranscripts.ts) watches.
const claudeRoot = (): string => path.join(os.homedir(), '.claude')
const codexRoot = (): string => path.join(os.homedir(), '.codex')

async function head(file: string): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

const entries = (dir: string): Promise<string[]> => readdir(dir).catch(() => [])

async function newest(files: string[]): Promise<{ file: string; mtime: number }[]> {
  const stats = await Promise.all(files.map((file) => stat(file).then((s) => ({ file, mtime: s.mtimeMs }), () => null)))
  return stats.filter((s) => s !== null).sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES)
}

async function claudeSessions(folder: string | null): Promise<AgentSession[]> {
  const projects = path.join(claudeRoot(), 'projects')
  const dirs = folder ? [claudeProjectDir(folder)] : await entries(projects)
  const files: string[] = []
  for (const dir of dirs) {
    for (const name of await entries(path.join(projects, dir))) {
      if (name.endsWith('.jsonl') && SESSION_ID.test(name.slice(0, -6))) files.push(path.join(projects, dir, name))
    }
  }
  const out: AgentSession[] = []
  for (const { file, mtime } of await newest(files)) {
    const parsed = parseClaude(await head(file).catch(() => ''), path.basename(file, '.jsonl'))
    if (parsed) out.push({ ...parsed, updated: mtime })
  }
  return out
}

/** Codex keeps sessions/<year>/<month>/<day>/rollout-*.jsonl; the newest days are walked first. */
async function codexSessions(folder: string | null): Promise<AgentSession[]> {
  const root = path.join(codexRoot(), 'sessions')
  const files: string[] = []
  const desc = async (dir: string): Promise<string[]> => (await entries(dir)).sort().reverse()
  // A folder filter matches only some files, so more of them are looked at.
  const budget = folder ? MAX_FILES * 4 : MAX_FILES
  outer: for (const y of await desc(root)) {
    for (const m of await desc(path.join(root, y))) {
      for (const d of await desc(path.join(root, y, m))) {
        for (const name of await desc(path.join(root, y, m, d))) {
          if (name.endsWith('.jsonl')) files.push(path.join(root, y, m, d, name))
          if (files.length >= budget) break outer
        }
      }
    }
  }
  const stats = await Promise.all(files.map((file) => stat(file).then((s) => ({ file, mtime: s.mtimeMs }), () => null)))
  const names = await codexThreadNames()
  const out: AgentSession[] = []
  for (const s of stats) {
    if (!s) continue
    const parsed = parseCodex(await head(s.file).catch(() => ''))
    if (parsed && (!folder || parsed.cwd === folder)) out.push({ ...parsed, title: names.get(parsed.id) ?? parsed.title, updated: s.mtime })
  }
  return out
}

/** Thread names the user gave in Codex, from its session index (later lines win). */
async function codexThreadNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const text = await readFile(path.join(codexRoot(), 'session_index.jsonl'), 'utf8').catch(() => '')
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line) as { id?: unknown; thread_name?: unknown }
      if (typeof e.id === 'string' && typeof e.thread_name === 'string' && e.thread_name.trim()) names.set(e.id, e.thread_name.trim())
    } catch {
      // blank or partial line
    }
  }
  return names
}

/** Sessions of all agents, newest first; with a folder, only the ones that ran in it. */
export async function listSessions(folder: unknown): Promise<AgentSession[]> {
  const dir = typeof folder === 'string' && path.isAbsolute(folder) ? path.resolve(folder) : null
  const [claude, codex, opencode] = await Promise.all([claudeSessions(dir), codexSessions(dir), opencodeSessions(dir, MAX_FILES).catch(() => [])])
  return [...claude.filter((s) => !dir || s.cwd === dir), ...codex, ...opencode].sort((a, b) => b.updated - a.updated).slice(0, MAX_RESULTS)
}
