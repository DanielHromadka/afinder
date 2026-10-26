import { describe, expect, it } from 'vitest'
import { isRepoPath, layoutGraph, parseGraphLog, parseLog, parseNameStatus, parseRepoStatus, type GraphCommit } from './git'

describe('parseRepoStatus', () => {
  it('reads the branch headers, staged, unstaged, renamed, untracked and conflicted entries', () => {
    const out = [
      '# branch.oid 1234abcd',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '# stash 3',
      '1 M. N... 100644 100644 100644 aaa bbb src/a b.ts',
      '1 .M N... 100644 100644 100644 aaa bbb README.md',
      '1 MM N... 100644 100644 100644 aaa bbb both.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts',
      'old.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc clash.ts',
      '? notes.txt',
      ''
    ].join('\0')
    const r = parseRepoStatus(out)
    expect([r.branch, r.head, r.upstream, r.ahead, r.behind, r.stashes]).toEqual(['main', '1234abcd', 'origin/main', 2, 1, 3])
    expect(r.staged).toEqual([
      { path: 'src/a b.ts', state: 'modified' },
      { path: 'both.ts', state: 'modified' },
      { path: 'new.ts', from: 'old.ts', state: 'renamed' }
    ])
    expect(r.unstaged.map((c) => [c.path, c.state])).toEqual([
      ['README.md', 'modified'],
      ['both.ts', 'modified'],
      ['notes.txt', 'untracked']
    ])
    expect(r.conflicts).toEqual([{ path: 'clash.ts', state: 'conflict' }])
  })

  it('handles a detached HEAD and a repository without commits', () => {
    const r = parseRepoStatus('# branch.oid (initial)\0# branch.head (detached)\0')
    expect([r.branch, r.head, r.upstream]).toEqual([null, null, null])
  })
})

describe('parseLog', () => {
  it('splits records and fields', () => {
    const out = 'h1\x1fa1\x1fFirst\x1fAda\x1f10\x1e\nh2\x1fa2\x1fSecond, with \x1fBob\x1f20\x1e'
    expect(parseLog(out)).toEqual([
      { hash: 'h1', short: 'a1', subject: 'First', author: 'Ada', time: 10_000 },
      { hash: 'h2', short: 'a2', subject: 'Second, with ', author: 'Bob', time: 20_000 }
    ])
  })
})

describe('isRepoPath', () => {
  it('accepts work tree relative paths only', () => {
    expect(isRepoPath('src/a.ts')).toBe(true)
    expect(isRepoPath('/etc/passwd')).toBe(false)
    expect(isRepoPath('C:\\x')).toBe(false)
    expect(isRepoPath('a/../../b')).toBe(false)
    expect(isRepoPath('')).toBe(false)
  })
})

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, short: hash, parents, subject: hash, author: 'a', time: 0, refs: [] })

describe('layoutGraph', () => {
  it('keeps a linear history in one lane', () => {
    const rows = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.width)).toEqual([1, 1, 1])
    expect(rows[1].joins).toEqual([0])
    expect(rows[2].parents).toEqual([])
  })

  it('opens a lane for a merged branch and joins it at the fork point', () => {
    // m merges f into the line d → b; f branched off b.
    const rows = layoutGraph([c('m', 'd', 'f'), c('f', 'b'), c('d', 'b'), c('b', 'a'), c('a')])
    const [m, f, d, b] = rows
    expect(m.parents).toEqual([0, 1])
    expect(f.lane).toBe(1)
    expect(f.through).toEqual([0])
    expect(d.lane).toBe(0)
    expect(d.through).toEqual([1])
    // Both lanes wait for b: it sits in the first one, the second one joins it.
    expect(b.lane).toBe(0)
    expect(b.joins).toEqual([0, 1])
    expect(b.width).toBe(2)
    expect(rows[4].width).toBe(1)
  })

  it('gives unrelated branch tips their own lanes', () => {
    const rows = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')])
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0])
    expect(rows[1].through).toEqual([0])
    expect(rows[2].joins).toEqual([0, 1])
  })

  it('lets a second parent join a lane already waiting for it', () => {
    const rows = layoutGraph([c('t', 'a'), c('m', 'b', 'a'), c('b', 'a'), c('a')])
    expect(rows[1].parents).toEqual([1, 0])
  })
})

describe('parseGraphLog', () => {
  it('reads parents and decorations', () => {
    const [first, root] = parseGraphLog('aaa\x1fbbb ccc\x1fa\x1fMerge\x1fAda\x1f10\x1fHEAD -> main, origin/main, tag: v1\x1e\nbbb\x1f\x1fb\x1fInit\x1fAda\x1f5\x1f\x1e')
    expect(first.parents).toEqual(['bbb', 'ccc'])
    expect(first.refs).toEqual(['HEAD -> main', 'origin/main', 'tag: v1'])
    expect(first.time).toBe(10000)
    expect(root.parents).toEqual([])
    expect(root.refs).toEqual([])
  })
})

describe('parseNameStatus', () => {
  it('reads plain changes and renames', () => {
    expect(parseNameStatus('M\0a.txt\0R087\0old name.txt\0new name.txt\0A\0dir/b.ts\0D\0c\0')).toEqual([
      { path: 'a.txt', state: 'modified' },
      { path: 'new name.txt', from: 'old name.txt', state: 'renamed' },
      { path: 'dir/b.ts', state: 'added' },
      { path: 'c', state: 'deleted' }
    ])
  })
})
