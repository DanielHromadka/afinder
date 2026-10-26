import { describe, expect, it, vi } from 'vitest'
vi.mock('./ai', () => ({ runClaude: vi.fn() }))
import { automationPrompt, parseAutomationProposal } from './automationAi'
import { syncAutomation } from '@shared/automationSync'
const answer = (value: unknown): string => `shell startup text\n${JSON.stringify({ result: JSON.stringify(value), is_error: false })}\n`

describe('AI automation proposals', () => {
  it('accepts a complete proposal and keeps code as data', () => {
    const draft = syncAutomation('/source', '/destination', 60)
    expect(parseAutomationProposal(answer({ kind: 'ready', draft }))).toEqual({ kind: 'ready', draft })
  })
  it('returns clarifying questions instead of inventing missing inputs', () => {
    expect(parseAutomationProposal(answer({ kind: 'questions', questions: ['Which destination disk?'] }))).toEqual({ kind: 'questions', questions: ['Which destination disk?'] })
  })
  it('rejects errors, missing verification and unsupported triggers', () => {
    const draft = syncAutomation('/source', '/destination', 60)
    expect(() => parseAutomationProposal(JSON.stringify({ is_error: true, result: 'Sign in first' }))).toThrow('Sign in first')
    expect(() => parseAutomationProposal(answer({ kind: 'ready', draft: { ...draft, verificationScript: '' } }))).toThrow()
    expect(() => parseAutomationProposal(answer({ kind: 'ready', draft: { ...draft, trigger: { kind: 'watch' } } }))).toThrow()
    expect(() => parseAutomationProposal(answer({ kind: 'ready', draft: { ...draft, script: 'broken(' } }))).toThrow()
  })
  it('makes the execution contract and untrusted request explicit', () => {
    const prompt = automationPrompt('Sync "a" to "b"', '/current', 'cs')
    expect(prompt).toContain('independently'); expect(prompt).toContain(`Request (JSON): ${JSON.stringify('Sync "a" to "b"')}`)
    expect(prompt).toContain('no AI'); expect(prompt).toContain('missing disk must fail')
  })
})
