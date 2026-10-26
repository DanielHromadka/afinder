import { describe, expect, it } from 'vitest'
import { claudeProjectDir, parseClaude, parseCodex, resumeCommand } from './agentSessions'

const ID = '89cffb51-2f09-4a87-a3b4-1f0393db4f6a'
const jsonl = (...rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('agentSessions', () => {
  it('encodes Claude project folders like Claude Code', () => {
    expect(claudeProjectDir('/Users/dan/dev/attosoft/afinder')).toBe('-Users-dan-dev-attosoft-afinder')
    expect(claudeProjectDir('C:\\Work\\my app')).toBe('C--Work-my-app')
  })

  it('takes the first real prompt of a Claude session', () => {
    const head = jsonl(
      { type: 'user', cwd: '/w', isMeta: true, message: { content: 'Caveat: the messages below' } },
      { type: 'user', cwd: '/w', message: { content: '<command-name>/clear</command-name>' } },
      { type: 'user', cwd: '/w', message: { content: [{ type: 'text', text: 'Fix the\nlogin bug' }] } },
      { type: 'user', cwd: '/w', message: { content: 'second' } }
    )
    expect(parseClaude(head, ID)).toEqual({ agent: 'claude', id: ID, cwd: '/w', title: 'Fix the login bug' })
  })

  it('prefers the summary and ignores a cut-off last line', () => {
    const head = jsonl({ type: 'summary', summary: 'Image editor' }, { type: 'user', cwd: '/w', message: { content: 'hi' } }) + '{"type":"user","cw'
    expect(parseClaude(head, ID)?.title).toBe('Image editor')
  })

  it('uses the generated title, and a custom one over it', () => {
    const head = jsonl({ type: 'user', cwd: '/w', message: { content: 'hi' } }, { type: 'ai-title', aiTitle: 'Screenshot bar' })
    expect(parseClaude(head, ID)?.title).toBe('Screenshot bar')
    expect(parseClaude(head + jsonl({ type: 'custom-title', customTitle: 'Mine' }), ID)?.title).toBe('Mine')
  })

  it('skips sessions without a prompt or with a bad id', () => {
    expect(parseClaude(jsonl({ type: 'system', cwd: '/w' }), ID)).toBeNull()
    expect(parseClaude(jsonl({ type: 'user', cwd: '/w', message: { content: 'hi' } }), 'agent-1')).toBeNull()
  })

  it('reads a Codex rollout', () => {
    const head = jsonl(
      { type: 'session_meta', payload: { id: ID, cwd: '/proj' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Add tests' } }
    )
    expect(parseCodex(head)).toEqual({ agent: 'codex', id: ID, cwd: '/proj', title: 'Add tests' })
  })

  it('builds resume commands only for UUIDs', () => {
    expect(resumeCommand('claude', ID)).toBe(`claude --resume ${ID}`)
    expect(resumeCommand('codex', ID)).toBe(`codex resume ${ID}`)
    expect(() => resumeCommand('claude', `${ID}; rm -rf ~`)).toThrow()
  })

  it('resumes OpenCode only with its own ids', () => {
    expect(resumeCommand('opencode', 'ses_ee36c3a4cffeYHrmvDe9pXVDG9')).toBe('opencode -s ses_ee36c3a4cffeYHrmvDe9pXVDG9')
    expect(() => resumeCommand('opencode', ID)).toThrow()
    expect(() => resumeCommand('opencode', 'ses_abc$(id)')).toThrow()
    expect(() => resumeCommand('claude', 'ses_ee36c3a4cffeYHrmvDe9pXVDG9')).toThrow()
  })
})
