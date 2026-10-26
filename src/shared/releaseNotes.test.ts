import { describe, expect, it } from 'vitest'
import { bodyLines, noteLines, releaseBody, releaseCommit, sanitizeNotes } from './releaseNotes'

describe('release notes', () => {
  it('builds lines from commits: trailers replace or hide, noise and repeats drop out', () => {
    const lines = noteLines([
      { subject: 'Add the Task Manager tool', body: 'Long text\n\nCo-Authored-By: Someone <a@b.c>' },
      { subject: 'Refactor the worker', body: 'Release-Note: none' },
      { subject: 'Fix a crash in ps parsing', body: 'Release-Note: Fixed a crash when listing processes\nRelease-Note: Faster process list' },
      { subject: 'Raise the version to 1.2.0', body: '' },
      { subject: 'Add the Task Manager tool', body: '' }
    ])
    expect(lines).toEqual(['Add the Task Manager tool', 'Fixed a crash when listing processes', 'Faster process list'])
  })

  it('round-trips the commit marker through the release body', () => {
    const body = releaseBody('1.2.3', ['One', 'Two'], 'c05fd46b56c9d4be2ddc28f191bec55bf8fe4e76')
    expect(body.startsWith('- One\n- Two\n')).toBe(true)
    expect(releaseCommit(body)).toBe('c05fd46b56c9d4be2ddc28f191bec55bf8fe4e76')
    expect(bodyLines(body)).toEqual(['One', 'Two'])
    expect(releaseCommit('Add remote desktop')).toBeNull()
    expect(releaseBody('1.2.3', [], 'abcdef1')).toContain('- aFinder 1.2.3')
  })

  it('reads HTML from the Atom feed and old bodies that are a bare commit message', () => {
    expect(bodyLines('<ul>\n<li>Faster &amp; smaller</li>\n<li>New <code>tool</code></li>\n</ul>\n<!-- commit: abcdef1 -->')).toEqual(['Faster & smaller', 'New tool'])
    expect(bodyLines('Release Linux packages\n\nThe release builds AppImage…\n\nCo-Authored-By: X')).toEqual(['Release Linux packages'])
    expect(bodyLines(null)).toEqual([])
  })

  it('drops malformed bundled notes', () => {
    expect(sanitizeNotes({})).toEqual([])
    expect(sanitizeNotes([{ version: '1.0', date: '2026-01-01', notes: ['a', 3] }, { version: 2 }])).toEqual([{ version: '1.0', date: '2026-01-01', notes: ['a'] }])
  })
})
