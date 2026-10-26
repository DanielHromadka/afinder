import { describe, expect, it } from 'vitest'
import { agentPid, claudeState, isAgentCommand } from './agentMonitor'

describe('agent processes', () => {
  it('recognises the agent program, not files named after it', () => {
    expect(isAgentCommand('claude', 'claude')).toBe(true)
    expect(isAgentCommand('/Users/x/.local/bin/claude --resume', 'claude')).toBe(true)
    expect(isAgentCommand('node /x/node_modules/@openai/codex/bin/codex.js', 'codex')).toBe(true)
    expect(isAgentCommand('/Users/me/.opencode/bin/opencode --prompt hi', 'opencode')).toBe(true)
    expect(isAgentCommand('node /x/node_modules/opencode-ai/bin/opencode', 'opencode')).toBe(true)
    expect(isAgentCommand('/x/opencode-server', 'opencode')).toBe(false)
    expect(isAgentCommand('vim claude.md', 'claude')).toBe(false)
    expect(isAgentCommand('claude-agent-acp', 'claude')).toBe(false)
  })

  it('finds the outermost agent process below the shell only', () => {
    const procs = new Map([
      [10, { ppid: 1, command: '-zsh' }],
      [11, { ppid: 10, command: 'node /x/bin/codex.js' }],
      [12, { ppid: 11, command: '/x/vendor/bin/codex' }],
      [20, { ppid: 1, command: 'codex' }]
    ])
    expect(agentPid(procs, 10, 'codex')).toBe(11)
    expect(agentPid(procs, 10, 'claude')).toBeNull()
  })

  it("maps Claude Code's status", () => {
    expect(claudeState('busy')).toBe('busy')
    expect(claudeState('shell')).toBe('busy')
    expect(claudeState('waiting')).toBe('waiting')
    expect(claudeState('idle')).toBe('idle')
    expect(claudeState('nonsense')).toBeNull()
  })
})
