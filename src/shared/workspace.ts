// Blender-style workspaces: the window body is a binary split tree of areas, each showing one editor.
// Editors are singletons in a window (one toolbar, one folder tree, one console), so a workspace shows
// each at most once and the editor name doubles as the area's identity. Pure functions only, shared by
// main (validation) and the renderer (editing).

export const EDITORS = ['files', 'folders', 'tasks', 'preview', 'git', 'todo', 'games', 'stocks', 'tools', 'monitor', 'docker', 'console'] as const
export type Editor = (typeof EDITORS)[number]

export const WORKSPACE_PRESETS = ['files', 'commander', 'agent', 'preview'] as const
export type WorkspacePreset = (typeof WORKSPACE_PRESETS)[number]

export type Axis = 'row' | 'column'
export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface AreaLeaf {
  editor: Editor
  /** Hidden areas keep their place in the tree, so showing them again restores where they were. */
  hidden?: boolean
}

export interface AreaSplit {
  /** row: `a` left of `b`; column: `a` above `b`. */
  split: Axis
  /** Share of `a`, 0–1. */
  ratio: number
  a: AreaNode
  b: AreaNode
}

export type AreaNode = AreaLeaf | AreaSplit

export interface Workspace {
  id: string
  /** User-given name; empty for a built-in that still shows its translated name. */
  name: string
  preset?: WorkspacePreset
  root: AreaNode
  /** File panes shown in the Files area, 1–4. */
  panes: number
  paneAxis: Axis
}

export const MAX_WORKSPACES = 12
export const MAX_WORKSPACE_NAME = 40
export const MIN_RATIO = 0.08
const MAX_DEPTH = 8

export const isLeaf = (n: AreaNode): n is AreaLeaf => 'editor' in n
const clampRatio = (r: number): number => Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, r))

/** Divider address: the a/b steps from the root to the split ("" is the root). */
export type SplitPath = string

export function editorsOf(root: AreaNode, includeHidden = true): Editor[] {
  if (isLeaf(root)) return includeHidden || !root.hidden ? [root.editor] : []
  return [...editorsOf(root.a, includeHidden), ...editorsOf(root.b, includeHidden)]
}

export const hasEditor = (root: AreaNode, editor: Editor, visibleOnly = false): boolean => editorsOf(root, !visibleOnly).includes(editor)

export const unusedEditors = (root: AreaNode): Editor[] => EDITORS.filter((e) => !hasEditor(root, e))

function mapLeaves(root: AreaNode, fn: (leaf: AreaLeaf) => AreaNode): AreaNode {
  if (isLeaf(root)) return fn(root)
  return { ...root, a: mapLeaves(root.a, fn), b: mapLeaves(root.b, fn) }
}

/** The tree without `editor`; its sibling takes the freed space. Files can never be removed. */
export function removeEditor(root: AreaNode, editor: Editor): AreaNode {
  if (editor === 'files' || isLeaf(root)) return root
  if (isLeaf(root.a) && root.a.editor === editor) return root.b
  if (isLeaf(root.b) && root.b.editor === editor) return root.a
  return { ...root, a: removeEditor(root.a, editor), b: removeEditor(root.b, editor) }
}

/** Splits the `target` area and puts `editor` at its `edge`, taking `share` of the space. */
export function insertEditor(root: AreaNode, target: Editor, edge: Edge, editor: Editor, share = 0.5): AreaNode {
  if (editor === target || !hasEditor(root, target)) return root
  const base = hasEditor(root, editor) ? removeEditor(root, editor) : root
  const leaf: AreaLeaf = { editor }
  const s = clampRatio(share)
  return mapLeaves(base, (n) => {
    if (n.editor !== target) return n
    const split: Axis = edge === 'left' || edge === 'right' ? 'row' : 'column'
    const first = edge === 'left' || edge === 'top'
    return first ? { split, ratio: s, a: leaf, b: n } : { split, ratio: 1 - s, a: n, b: leaf }
  })
}

/** Swaps the places of two editors (both must be in the tree). */
export function swapEditors(root: AreaNode, x: Editor, y: Editor): AreaNode {
  if (x === y || !hasEditor(root, x) || !hasEditor(root, y)) return root
  return mapLeaves(root, (n) => (n.editor === x ? { ...n, editor: y } : n.editor === y ? { ...n, editor: x } : n))
}

/** Changes the area showing `from` to show `to`; when `to` is already elsewhere, the two swap. */
export function changeEditor(root: AreaNode, from: Editor, to: Editor): AreaNode {
  if (from === to || from === 'files' || !hasEditor(root, from)) return root
  if (hasEditor(root, to)) return swapEditors(root, from, to)
  return mapLeaves(root, (n) => (n.editor === from ? { editor: to, hidden: n.hidden } : n))
}

export function setHidden(root: AreaNode, editor: Editor, hidden: boolean): AreaNode {
  if (editor === 'files') return root
  return mapLeaves(root, (n) => (n.editor === editor ? (hidden ? { editor, hidden: true } : { editor }) : n))
}

/**
 * Shows or hides an editor. Hidden areas come back where they were; an editor the workspace has never
 * had appears at `edge` of the Files area with `share` of its space.
 */
export function toggleEditor(root: AreaNode, editor: Editor, show: boolean, edge: Edge, share: number): AreaNode {
  if (!hasEditor(root, editor)) return show ? insertEditor(root, 'files', edge, editor, share) : root
  return setHidden(root, editor, !show)
}

export function setRatio(root: AreaNode, path: SplitPath, ratio: number): AreaNode {
  if (isLeaf(root)) return root
  if (path === '') return { ...root, ratio: clampRatio(ratio) }
  const [step, rest] = [path[0], path.slice(1)]
  return step === 'a' ? { ...root, a: setRatio(root.a, rest, ratio) } : { ...root, b: setRatio(root.b, rest, ratio) }
}

/** The tree as shown: hidden areas dropped, their siblings taking the space. Files is never hidden. */
export function visibleTree(root: AreaNode): AreaNode | null {
  if (isLeaf(root)) return root.hidden ? null : root
  const a = visibleTree(root.a)
  const b = visibleTree(root.b)
  return a && b ? { ...root, a, b } : (a ?? b)
}

// ---- presets ----------------------------------------------------------------------------------

const row = (ratio: number, a: AreaNode, b: AreaNode): AreaSplit => ({ split: 'row', ratio, a, b })

/** The built-in workspaces; `side` is the editor the old single side pane showed (folders or tasks). */
export function presetWorkspace(preset: WorkspacePreset, side: 'folders' | 'tasks' = 'tasks'): Workspace {
  const files: AreaLeaf = { editor: 'files' }
  const sidebar: AreaLeaf = { editor: side }
  const base = { id: preset, name: '', preset, paneAxis: 'row' as Axis }
  switch (preset) {
    case 'files':
      return { ...base, panes: 1, root: row(0.2, sidebar, files) }
    case 'commander':
      return { ...base, panes: 2, root: row(0.18, { editor: 'folders' }, files) }
    case 'agent':
      return { ...base, panes: 1, root: row(0.18, { editor: 'folders' }, row(0.56, files, { editor: 'console' })) }
    case 'preview':
      return { ...base, panes: 1, root: row(0.18, sidebar, row(0.6, files, { editor: 'preview' })) }
  }
}

export const defaultWorkspaces = (side: 'folders' | 'tasks' = 'tasks'): Workspace[] => WORKSPACE_PRESETS.map((p) => presetWorkspace(p, side))

// ---- validation ---------------------------------------------------------------------------------

function sanitizeNode(value: unknown, seen: Set<Editor>, depth: number): AreaNode | null {
  if (typeof value !== 'object' || value === null || depth > MAX_DEPTH) return null
  const v = value as Record<string, unknown>
  if (typeof v.editor === 'string') {
    const editor = v.editor as Editor
    if (!EDITORS.includes(editor) || seen.has(editor)) return null
    seen.add(editor)
    return v.hidden === true && editor !== 'files' ? { editor, hidden: true } : { editor }
  }
  if (v.split !== 'row' && v.split !== 'column') return null
  const a = sanitizeNode(v.a, seen, depth + 1)
  const b = sanitizeNode(v.b, seen, depth + 1)
  if (!a || !b) return a ?? b
  const ratio = typeof v.ratio === 'number' && Number.isFinite(v.ratio) ? clampRatio(v.ratio) : 0.5
  return { split: v.split, ratio, a, b }
}

/** A valid tree (each editor once, Files always present) or null. */
export function sanitizeTree(value: unknown): AreaNode | null {
  const root = sanitizeNode(value, new Set(), 0)
  return root && hasEditor(root, 'files') ? root : null
}

export function sanitizeWorkspaces(value: unknown): Workspace[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  const out: Workspace[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const w = item as Record<string, unknown>
    const root = sanitizeTree(w.root)
    if (!root || typeof w.id !== 'string' || !/^[\w-]{1,40}$/.test(w.id) || ids.has(w.id)) continue
    ids.add(w.id)
    const preset = (WORKSPACE_PRESETS as readonly unknown[]).includes(w.preset) ? (w.preset as WorkspacePreset) : undefined
    const panes = Number.isInteger(w.panes) ? Math.min(4, Math.max(1, w.panes as number)) : 1
    out.push({
      id: w.id,
      name: typeof w.name === 'string' ? w.name.trim().slice(0, MAX_WORKSPACE_NAME) : '',
      ...(preset ? { preset } : {}),
      root,
      panes,
      paneAxis: w.paneAxis === 'column' ? 'column' : 'row'
    })
    if (out.length === MAX_WORKSPACES) break
  }
  return out.length > 0 ? out : null
}
