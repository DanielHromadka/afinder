import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { modelWindow, opencodeCandidates, opencodeSessions, OpencodeTail, opencodeTool, opencodeTranscript, sessionTitle, type OpencodeMessage } from './opencodeStore'

const ID = 'ses_ee36c3a4cffeYHrmvDe9pXVDG9'

const msg = (id: string, role: string, created: number, extra: Partial<OpencodeMessage> = {}): OpencodeMessage => ({
  id,
  role,
  created,
  completed: null,
  finish: null,
  error: false,
  provider: null,
  model: null,
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...extra
})

describe('OpenCode transcript', () => {
  it('ends a turn only when the last step does not call tools', () => {
    const s = opencodeTranscript({
      id: ID,
      title: 'Fix the sidebar',
      prompts: new Map([['u1', 'Fix the sidebar please']]),
      messages: [
        msg('u1', 'user', 1000),
        msg('a1', 'assistant', 1100, { completed: 2000, finish: 'tool-calls', provider: 'openai', model: 'gpt-6', input: 100, cacheRead: 900 }),
        msg('a2', 'assistant', 2100, { completed: 5000, finish: 'stop', provider: 'openai', model: 'gpt-6', input: 50, cacheRead: 1000, cacheWrite: 20 })
      ],
      last: { type: 'text', tool: null, title: null, input: null, text: '**Done.** The sidebar\nworks' }
    })
    expect(s.thread).toBe('Fix the sidebar')
    expect(s.turns).toEqual([{ prompt: 'Fix the sidebar please', start: 1000, durationMs: 4000 }])
    expect(s.state).toBe('idle')
    expect(s.model).toBe('gpt-6')
    expect(s.provider).toBe('openai')
    expect(s.contextTokens).toBe(1070)
    expect(s.activity).toBe('Done. The sidebar')
  })

  it('is busy while a step streams or another one follows, and idle after an error', () => {
    const base = { id: ID, title: 'New session - 2026-10-16T10:00:00.000Z', prompts: new Map([['u1', 'Go']]), last: null }
    const streaming = opencodeTranscript({ ...base, messages: [msg('u1', 'user', 1), msg('a1', 'assistant', 2)] })
    expect(streaming.state).toBe('busy')
    expect(streaming.thread).toBeNull()
    expect(streaming.turns[0].durationMs).toBeNull()
    expect(opencodeTranscript({ ...base, messages: [msg('u1', 'user', 1)] }).state).toBe('busy')
    expect(opencodeTranscript({ ...base, messages: [msg('u1', 'user', 1), msg('a1', 'assistant', 2, { completed: 3, finish: 'tool-calls' })] }).state).toBe('busy')
    const aborted = opencodeTranscript({ ...base, messages: [msg('u1', 'user', 1), msg('a1', 'assistant', 7, { error: true })] })
    expect(aborted.state).toBe('idle')
    expect(aborted.turns[0].durationMs).toBe(6)
  })

  it('names tool calls by their most telling argument', () => {
    expect(opencodeTool('bash', 'npm test', JSON.stringify({ command: 'npm test', description: 'Run the tests' }))).toBe('bash: Run the tests')
    expect(opencodeTool('read', 'src/App.tsx', JSON.stringify({ filePath: '/p/src/App.tsx' }))).toBe('read: App.tsx')
    expect(opencodeTool('glob', null, JSON.stringify({ pattern: 'src/*.ts' }))).toBe('glob: src/*.ts')
    expect(opencodeTool('todowrite', '3 todos', 'not json')).toBe('todowrite: 3 todos')
  })

  it('finds the context window of a model variant', () => {
    const windows = new Map([['openai/gpt-5.6-sol', 400_000], ['openai/gpt-5.6', 272_000]])
    expect(modelWindow(windows, 'openai', 'gpt-5.6-sol-fast')).toBe(400_000)
    expect(modelWindow(windows, 'openai', 'gpt-5.6')).toBe(272_000)
    expect(modelWindow(windows, 'anthropic', 'gpt-5.6')).toBeNull()
  })

  it('titles sessions by their own title, else the first real prompt', () => {
    expect(sessionTitle('Archive the change', ['x'])).toBe('Archive the change')
    expect(sessionTitle('New session - 2026-06-16T15:04:42.077Z', ['<system-reminder>…', 'Add   tests'])).toBe('Add tests')
    expect(sessionTitle('New session - 2026-06-16T15:04:42.077Z', [])).toBeNull()
  })
})

describe('OpenCode database', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ''
  })

  /** The tables and columns aFinder reads, as OpenCode 1.19 creates them. */
  async function database(): Promise<{ file: string; db: DatabaseSync }> {
    dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-opencode-'))
    const file = path.join(dir, 'opencode.db')
    const db = new DatabaseSync(file)
    db.exec(`
      create table session (id text primary key, parent_id text, directory text not null, title text not null,
        time_created integer not null, time_updated integer not null, time_archived integer);
      create table message (id text primary key, session_id text not null, time_created integer not null,
        time_updated integer not null, data text not null);
      create table part (id text primary key, message_id text not null, session_id text not null,
        time_created integer not null, time_updated integer not null, data text not null);`)
    return { file, db }
  }

  const insert = (db: DatabaseSync, table: 'message' | 'part', row: unknown[]): void => {
    db.prepare(table === 'message' ? 'insert into message values (?, ?, ?, ?, ?)' : 'insert into part values (?, ?, ?, ?, ?, ?)').run(...(row as string[]))
  }

  it('lists main sessions with a title, filtered by folder', async () => {
    const { file, db } = await database()
    const session = db.prepare('insert into session values (?, ?, ?, ?, ?, ?, ?)')
    session.run(ID, null, '/proj', 'Fix the sidebar', 1, 50, null)
    session.run('ses_000000000000000000000001', null, '/proj', 'New session - 2026-06-16T15:04:42.077Z', 1, 40, null)
    session.run('ses_000000000000000000000002', ID, '/proj', 'Sub-agent', 1, 60, null)
    session.run('ses_000000000000000000000003', null, '/proj', 'Archived', 1, 70, 80)
    session.run('ses_000000000000000000000004', null, '/other', 'Elsewhere', 1, 30, null)
    session.run('ses_000000000000000000000005', null, '/proj', 'New session - 2026-06-17T09:30:37.226Z', 1, 20, null)
    insert(db, 'message', ['msg_1', 'ses_000000000000000000000001', 2, 2, JSON.stringify({ role: 'user' })])
    insert(db, 'part', ['prt_1', 'msg_1', 'ses_000000000000000000000001', 2, 2, JSON.stringify({ type: 'text', text: 'note', synthetic: true })])
    insert(db, 'part', ['prt_2', 'msg_1', 'ses_000000000000000000000001', 3, 3, JSON.stringify({ type: 'text', text: 'Write the docs' })])
    db.close()

    const here = await opencodeSessions('/proj', 50, file)
    expect(here.map((s) => [s.id, s.title])).toEqual([
      [ID, 'Fix the sidebar'],
      ['ses_000000000000000000000001', 'Write the docs']
    ])
    expect(here[0]).toMatchObject({ agent: 'opencode', cwd: '/proj', updated: 50 })
    expect((await opencodeSessions(null, 50, file)).map((s) => s.cwd)).toEqual(['/proj', '/proj', '/other'])
    expect(await opencodeSessions(null, 50, path.join(dir, 'missing.db'))).toEqual([])
    expect((await opencodeCandidates('/proj', 45, file)).map((c) => c.file)).toEqual([ID])
  })

  it('follows a session and reads again only after a change', async () => {
    const { file, db } = await database()
    db.prepare('insert into session values (?, ?, ?, ?, ?, ?, ?)').run(ID, null, '/proj', 'Fix it', 1, 10, null)
    insert(db, 'message', ['msg_u', ID, 10, 10, JSON.stringify({ role: 'user' })])
    insert(db, 'part', ['prt_u', 'msg_u', ID, 10, 10, JSON.stringify({ type: 'text', text: 'Fix the bug' })])
    insert(db, 'message', ['msg_a', ID, 20, 20, JSON.stringify({ role: 'assistant', providerID: 'p', modelID: 'm', tokens: { input: 5, cache: { read: 95, write: 0 } }, time: { created: 20 } })])
    insert(db, 'part', ['prt_a', 'msg_a', ID, 21, 21, JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'npm test', description: 'Run tests' }, output: 'x'.repeat(10_000) } })])

    const tail = new OpencodeTail(ID, file)
    expect(await tail.update()).toBe(true)
    expect(tail.state).toMatchObject({ thread: 'Fix it', state: 'busy', model: 'm', contextTokens: 100, activity: 'bash: Run tests' })
    expect(tail.state.turns).toEqual([{ prompt: 'Fix the bug', start: 10, durationMs: null }])
    expect(await tail.update()).toBe(false)

    db.prepare('update message set data = ?, time_updated = 40 where id = ?').run(
      JSON.stringify({ role: 'assistant', providerID: 'p', modelID: 'm', tokens: { input: 5, cache: { read: 95, write: 0 } }, time: { created: 20, completed: 40 }, finish: 'stop' }),
      'msg_a'
    )
    db.close()
    expect(await tail.update()).toBe(true)
    expect(tail.state.state).toBe('idle')
    expect(tail.state.turns[0].durationMs).toBe(30)
  })
})
