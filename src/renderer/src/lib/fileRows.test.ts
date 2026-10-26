import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/types'
import { buildRows, type RowsInput } from './fileRows'

const file = (name: string, size: number | null, extra: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/d/${name}`,
  isDir: size === null,
  isSymlink: false,
  hidden: false,
  kind: size === null ? 'folder' : 'text',
  size,
  modified: 0,
  ...extra
})

const base = (entries: FileEntry[], over: Partial<RowsInput> = {}): RowsInput => ({
  entries,
  filter: '',
  fuzzy: false,
  showHidden: false,
  sort: { key: 'name', asc: true },
  sizes: new Map(),
  groupBy: 'none',
  virtual: null,
  collapsed: new Set(),
  path: '/d',
  searchMode: false,
  tree: false,
  expanded: new Set(),
  subLists: new Map(),
  now: 0,
  ...over
})

const names = (input: RowsInput): string[] => buildRows(input).rows.map((r) => r.entry.name)

describe('file rows', () => {
  it('puts folders first and sorts naturally, both directions', () => {
    const entries = [file('b10.txt', 1), file('b2.txt', 3), file('zeta', null), file('alpha', null)]
    expect(names(base(entries))).toEqual(['alpha', 'zeta', 'b2.txt', 'b10.txt'])
    expect(names(base(entries, { sort: { key: 'size', asc: false } }))).toEqual(['alpha', 'zeta', 'b2.txt', 'b10.txt'])
    expect(names(base(entries, { sort: { key: 'name', asc: false } }))).toEqual(['zeta', 'alpha', 'b10.txt', 'b2.txt'])
  })

  it('filters by name and keeps the matched characters', () => {
    const r = buildRows(base([file('notes.txt', 1), file('data.json', 1)], { filter: 'not' }))
    expect(r.rows.map((x) => x.entry.name)).toEqual(['notes.txt'])
    expect(r.rows[0].hits.length).toBeGreaterThan(0)
  })

  it('shows opened folders with their contents indented under them', () => {
    const sub = [file('inner.txt', 1, { path: '/d/alpha/inner.txt' }), file('.hidden', 1, { path: '/d/alpha/.hidden', hidden: true })]
    const r = buildRows(base([file('alpha', null), file('top.txt', 1)], { tree: true, expanded: new Set(['/d/alpha']), subLists: new Map([['/d/alpha', sub]]) }))
    expect(r.rows.map((x) => [x.entry.name, x.depth ?? 0])).toEqual([
      ['alpha', 0],
      ['inner.txt', 1],
      ['top.txt', 0]
    ])
  })

  it('groups with counts and sizes; a collapsed group keeps its header but no rows', () => {
    const entries = [file('a.txt', 10), file('b.txt', 5), file('c.json', 7, { kind: 'code' })]
    const open = buildRows(base(entries, { groupBy: 'kind' }))
    expect(open.groups?.map((g) => [g.count, g.bytes])).toEqual(expect.arrayContaining([[2, 15], [1, 7]]))
    const key = open.groups!.find((g) => g.count === 2)!.key
    const closed = buildRows(base(entries, { groupBy: 'kind', collapsed: new Set([key]) }))
    expect(closed.rows).toHaveLength(1)
    expect(closed.groups?.find((g) => g.key === key)?.rowCount).toBe(0)
  })
})
