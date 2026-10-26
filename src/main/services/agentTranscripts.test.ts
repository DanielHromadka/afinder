import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyClaude, applyCodex, candidates, claudeProjectDir, claudeTool, codexThreadName, emptyTranscript, oneLine, promptText, TranscriptTail } from './agentTranscripts'

const assistant = (content: unknown[], usage = {}, extra = {}) => ({
  type: 'assistant',
  isSidechain: false,
  message: { model: 'claude-opus-5-5', content, usage },
  ...extra
})

describe('Claude Code transcript', () => {
  it('takes the thread name, a /rename winning over the generated title', () => {
    const s = emptyTranscript()
    applyClaude(s, { type: 'ai-title', aiTitle: 'Fix the sidebar' })
    expect(s.thread).toBe('Fix the sidebar')
    applyClaude(s, { type: 'custom-title', customTitle: 'My name' })
    applyClaude(s, { type: 'ai-title', aiTitle: 'Newer title' })
    expect(s.customThread).toBe('My name')
    expect(s.thread).toBe('Newer title')
  })

  it('counts the context of the last main-thread turn and ignores sub-agents', () => {
    const s = emptyTranscript()
    applyClaude(s, assistant([], { input_tokens: 2, cache_creation_input_tokens: 4000, cache_read_input_tokens: 60000, output_tokens: 300 }))
    expect(s.contextTokens).toBe(64002)
    expect(s.contextWindow).toBe(200_000)
    applyClaude(s, assistant([], { input_tokens: 999_999 }, { isSidechain: true }))
    expect(s.contextTokens).toBe(64002)
    expect(s.model).toBe('claude-opus-5-5')
  })

  it('knows the million-token window from the model line or from the usage', () => {
    const s = emptyTranscript()
    applyClaude(s, { type: 'model', identity: { modelId: 'claude-opus-5-5[1m]' } })
    applyClaude(s, assistant([], { input_tokens: 10, cache_read_input_tokens: 1000 }))
    expect(s.model).toBe('claude-opus-5-5[1m]')
    expect(s.contextWindow).toBe(1_000_000)
    const t = emptyTranscript()
    applyClaude(t, assistant([], { cache_read_input_tokens: 250_000 }))
    expect(t.contextWindow).toBe(1_000_000)
  })

  it('describes the last step: a tool call, else the answer', () => {
    const s = emptyTranscript()
    applyClaude(s, assistant([{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]))
    expect(s.activity).toBe('Bash: Run the tests')
    applyClaude(s, assistant([{ type: 'text', text: '## Done\n\nAll good.' }]))
    expect(s.activity).toBe('Done')
    expect(claudeTool('Edit', { file_path: '/a/b/App.tsx' })).toBe('Edit: App.tsx')
    expect(claudeTool('TodoWrite', {})).toBe('TodoWrite')
  })

  it('maps a folder to the project directory name', () => {
    expect(claudeProjectDir('/Users/me/dev/a.b_c')).toBe('-Users-me-dev-a-b-c')
  })
})

describe('conversation turns', () => {
  const user = (content: unknown, timestamp: string, extra = {}) => ({ type: 'user', timestamp, message: { role: 'user', content }, ...extra })

  it('keeps typed prompts only, with how long Claude worked on each', () => {
    const s = emptyTranscript()
    applyClaude(s, user('<command-name>/clear</command-name>', '2026-10-09T10:00:00.000Z'))
    applyClaude(s, user('Fix the sidebar', '2026-10-09T10:00:01.000Z'))
    applyClaude(s, user('Base directory for this skill', '2026-10-09T10:00:02.000Z', { isMeta: true }))
    applyClaude(s, user([{ type: 'tool_result', content: 'ok' }], '2026-10-09T10:00:03.000Z'))
    expect(s.turns).toEqual([{ prompt: 'Fix the sidebar', start: Date.parse('2026-10-09T10:00:01.000Z'), durationMs: null }])
    applyClaude(s, { type: 'system', subtype: 'turn_duration', timestamp: '2026-10-09T10:02:15.000Z', durationMs: 134000 })
    expect(s.turns[0].durationMs).toBe(134_000)
    applyClaude(s, user([{ type: 'text', text: 'And\nthe tests' }, { type: 'image' }], '2026-10-09T10:05:00.000Z'))
    applyClaude(s, user([{ type: 'text', text: '[Request interrupted by user]' }], '2026-10-09T10:05:30.000Z'))
    expect(s.turns[1]).toMatchObject({ prompt: 'And the tests', durationMs: 30_000 })
  })

  it('reads Codex prompts, skipping the injected context', () => {
    const s = emptyTranscript()
    const msg = (text: string, timestamp: string) => ({ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
    applyCodex(s, msg('<environment_context>…</environment_context>', '2026-10-09T10:00:00.000Z'))
    applyCodex(s, msg('# AGENTS.md instructions for /x', '2026-10-09T10:00:00.000Z'))
    applyCodex(s, msg('Make the settings resizable', '2026-10-09T10:00:01.000Z'))
    applyCodex(s, { type: 'event_msg', timestamp: '2026-10-09T10:00:31.000Z', payload: { type: 'task_complete' } })
    expect(s.turns).toEqual([{ prompt: 'Make the settings resizable', start: Date.parse('2026-10-09T10:00:01.000Z'), durationMs: 30_000 }])
  })

  it('flattens pasted blocks', () => {
    expect(promptText('  <pasted_content id="1">\nlog line\n</pasted_content> why?')).toBe('log line why?')
  })
})

describe('Codex rollout', () => {
  it('reads session id, model, context, turn state and the last command', () => {
    const s = emptyTranscript()
    applyCodex(s, { type: 'session_meta', payload: { id: 'abc', cwd: '/x' } })
    applyCodex(s, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } })
    applyCodex(s, { type: 'event_msg', payload: { type: 'task_started' } })
    applyCodex(s, { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 179242 }, model_context_window: 258400 } } })
    applyCodex(s, { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'text(await tools.exec_command({cmd:"rg --files -g \\"x\\"",max_output_tokens:4000}));' } })
    expect(s).toMatchObject({ sessionId: 'abc', model: 'gpt-6.1-sol', contextTokens: 179242, contextWindow: 258400, state: 'busy' })
    expect(s.activity).toBe('exec: rg --files -g "x"')
    applyCodex(s, { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","ls"]}' } })
    expect(s.activity).toBe('shell: bash -lc ls')
    applyCodex(s, { type: 'event_msg', payload: { type: 'task_complete' } })
    expect(s.state).toBe('idle')
  })
})

it('shortens to one line', () => {
  expect(oneLine('\n\n**Hello** world\nmore')).toBe('Hello world')
  expect(oneLine('x'.repeat(300))).toHaveLength(160)
})

describe('files', () => {
  let dir = ''
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('follows a transcript line by line, waiting for unfinished lines', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-tr-'))
    const file = path.join(dir, 's.jsonl')
    await writeFile(file, JSON.stringify({ type: 'ai-title', aiTitle: 'Žluťoučký kůň' }) + '\n{"type":"ai-ti')
    const tail = new TranscriptTail(file, 'claude')
    expect(await tail.update()).toBe(true)
    expect(tail.state.thread).toBe('Žluťoučký kůň')
    expect(await tail.update()).toBe(false)
    await appendFile(file, 'tle","aiTitle":"Second"}\n')
    expect(await tail.update()).toBe(true)
    expect(tail.state.thread).toBe('Second')
  })

  it('finds fresh Claude transcripts of a folder and Codex rollouts started there', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-home-'))
    const cwd = '/work/proj'
    const claudeDir = path.join(dir, '.claude', 'projects', claudeProjectDir(cwd))
    await mkdir(claudeDir, { recursive: true })
    await writeFile(path.join(claudeDir, 'old.jsonl'), '{}\n')
    await utimes(path.join(claudeDir, 'old.jsonl'), new Date(0), new Date(0))
    await writeFile(path.join(claudeDir, 'new.jsonl'), '{}\n')
    const since = Date.now() - 60_000
    expect((await candidates('claude', cwd, since, dir)).map((c) => path.basename(c.file))).toEqual(['new.jsonl'])

    const d = new Date()
    const day = path.join(dir, '.codex', 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    await mkdir(day, { recursive: true })
    await writeFile(path.join(day, 'rollout-a.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'a', cwd } }) + '\n')
    await writeFile(path.join(day, 'rollout-b.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'b', cwd: '/elsewhere' } }) + '\n')
    expect((await candidates('codex', cwd, since, dir)).map((c) => path.basename(c.file))).toEqual(['rollout-a.jsonl'])

    await writeFile(path.join(dir, '.codex', 'session_index.jsonl'), '{"id":"a","thread_name":"First"}\n{"id":"b","thread_name":"Other"}\n{"id":"a","thread_name":"Renamed"}\n')
    expect(await codexThreadName('a', dir)).toBe('Renamed')
    expect(await codexThreadName('zzz', dir)).toBeNull()
  })
})
