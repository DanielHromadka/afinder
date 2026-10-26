import { describe, expect, it } from 'vitest'
import { compactTokens, formatDuration, needsAttention, sessionStatus, shortModel } from './consoleStatus'
import type { AgentInfo } from './types'

const agent = (patch: Partial<AgentInfo>): AgentInfo => ({
  id: 'c1', running: true, state: null, thread: null, activity: null, model: null, contextTokens: null, contextWindow: null, turns: [], ...patch
})

describe('sessionStatus', () => {
  const now = 100_000
  it('prefers what the agent reports', () => {
    expect(sessionStatus({ profile: 'claude', exitCode: null, agent: agent({ state: 'busy' }) }, 0, now)).toBe('working')
    expect(sessionStatus({ profile: 'claude', exitCode: null, agent: agent({ state: 'waiting' }) }, now, now)).toBe('waiting')
    expect(sessionStatus({ profile: 'claude', exitCode: null, agent: agent({ state: 'idle' }) }, now, now)).toBe('idle')
  })
  it('treats a quiet running Codex turn as an approval prompt', () => {
    expect(sessionStatus({ profile: 'codex', exitCode: null, agent: agent({ state: 'busy' }) }, now - 1000, now)).toBe('working')
    expect(sessionStatus({ profile: 'codex', exitCode: null, agent: agent({ state: 'busy' }) }, now - 6000, now)).toBe('waiting')
    expect(sessionStatus({ profile: 'opencode', exitCode: null, agent: agent({ state: 'busy' }) }, now - 6000, now)).toBe('waiting')
  })
  it('falls back to the output, and knows quit agents and ended terminals', () => {
    expect(sessionStatus({ profile: 'claude', exitCode: null }, now - 500, now)).toBe('working')
    expect(sessionStatus({ profile: 'claude', exitCode: null }, now - 9000, now)).toBe('idle')
    expect(sessionStatus({ profile: 'claude', exitCode: null, agent: agent({ running: false }) }, now, now)).toBe('ended')
    expect(sessionStatus({ profile: 'shell', exitCode: null }, now - 9000, now)).toBe('ready')
    expect(sessionStatus({ profile: 'codex', exitCode: 0 }, now, now)).toBe('exited')
  })
})

it('asks for attention only when unwatched, for questions and longer work', () => {
  expect(needsAttention('working', 'waiting', 100, false)).toBe(true)
  expect(needsAttention('working', 'idle', 10_000, false)).toBe(true)
  expect(needsAttention('working', 'idle', 1000, false)).toBe(false)
  expect(needsAttention('working', 'idle', 10_000, true)).toBe(false)
  expect(needsAttention('ready', 'running', 10_000, false)).toBe(false)
})

it('formats tokens and models compactly', () => {
  expect(compactTokens(950)).toBe('950')
  expect(compactTokens(45_300)).toBe('45k')
  expect(compactTokens(200_000)).toBe('200k')
  expect(compactTokens(1_000_000)).toBe('1M')
  expect(compactTokens(1_250_000)).toBe('1.3M')
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus-5-5 [1m]')
})

it('formats turn durations', () => {
  expect(formatDuration(850)).toBe('<1 s')
  expect(formatDuration(42_000)).toBe('42 s')
  expect(formatDuration(134_000)).toBe('2 min 14 s')
  expect(formatDuration(3_900_000)).toBe('1 h 05 min')
})
