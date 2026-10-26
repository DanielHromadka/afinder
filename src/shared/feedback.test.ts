import { describe, expect, it } from 'vitest'
import { checkReport, issueBody, issueTitle, MAX_MESSAGE, type FeedbackReport } from './feedback'

const info = { version: '0.9.9', platform: 'darwin', os: '25.6.0', arch: 'arm64', language: 'cs', theme: 'apple' }

describe('checkReport', () => {
  it('accepts a full report and trims it', () => {
    expect(checkReport({ kind: 'bug', message: '  Crash  ', email: ' a@b.cz ', screenshot: '/9j/4AAQ', info })).toEqual({
      kind: 'bug',
      message: 'Crash',
      email: 'a@b.cz',
      screenshot: '/9j/4AAQ',
      info
    })
    expect(checkReport({ kind: 'idea', message: 'More themes', email: '' })).toEqual({ kind: 'idea', message: 'More themes' })
  })

  it('refuses what the Worker must not pass on', () => {
    expect(checkReport(null)).toBe('not an object')
    expect(checkReport({ kind: 'spam', message: 'x' })).toBe('kind')
    expect(checkReport({ kind: 'bug', message: '   ' })).toBe('message')
    expect(checkReport({ kind: 'bug', message: 'x'.repeat(MAX_MESSAGE + 1) })).toBe('message')
    expect(checkReport({ kind: 'bug', message: 'x', email: 'nope' })).toBe('email')
    // Only JPEG base64: no PNG, no arbitrary files.
    expect(checkReport({ kind: 'bug', message: 'x', screenshot: 'iVBORw0KGgo=' })).toBe('screenshot')
    expect(checkReport({ kind: 'bug', message: 'x', screenshot: '/9j/<script>' })).toBe('screenshot')
    expect(checkReport({ kind: 'bug', message: 'x', info: { ...info, theme: 1 } })).toBe('info')
  })
})

describe('issue', () => {
  const report: FeedbackReport = { kind: 'bug', message: 'Tab bar flickers @someone\nwhen | resizing', email: 'a@b.cz', info }

  it('uses the first line as a short title', () => {
    expect(issueTitle(report)).toBe('Tab bar flickers @someone')
    expect(issueTitle({ kind: 'idea', message: 'y'.repeat(200) })).toHaveLength(80)
  })

  it('lists the details, quiets mentions and links the screenshot', () => {
    const body = issueBody(report, 'https://github.com/o/r/blob/main/s.jpg?raw=true')
    expect(body).toContain('@​someone')
    expect(body).toContain('| System | darwin 25.6.0 (arm64) |')
    expect(body).toContain('| Reply to | a@​b.cz |')
    expect(body).toMatch(/!\[Screenshot\]\(https:\/\/github\.com\/o\/r\/blob\/main\/s\.jpg\?raw=true\)$/)
    expect(issueBody({ kind: 'idea', message: 'x' })).not.toContain('Screenshot')
  })
})
