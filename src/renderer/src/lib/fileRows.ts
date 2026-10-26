import { locale } from '@shared/i18n'
import { match } from '@shared/matcher'
import { relativeDir } from '@shared/paths'
import type { FileEntry, GroupBy, SizeUpdate } from '@shared/types'
import type { ListGroup, Row, Sort, SortKey } from '../components/FileList'
import { compareGroups, GROUP_DEFAULT_ASC, GROUP_SORT_KEY, groupOf, type Group } from './grouping'
import { kindLabel } from './kinds'

// The rows a tab shows: its entries (or search results) filtered, sorted, grouped and, in the details view,
// with the contents of opened folders indented under them. Pure, so the order rules can be tested.

export interface RowsInput {
  /** The folder's entries or the search results, hidden files already left out where they should be. */
  entries: FileEntry[]
  filter: string
  fuzzy: boolean
  showHidden: boolean
  sort: Sort
  sizes: Map<string, SizeUpdate>
  groupBy: GroupBy
  /** The group opened as a virtual folder. */
  virtual: { key: string } | null
  collapsed: Set<string>
  /** The tab's folder, for the Location column of search results. */
  path: string | null
  /** Search results: their folder sizes are not computed. */
  searchMode: boolean
  /** Opened folders and their contents, shown when `tree` is on. */
  tree: boolean
  expanded: Set<string>
  subLists: Map<string, FileEntry[]>
  now: number
}

export function buildRows(input: RowsInput): { rows: Row[]; groups: ListGroup[] | null } {
  const { entries, filter, fuzzy, showHidden, sort, sizes, groupBy, virtual, collapsed, path, searchMode, tree, expanded, subLists, now } = input
  const collator = new Intl.Collator(locale(), { numeric: true, sensitivity: 'base' })
  const sizeOf = (e: FileEntry): number => e.size ?? sizes.get(e.path)?.size ?? -1
  const grouped = groupBy !== 'none'
  const out: (Row & { group: Group | null })[] = []
  for (const entry of entries) {
    const hits = match(entry.name, filter, fuzzy)
    if (!hits) continue
    const group = grouped ? groupOf(entry, groupBy, now, sizeOf) : null
    if (virtual && group?.key !== virtual.key) continue
    out.push({ entry, hits, group })
  }

  const cmp: Record<SortKey, (a: FileEntry, b: FileEntry) => number> = {
    name: (a, b) => collator.compare(a.name, b.name),
    size: (a, b) => sizeOf(a) - sizeOf(b),
    kind: (a, b) => collator.compare(kindLabel(a), kindLabel(b)),
    modified: (a, b) => a.modified - b.modified,
    location: (a, b) => (path ? collator.compare(relativeDir(a.path, path), relativeDir(b.path, path)) : 0)
  }
  const dir = sort.asc ? 1 : -1
  const order = (a: FileEntry, b: FileEntry): number =>
    Number(b.isDir) - Number(a.isDir) || // folders always first
    dir * cmp[sort.key](a, b) ||
    collator.compare(a.name, b.name)
  const groupDir = (GROUP_SORT_KEY[groupBy] === sort.key ? sort.asc : GROUP_DEFAULT_ASC[groupBy]) ? 1 : -1
  out.sort(
    (x, y) =>
      (x.group && y.group ? Number(!!y.group.pinned) - Number(!!x.group.pinned) || groupDir * compareGroups(x.group, y.group) : 0) ||
      order(x.entry, y.entry)
  )

  // Opened folders: their contents follow them, indented, filtered and sorted like the top level.
  if (tree && expanded.size > 0) {
    const rows: Row[] = []
    const add = (row: Row, depth: number): void => {
      rows.push(depth ? { ...row, depth } : row)
      const kids = row.entry.isDir && expanded.has(row.entry.path) ? subLists.get(row.entry.path) : undefined
      if (!kids) return
      const shown: Row[] = []
      for (const entry of kids) {
        const hits = (showHidden || !entry.hidden) && match(entry.name, filter, fuzzy)
        if (hits) shown.push({ entry, hits })
      }
      shown.sort((x, y) => order(x.entry, y.entry))
      for (const r of shown) add(r, depth + 1)
    }
    for (const r of out) add(r, 0)
    return { rows, groups: null }
  }

  if (!grouped || virtual) return { rows: out, groups: null }

  // Collapsed groups keep their header but contribute no rows.
  const rows: Row[] = []
  const groups: ListGroup[] = []
  for (let i = 0; i < out.length; ) {
    const g = out[i].group!
    let j = i
    let bytes = 0
    let pending = false
    while (j < out.length && out[j].group!.key === g.key) {
      const e = out[j].entry
      if (e.size !== null) bytes += e.size
      else if (!e.isSymlink && !searchMode) {
        const s = sizes.get(e.path)
        if (s) bytes += s.size
        if (!s || s.state === 'partial') pending = true
      }
      j++
    }
    const isCollapsed = collapsed.has(g.key)
    groups.push({ key: g.key, label: g.label, count: j - i, bytes, pending, collapsed: isCollapsed, start: rows.length, rowCount: isCollapsed ? 0 : j - i })
    if (!isCollapsed) for (let k = i; k < j; k++) rows.push(out[k])
    i = j
  }
  return { rows, groups }
}
