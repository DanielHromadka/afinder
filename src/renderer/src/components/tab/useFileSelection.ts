import { useCallback, useMemo, useState } from 'react'
import type { FileEntry } from '@shared/types'
import type { Row } from '../FileList'

// What is selected in a tab, which row has the keyboard focus and where a Shift range starts. The ".." row
// can take the focus too (PARENT_FOCUS); it is never part of the selection.

/** The ".." row: a navigation row, never a real file path or part of a file operation. */
export const PARENT_FOCUS = '..'

export interface FileSelection {
  selection: Set<string>
  focusPath: string | null
  /** Index of the focused row, -1 when none (or the ".." row). */
  focusIndex: number
  parentFocused: boolean
  /** The selected rows' entries, in row order. */
  selectedEntries: FileEntry[]
  /** Selects exactly `paths`; the focus and the range anchor go to `focus`. */
  select(paths: string[], focus?: string | null): void
  /** ⌘-click: adds or removes one item, which takes the focus. */
  toggle(path: string): void
  /** Shift: everything between `anchor` and the row at `toIndex`. */
  selectRange(anchor: string, toIndex: number): void
  /** Arrow keys and the like; `extend` keeps the anchor (Shift). Before the first row is the ".." row. */
  moveFocus(to: number, extend: boolean): void
  selectAll(): void
  /** Keeps only what is still there (after a reload). */
  keepExisting(existing: Set<string>): void
  anchorPath: string | null
}

export function useFileSelection(rows: Row[], hasParentRow: boolean): FileSelection {
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [anchorPath, setAnchorPath] = useState<string | null>(null)

  const select = useCallback((paths: string[], focus: string | null = paths[0] ?? null) => {
    setSelection(new Set(paths))
    setFocusPath(focus)
    setAnchorPath(focus)
  }, [])

  const toggle = (path: string): void => {
    setSelection((sel) => {
      const next = new Set(sel)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    setFocusPath(path)
    setAnchorPath(path)
  }

  const selectRange = (anchor: string, toIndex: number): void => {
    const from = Math.max(0, rows.findIndex((r) => r.entry.path === anchor))
    const [a, b] = from < toIndex ? [from, toIndex] : [toIndex, from]
    setSelection(new Set(rows.slice(a, b + 1).map((r) => r.entry.path)))
    setFocusPath(rows[toIndex].entry.path)
  }

  const moveFocus = (to: number, extend: boolean): void => {
    if (hasParentRow && (to < 0 || rows.length === 0)) return select([], PARENT_FOCUS)
    if (rows.length === 0) return
    const index = Math.max(0, Math.min(rows.length - 1, to))
    if (extend && anchorPath) selectRange(anchorPath, index)
    else select([rows[index].entry.path])
  }

  const selectAll = (): void => setSelection(new Set(rows.map((r) => r.entry.path)))
  const keepExisting = useCallback((existing: Set<string>) => setSelection((sel) => new Set([...sel].filter((p) => existing.has(p)))), [])

  const focusIndex = useMemo(() => rows.findIndex((r) => r.entry.path === focusPath), [rows, focusPath])
  const selectedEntries = useMemo(() => rows.filter((r) => selection.has(r.entry.path)).map((r) => r.entry), [rows, selection])

  return {
    selection,
    focusPath,
    focusIndex,
    parentFocused: hasParentRow && focusPath === PARENT_FOCUS,
    selectedEntries,
    select,
    toggle,
    selectRange,
    moveFocus,
    selectAll,
    keepExisting,
    anchorPath
  }
}
