import { describe, expect, it } from 'vitest'
import { gitLookup, isUncommitted, lineChanges, parseBlame, parseStatus } from './git'

const z = (...parts: string[]): string => parts.join('\0') + '\0'

describe('git status', () => {
  it('parses the branch line', () => {
    expect(parseStatus(z('## main...origin/main [ahead 2, behind 1]'), '')).toMatchObject({ branch: 'main', ahead: 2, behind: 1 })
    expect(parseStatus(z('## feature/x'), '')).toMatchObject({ branch: 'feature/x', ahead: 0, behind: 0 })
    expect(parseStatus(z('## No commits yet on main'), '').branch).toBe('main')
    expect(parseStatus(z('## HEAD (no branch)'), '').branch).toBe('HEAD')
  })

  it('classifies entries and skips rename sources', () => {
    const s = parseStatus(
      z('## main', ' M src/app.ts', 'A  src/new.ts', 'R  src/b.ts', 'src/a.ts', '?? notes.md', '!! node_modules/', 'UU merge.txt', ' D gone.txt'),
      ''
    )
    expect(s.files).toEqual({
      'src/app.ts': 'modified',
      'src/new.ts': 'added',
      'src/b.ts': 'renamed',
      'notes.md': 'untracked',
      'node_modules/': 'ignored',
      'merge.txt': 'conflict',
      'gone.txt': 'deleted'
    })
  })

  it('keeps only paths below the listed folder', () => {
    const s = parseStatus(z('## main', ' M src/app.ts', ' M README.md'), 'src/')
    expect(s.files).toEqual({ 'app.ts': 'modified' })
  })

  it('looks up files, folders with changes and whole folders', () => {
    const look = gitLookup(parseStatus(z('## main', ' M src/lib/a.ts', '?? src/fresh/', '!! dist/', '!! src/lib/cache.tmp'), ''))
    expect(look('src/lib/a.ts', false)).toBe('modified')
    expect(look('src', true)).toBe('modified')
    expect(look('src/lib', true)).toBe('modified')
    expect(look('src/fresh', true)).toBe('untracked')
    expect(look('src/fresh/x.ts', false)).toBe('untracked')
    expect(look('dist', true)).toBe('ignored')
    expect(look('dist/index.js', false)).toBe('ignored')
    expect(look('src/lib/cache.tmp', false)).toBe('ignored')
    expect(look('README.md', false)).toBeNull()
    expect(look('docs', true)).toBeNull()
  })
})

const A = 'a'.repeat(40)
const Z = '0'.repeat(40)

describe('git blame', () => {
  it('parses porcelain output, details only on the first group of a commit', () => {
    const out = [
      `${A} 1 1 2`,
      'author Jana Nováková',
      'author-mail <jana@example.com>',
      'author-time 1700000000',
      'author-tz +0100',
      'summary Initial import',
      'filename a.txt',
      '\tfirst',
      `${A} 2 2`,
      '\tsecond',
      `${Z} 3 3 1`,
      'author Not Committed Yet',
      'author-time 1800000000',
      'summary Version of a.txt from a.txt',
      'filename a.txt',
      '\tauthor looks like a key but is content',
      ''
    ].join('\n')
    const blame = parseBlame(out)
    expect(blame.lines).toEqual([A, A, Z])
    expect(blame.commits[A]).toEqual({ sha: A, author: 'Jana Nováková', time: 1700000000000, summary: 'Initial import' })
    expect(isUncommitted(blame.lines[2])).toBe(true)
    expect(isUncommitted(A)).toBe(false)
  })
})

describe('line changes', () => {
  it('finds nothing in equal texts', () => {
    expect(lineChanges('a\nb\nc', 'a\nb\nc')).toEqual([])
    expect(lineChanges('a\r\nb', 'a\nb')).toEqual([])
  })

  it('classifies added, modified and deleted lines', () => {
    expect(lineChanges('a\nb\nc', 'a\nx\nb\nc')).toEqual([{ kind: 'added', start: 2, end: 2 }])
    expect(lineChanges('a\nb\nc', 'a\nB\nc')).toEqual([{ kind: 'modified', start: 2, end: 2 }])
    expect(lineChanges('a\nb\nc\nd', 'a\nd')).toEqual([{ kind: 'deleted', start: 1, end: 1 }])
    expect(lineChanges('a\nb', 'b')).toEqual([{ kind: 'deleted', start: 1, end: 1 }])
  })

  it('reports several hunks in order', () => {
    expect(lineChanges('1\n2\n3\n4\n5\n6', '0\n1\n2\nX\n4\n5')).toEqual([
      { kind: 'added', start: 1, end: 1 },
      { kind: 'modified', start: 4, end: 4 },
      { kind: 'deleted', start: 6, end: 6 }
    ])
  })

  it('gives up on unrelated texts', () => {
    const many = (p: string): string => Array.from({ length: 1000 }, (_, i) => p + i).join('\n')
    expect(lineChanges(many('a'), many('b'))).toBeNull()
  })
})
