import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { GitState } from '@shared/git'
import { t, type MessageKey } from '@shared/i18n'
import { relativeDir } from '@shared/paths'
import type { FileEntry, SizeUpdate, ViewMode } from '@shared/types'
import { dropTargetProps } from '@renderer/lib/dnd'
import { formatDate, formatSize } from '@renderer/lib/format'
import { kindLabel } from '@renderer/lib/kinds'
import { memoOf, MemoBadge, type FileMemo } from './FileMemo'
import { Highlight } from './Highlight'
import { Icon } from './Icon'

const GIT_LETTER: Record<GitState, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  ignored: '',
  conflict: '!'
}

export type SortKey = 'name' | 'size' | 'kind' | 'modified' | 'location'
export interface Sort {
  key: SortKey
  asc: boolean
}
export interface Row {
  entry: FileEntry
  hits: number[]
  /** Nesting inside folders opened in place (0 or absent at the top level). */
  depth?: number
}
/** A group header; its rows follow it in `rows` starting at `start` (none while collapsed). */
export interface ListGroup {
  key: string
  label: string
  count: number
  bytes: number
  pending: boolean
  collapsed: boolean
  start: number
  rowCount: number
}

type Column = { key: SortKey; defaultWidth: number; align?: 'right' }
const COLUMNS: Column[] = [
  { key: 'name', defaultWidth: 320 },
  { key: 'size', defaultWidth: 110, align: 'right' },
  { key: 'kind', defaultWidth: 170 },
  { key: 'modified', defaultWidth: 150 }
]
const LOCATION: Column = { key: 'location', defaultWidth: 260 }

/** A line of tiles (list and icon views) holds the rows `from` to `to` (exclusive). */
type Item =
  { type: 'up' } | { type: 'group'; group: ListGroup } | { type: 'row'; index: number } | { type: 'tiles'; from: number; to: number }

const ROW_HEIGHT = 20
const GROUP_HEIGHT = 28
/** The sticky header sits inside the scroll container, above the rows. */
const HEADER_HEIGHT = 22
/** Tile size in the list view (names flowing in columns) and the icon view. */
const TILE: Record<Exclude<ViewMode, 'details'>, { width: number; height: number; icon: number }> = {
  list: { width: 240, height: 22, icon: 16 },
  icons: { width: 104, height: 96, icon: 48 }
}

interface Props {
  rows: Row[]
  sizes: Map<string, SizeUpdate>
  selection: Set<string>
  focusIndex: number
  renamingPath: string | null
  sort: Sort
  columnWidths: Record<string, number>
  /** Number the rows in their current order. */
  lineNumbers: boolean
  view: ViewMode
  /** Tiles per line, for moving the focus up and down (1 in the details view). */
  onColumns(n: number): void
  /** A ".." row on top that opens the parent; `path` makes it a drop target. Null where there is no parent. */
  up: { path: string | null; focused: boolean; onSelect(): void; onOpen(): void } | null
  emptyText: string
  currentPath: string
  groups: ListGroup[] | null
  /** Recursive search results: show where each item lives, skip folder sizes. */
  showLocation: boolean
  /** Git state of rows that have one. */
  git: Map<string, GitState>
  /** To-dos and notes pinned to files, shown as a badge that opens them. */
  memos: Map<string, FileMemo>
  onMemo(entry: FileEntry, anchor: DOMRect): void
  /** Folders show a chevron that opens them in place (details view only). */
  expandable: boolean
  expanded: Set<string>
  onToggleExpand(entry: FileEntry): void
  onGroupToggle(key: string): void
  onGroupOpen(key: string): void
  cutPaths: Set<string>
  dropTarget: string | null
  canDropOn(dest: string): boolean
  onDropTarget(dest: string | null): void
  onDropFiles(files: File[], dest: string, copy: boolean): void
  onDragStart(entry: FileEntry): void
  onRowMouseDown(index: number, e: React.MouseEvent): void
  onOpen(entry: FileEntry): void
  onContextMenu(entry: FileEntry | null, e: React.MouseEvent): void
  onRenameDone(entry: FileEntry, newName: string | null): void
  onSort(key: SortKey): void
  onColumnResize(key: SortKey, width: number): void
  onBackgroundClick(): void
}

export function FileList(p: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tile = p.view === 'details' ? null : TILE[p.view]
  const width = useWidth(scrollRef)
  // The scroll area minus its padding; at least one tile per line.
  const cols = tile ? Math.max(1, Math.floor((width - 12) / tile.width)) : 1
  const { onColumns } = p
  useEffect(() => {
    onColumns(cols)
  }, [cols, onColumns])

  const { items, itemOfRow } = useMemo(() => {
    const items: Item[] = []
    const itemOfRow: number[] = []
    if (p.up) items.push({ type: 'up' })
    const pushRows = (from: number, to: number): void => {
      if (tile) {
        for (let i = from; i < to; i += cols) {
          const end = Math.min(i + cols, to)
          for (let j = i; j < end; j++) itemOfRow[j] = items.length
          items.push({ type: 'tiles', from: i, to: end })
        }
        return
      }
      for (let i = from; i < to; i++) {
        itemOfRow[i] = items.length
        items.push({ type: 'row', index: i })
      }
    }
    if (p.groups) {
      for (const group of p.groups) {
        items.push({ type: 'group', group })
        pushRows(group.start, group.start + group.rowCount)
      }
    } else pushRows(0, p.rows.length)
    return { items, itemOfRow }
  }, [p.rows.length, p.groups, p.up !== null, tile, cols])

  // Only the details view has the column header.
  const header = tile ? 0 : HEADER_HEIGHT
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const type = items[i].type
      return type === 'group' ? GROUP_HEIGHT : type === 'tiles' ? tile!.height : ROW_HEIGHT
    },
    getItemKey: (i) => {
      const item = items[i]
      if (item.type === 'up') return 'up'
      if (item.type === 'tiles') return `tiles:${p.rows[item.from].entry.path}`
      return item.type === 'group' ? `group:${item.group.key}` : p.rows[item.index].entry.path
    },
    scrollMargin: header,
    scrollPaddingStart: header,
    overscan: 20
  })

  useEffect(() => {
    if (p.up?.focused) virtualizer.scrollToIndex(0)
    else if (p.focusIndex >= 0 && p.focusIndex < p.rows.length) virtualizer.scrollToIndex(itemOfRow[p.focusIndex])
  }, [p.focusIndex, p.up?.focused, p.rows.length, itemOfRow, virtualizer])

  // Rows change height class (group vs. row vs. tiles) when the grouping or the view changes.
  useEffect(() => virtualizer.measure(), [p.groups, p.view, cols, virtualizer])

  /** What a file's row and tile share: selection classes, drag and drop, mouse handlers. */
  const entryProps = (index: number, base: string): React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined> => {
    const { entry } = p.rows[index]
    const gitState = p.git.get(entry.path)
    return {
      className: `${base}${p.selection.has(entry.path) ? ' selected' : ''}${index === p.focusIndex ? ' focused' : ''}${entry.hidden ? ' hidden-file' : ''}${p.cutPaths.has(entry.path) ? ' cut' : ''}${p.dropTarget === entry.path ? ' drop-target' : ''}${gitState ? ` git-${gitState}` : ''}`,
      'data-path': entry.path,
      'data-dir': entry.isDir ? '' : undefined,
      draggable: p.renamingPath !== entry.path,
      onDragStart: (e) => {
        // Hand the drag over to the OS so it can be dropped into Finder and other apps.
        e.preventDefault()
        p.onDragStart(entry)
      },
      onMouseDown: (e) => p.onRowMouseDown(index, e),
      onDoubleClick: () => p.onOpen(entry),
      onContextMenu: (e) => p.onContextMenu(entry, e)
    }
  }

  const nameOf = (index: number): React.JSX.Element => {
    const { entry, hits } = p.rows[index]
    return p.renamingPath === entry.path ? (
      <RenameInput entry={entry} onDone={(name) => p.onRenameDone(entry, name)} />
    ) : (
      <span className="name-text">
        <Highlight text={entry.name} hits={hits} />
      </span>
    )
  }

  const memoBadge = (entry: FileEntry): React.ReactNode => {
    const memo = memoOf(p.memos, entry.path)
    return memo && <MemoBadge memo={memo} onOpen={(anchor) => p.onMemo(entry, anchor)} />
  }

  const columns = p.showLocation ? [COLUMNS[0], LOCATION, ...COLUMNS.slice(1)] : COLUMNS
  const widths = columns.map((c) => p.columnWidths[c.key] ?? c.defaultWidth)
  // Wide enough for the largest number plus the cell padding.
  const gutter = p.lineNumbers ? String(Math.max(p.rows.length, 1)).length * 7 + 14 : 0
  const template = (gutter ? `${gutter}px ` : '') + widths.map((w) => `${w}px`).join(' ') + ' 1fr'
  const totalWidth = widths.reduce((a, b) => a + b, gutter)

  return (
    <div className="filelist">
      <div
        ref={scrollRef}
        className={`filelist-scroll${p.dropTarget === p.currentPath ? ' drop-here' : ''}`}
        {...dropTargetProps({
          destFor: (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('.row[data-dir], .tile[data-dir]')
            const dest = row?.dataset.path ?? p.currentPath
            return p.canDropOn(dest) ? dest : null
          },
          onTarget: p.onDropTarget,
          onDrop: p.onDropFiles
        })}
        onMouseDown={(e) => e.target === e.currentTarget && p.onBackgroundClick()}
        onContextMenu={(e) => {
          const cls = (e.target as HTMLElement).classList
          if (e.target === e.currentTarget || cls.contains('rows') || cls.contains('tile-line')) p.onContextMenu(null, e)
        }}
      >
        {!tile && (
          <div className="list-header" style={{ gridTemplateColumns: template, minWidth: totalWidth }}>
            {p.lineNumbers && <div className="col-header line-number">#</div>}
            {columns.map((c, i) => (
              <div
                key={c.key}
                className={`col-header${c.align === 'right' ? ' right' : ''}${p.sort.key === c.key ? ' sorted' : ''}`}
                onClick={() => p.onSort(c.key)}
              >
                <span>{t(`columns.${c.key}` as MessageKey)}</span>
                {p.sort.key === c.key && <span className="sort-arrow">{p.sort.asc ? '▲' : '▼'}</span>}
                <ColumnResizer width={widths[i]} onResize={(w) => p.onColumnResize(c.key, w)} />
              </div>
            ))}
            <div className="col-header filler" />
          </div>
        )}

        <div
          className={`rows${tile ? ` ${p.view}-view` : ''}`}
          style={{
            height: virtualizer.getTotalSize(),
            minWidth: tile ? undefined : totalWidth
          }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index]
            const top = `translateY(${v.start - header}px)`
            if (item.type === 'tiles') {
              return (
                <div
                  key={v.key}
                  className="tile-line"
                  style={{
                    transform: top,
                    gridTemplateColumns: `repeat(${cols}, ${tile!.width}px)`,
                    height: tile!.height
                  }}
                >
                  {Array.from({ length: item.to - item.from }, (_, k) => {
                    const index = item.from + k
                    const { entry } = p.rows[index]
                    const gitState = p.git.get(entry.path)
                    return (
                      <div key={entry.path} {...entryProps(index, `tile ${p.view}-tile`)} title={entry.name}>
                        <span className="icon-wrap">
                          <Icon name={entry.kind} size={tile!.icon} />
                          {entry.isSymlink && <span className="shortcut-arrow">↗</span>}
                        </span>
                        {nameOf(index)}
                        {gitState && gitState !== 'ignored' && (
                          <span className={`git-badge git-${gitState}`} title={t(`git.${gitState}`)}>
                            {GIT_LETTER[gitState]}
                          </span>
                        )}
                        {memoBadge(entry)}
                      </div>
                    )
                  })}
                </div>
              )
            }
            if (item.type === 'up') {
              const up = p.up!
              return (
                <div
                  key={v.key}
                  className={`row parent-row${up.focused ? ' selected focused' : ''}${up.path && p.dropTarget === up.path ? ' drop-target' : ''}`}
                  style={{
                    transform: top,
                    gridTemplateColumns: tile ? undefined : template
                  }}
                  title={t('toolbar.up')}
                  data-path={up.path ?? undefined}
                  data-dir={up.path ? '' : undefined}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (e.button !== 0) return
                    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                    up.onSelect()
                  }}
                  onDoubleClick={up.onOpen}
                >
                  {p.lineNumbers && <div className="cell line-number" />}
                  <div className="cell name">
                    {p.expandable && !tile && <span className="row-expander" />}
                    <span className="icon-wrap">
                      <Icon name="folder" size={16} />
                    </span>
                    <span className="name-text">..</span>
                  </div>
                </div>
              )
            }
            if (item.type === 'group') {
              const g = item.group
              return (
                <div
                  key={v.key}
                  className={`group-row${g.collapsed ? ' collapsed' : ''}`}
                  style={{ transform: top }}
                  title={t('group.hint')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => p.onGroupToggle(g.key)}
                  onDoubleClick={() => p.onGroupOpen(g.key)}
                >
                  <span className="group-chevron">{g.collapsed ? '▸' : '▾'}</span>
                  <Icon name="folder" size={16} />
                  <span className="group-label">{g.label}</span>
                  <span className="group-meta">
                    {g.count} · {g.pending ? '≥ ' : ''}
                    {formatSize(g.bytes)}
                  </span>
                  <span className="group-line" />
                </div>
              )
            }
            const index = item.index
            const { entry, depth = 0 } = p.rows[index]
            const gitState = p.git.get(entry.path)
            return (
              <div key={v.key} {...entryProps(index, 'row')} style={{ transform: top, gridTemplateColumns: template }}>
                {p.lineNumbers && <div className="cell line-number">{index + 1}</div>}
                <div className="cell name">
                  {p.expandable && (
                    <span className="row-expander" style={{ marginLeft: depth * 16 }}>
                      {entry.isDir && (
                        <button
                          className="row-toggle"
                          aria-expanded={p.expanded.has(entry.path)}
                          tabIndex={-1}
                          onMouseDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={(e) => (e.stopPropagation(), p.onToggleExpand(entry))}
                        >
                          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                            <path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </span>
                  )}
                  <span className="icon-wrap">
                    <Icon name={entry.kind} size={16} />
                    {entry.isSymlink && <span className="shortcut-arrow">↗</span>}
                  </span>
                  {nameOf(index)}
                  {gitState && gitState !== 'ignored' && (
                    <span className={`git-badge git-${gitState}`} title={t(`git.${gitState}`)}>
                      {GIT_LETTER[gitState]}
                    </span>
                  )}
                  {memoBadge(entry)}
                </div>
                {p.showLocation && (
                  <div className="cell muted" title={entry.path}>
                    {relativeDir(entry.path, p.currentPath) || '.'}
                  </div>
                )}
                <div className="cell right">
                  {p.showLocation && entry.size === null ? '' : <SizeCell entry={entry} size={p.sizes.get(entry.path)} />}
                </div>
                <div className="cell">{kindLabel(entry)}</div>
                <div className="cell">{formatDate(entry.modified)}</div>
              </div>
            )
          })}
        </div>
        {items.length === (p.up ? 1 : 0) && <div className="empty-note">{p.emptyText}</div>}
      </div>
    </div>
  )
}

/** Content width of the scroll area, kept up to date as the pane resizes. */
function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function SizeCell({ entry, size }: { entry: FileEntry; size?: SizeUpdate }): React.JSX.Element {
  if (entry.size !== null) return <>{formatSize(entry.size)}</>
  if (entry.isSymlink) return <span className="muted">—</span>
  if (!size) return <span className="muted">{t('size.computing')}</span>
  if (size.state === 'denied') return <span className="muted" title={t('size.denied')}>—</span>
  if (size.state === 'partial') return <span className="muted">≥ {formatSize(size.size)}</span>
  return <>{formatSize(size.size)}</>
}

function RenameInput({ entry, onDone }: { entry: FileEntry; onDone(name: string | null): void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const input = ref.current!
    input.focus()
    // Select the name without extension, like Explorer.
    const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
  }, [entry])

  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(name)
  }

  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={entry.name}
      spellCheck={false}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

function ColumnResizer({ width, onResize }: { width: number; onResize(w: number): void }): React.JSX.Element {
  return (
    <div
      className="col-resizer"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const move = (ev: MouseEvent): void => onResize(Math.max(50, width + ev.clientX - startX))
        const up = (): void => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}
