import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { Settings } from '@shared/types'
import {
  EDITORS,
  MAX_WORKSPACES,
  WORKSPACE_PRESETS,
  changeEditor,
  editorsOf,
  hasEditor,
  insertEditor,
  presetWorkspace,
  removeEditor,
  setHidden,
  setRatio,
  swapEditors,
  toggleEditor,
  unusedEditors,
  visibleTree,
  type AreaNode,
  type Edge,
  type Editor,
  type Workspace
} from '@shared/workspace'
import { keys } from '@renderer/lib/keys'
import type { MenuItem } from '../components/ContextMenu'
import { editorName, useAreaDrag, workspaceName, type DockTarget } from '../components/Workspace'

// The window's workspaces (tabs above the areas) and the area tree of the active one: which editors show
// where, the maximized area, and the menus that change them. Workspaces are settings, so every edit goes
// through updateSettings; the active workspace is per window.

/** Where an editor appears when the workspace never had it: an edge of the Files area and its share. */
export const DEFAULT_PLACE: Record<Editor, [Edge, number]> = {
  files: ['left', 0.5],
  folders: ['left', 0.2],
  tasks: ['left', 0.2],
  preview: ['right', 0.35],
  git: ['right', 0.3],
  todo: ['right', 0.28],
  games: ['right', 0.4],
  stocks: ['right', 0.45],
  tools: ['right', 0.42],
  monitor: ['right', 0.5],
  docker: ['right', 0.55],
  console: ['bottom', 0.32]
}

const newWorkspaceId = (): string => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function useWorkspaceLayout(options: {
  settings: Settings | null
  updateSettings(patch: Partial<Settings>): void
  /** The window became another workspace: it shows that many file panes. */
  onSwitch(target: Workspace): void
  /** Extra windows (⌘N) do not change which workspace the main window opens with. */
  remember: boolean
}) {
  const { settings, updateSettings } = options
  const [activeWs, setActiveWs] = useState('')
  /** The area shown alone (Blender's maximize area), or null. */
  const [maximized, setMaximized] = useState<Editor | null>(null)
  /** Workspace tab being renamed in place. */
  const [renamingWs, setRenamingWs] = useState<string | null>(null)
  /** Area the user last clicked in – the target of "maximize area". */
  const activeArea = useRef<Editor>('files')

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const workspaces = settings?.workspaces ?? []
  const ws: Workspace | null = workspaces.find((w) => w.id === activeWs) ?? workspaces[0] ?? null
  const wsRef = useRef(ws)
  wsRef.current = ws
  const onSwitch = useRef(options.onSwitch)
  onSwitch.current = options.onSwitch

  /** Edits the workspace list; the ref is updated at once so quick successive edits (divider drags) build on each other. */
  const editWorkspaces = (fn: (list: Workspace[]) => Workspace[]): void => {
    const s = settingsRef.current
    if (!s) return
    const list = fn(s.workspaces)
    settingsRef.current = { ...s, workspaces: list }
    updateSettings({ workspaces: list })
  }
  const editWorkspace = (fn: (w: Workspace) => Workspace, id = wsRef.current?.id): void => editWorkspaces((list) => list.map((w) => (w.id === id ? fn(w) : w)))
  const editTree = (fn: (root: AreaNode) => AreaNode): void => editWorkspace((w) => ({ ...w, root: fn(w.root) }))

  const switchWorkspace = (id: string): void => {
    const target = settingsRef.current?.workspaces.find((w) => w.id === id)
    if (!target || target.id === wsRef.current?.id) return
    setActiveWs(id)
    setMaximized(null)
    onSwitch.current(target)
    if (options.remember) updateSettings({ activeWorkspace: id })
  }

  const cycleWorkspace = (step: number): void => {
    const i = workspaces.findIndex((w) => w.id === ws?.id)
    if (workspaces.length > 1) switchWorkspace(workspaces[(i + step + workspaces.length) % workspaces.length].id)
  }

  const addWorkspace = (from: Workspace, name: string): void => {
    if (workspaces.length >= MAX_WORKSPACES) return
    const copy: Workspace = { ...from, id: newWorkspaceId(), name: name.slice(0, 40) }
    delete copy.preset
    editWorkspaces((list) => [...list, copy])
    // switchWorkspace reads the list from the settings ref, which the edit above has just updated.
    switchWorkspace(copy.id)
  }

  const deleteWorkspace = (id: string): void => {
    if (workspaces.length < 2) return
    const index = workspaces.findIndex((w) => w.id === id)
    if (id === ws?.id) switchWorkspace(workspaces[index === 0 ? 1 : index - 1].id)
    editWorkspaces((list) => list.filter((w) => w.id !== id))
  }

  const moveWorkspace = (id: string, toIndex: number): void =>
    editWorkspaces((list) => {
      const from = list.findIndex((w) => w.id === id)
      if (from < 0) return list
      const next = [...list]
      const [item] = next.splice(from, 1)
      next.splice(from < toIndex ? toIndex - 1 : toIndex, 0, item)
      return next
    })

  const duplicateCurrent = (): void => {
    if (ws) addWorkspace(ws, t('workspace.copyOf', { name: workspaceName(ws) }))
  }

  /** What the body shows: the maximized area alone, or the visible part of the tree. */
  const shownTree: AreaNode | null = ws ? (maximized && hasEditor(ws.root, maximized, true) ? { editor: maximized } : visibleTree(ws.root)) : null
  const shown = shownTree ? editorsOf(shownTree) : []
  const isShown = (editor: Editor): boolean => shown.includes(editor)

  /** Shows an editor (where it was, or at `edge` of the Files area when the workspace never had it). */
  const showEditor = (editor: Editor, edge: Edge = DEFAULT_PLACE[editor][0], share = DEFAULT_PLACE[editor][1]): void => {
    setMaximized((m) => (m && m !== editor ? null : m))
    if (wsRef.current && hasEditor(wsRef.current.root, editor, true)) return
    editTree((root) => toggleEditor(root, editor, true, edge, share))
  }
  const hideEditor = (editor: Editor): void => {
    setMaximized((m) => (m === editor ? null : m))
    editTree((root) => setHidden(root, editor, true))
  }
  const toggleArea = (editor: Editor): void => (isShown(editor) ? hideEditor(editor) : showEditor(editor))

  /** The toolbar's Folders button: switches the side area between folders and tasks, as the old side pane did. */
  const toggleFolders = (): void => {
    setMaximized(null)
    editTree((root) => {
      if (hasEditor(root, 'folders', true)) return hasEditor(root, 'tasks') ? setHidden(root, 'folders', true) : changeEditor(root, 'folders', 'tasks')
      if (hasEditor(root, 'folders')) return setHidden(root, 'folders', false)
      if (hasEditor(root, 'tasks')) return setHidden(changeEditor(root, 'tasks', 'folders'), 'folders', false)
      return insertEditor(root, 'files', 'left', 'folders', 0.2)
    })
  }

  const toggleMaximize = (editor: Editor = activeArea.current): void => setMaximized((m) => (m ? null : editor))

  // The area clicked or focused last. Editors are portals, so React events from inside them do not pass
  // through the area element – the DOM does.
  useEffect(() => {
    const track = (e: Event): void => {
      const editor = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.area[data-editor]')?.dataset.editor
      if (editor) activeArea.current = editor as Editor
    }
    window.addEventListener('mousedown', track, true)
    window.addEventListener('focusin', track, true)
    return () => {
      window.removeEventListener('mousedown', track, true)
      window.removeEventListener('focusin', track, true)
    }
  }, [])

  const closeArea = (editor: Editor): void => {
    setMaximized((m) => (m === editor ? null : m))
    editTree((root) => removeEditor(root, editor))
  }

  /** Dropping a dragged area: the centre swaps the two, an edge splits the target there. */
  const dockArea = (editor: Editor, target: DockTarget): void => {
    setMaximized(null)
    editTree((root) => (target.zone === 'center' ? swapEditors(root, editor, target.editor) : insertEditor(root, target.editor, target.zone, editor, target.editor === 'files' ? 0.3 : 0.5)))
  }
  const areaDrag = useAreaDrag(dockArea)

  // ---- menus --------------------------------------------------------------------------------------

  const workspaceMenuItems = (id: string): MenuItem[] => {
    const w = workspaces.find((x) => x.id === id)
    if (!w) return []
    const index = workspaces.indexOf(w)
    return [
      { label: t('workspace.rename'), shortcut: 'F2', onClick: () => setRenamingWs(id) },
      { label: t('workspace.duplicate'), disabled: workspaces.length >= MAX_WORKSPACES, onClick: () => addWorkspace(w, t('workspace.copyOf', { name: workspaceName(w) })) },
      ...(w.preset ? [{ label: t('workspace.reset'), onClick: () => editWorkspace((x) => ({ ...presetWorkspace(w.preset!), id: x.id, name: x.name }), id) }] : []),
      'separator',
      { label: t('workspace.moveLeft'), disabled: index === 0, onClick: () => moveWorkspace(id, index - 1) },
      { label: t('workspace.moveRight'), disabled: index === workspaces.length - 1, onClick: () => moveWorkspace(id, index + 2) },
      'separator',
      { label: t('workspace.delete'), disabled: workspaces.length < 2, onClick: () => deleteWorkspace(id) }
    ]
  }

  /** Built-in workspaces that were deleted; "restore" adds them back. */
  const missingPresets = WORKSPACE_PRESETS.filter((p) => !workspaces.some((w) => w.preset === p))

  const addWorkspaceItems = (): MenuItem[] => [
    ...(ws ? [{ label: t('workspace.duplicateCurrent'), disabled: workspaces.length >= MAX_WORKSPACES, onClick: duplicateCurrent }] : []),
    {
      label: t('workspace.fromTemplate'),
      items: WORKSPACE_PRESETS.map((preset) => ({
        label: t(`workspace.preset.${preset}`),
        disabled: workspaces.length >= MAX_WORKSPACES,
        onClick: () => addWorkspace(presetWorkspace(preset), t(`workspace.preset.${preset}`))
      }))
    },
    ...(missingPresets.length > 0
      ? [
          'separator' as const,
          { label: t('workspace.restore'), onClick: () => editWorkspaces((list) => [...list, ...missingPresets.map((p) => presetWorkspace(p))].slice(0, MAX_WORKSPACES)) }
        ]
      : [])
  ]

  /** Editors that can be added to this workspace, each with the sides of `target` to put it on. */
  const addAreaItems = (target: Editor): MenuItem[] => {
    const edges: Edge[] = ['left', 'right', 'top', 'bottom']
    const free = ws ? unusedEditors(ws.root) : []
    const hidden = ws ? editorsOf(ws.root).filter((e) => !hasEditor(ws.root, e, true)) : []
    return [
      ...hidden.map((editor) => ({ label: t('area.showEditor', { name: editorName(editor) }), onClick: () => showEditor(editor) })),
      ...free.map((editor) => ({
        label: editorName(editor),
        items: edges.map((edge) => ({
          label: t(`area.dock.${edge}`),
          onClick: () => {
            setMaximized(null)
            editTree((root) => insertEditor(root, target, edge, editor, target === 'files' ? DEFAULT_PLACE[editor][1] : 0.5))
          }
        }))
      }))
    ]
  }

  const addAreaMenuItems = (): MenuItem[] => {
    const items = addAreaItems('files')
    return items.length > 0 ? items : [{ label: t('area.allShown'), disabled: true, onClick: () => {} }]
  }

  /** Blender's editor-type menu: change what the area shows, split it, maximize or close it. */
  const areaMenuItems = (editor: Editor): MenuItem[] => {
    if (!ws) return []
    const split = addAreaItems(editor).filter((item) => typeof item === 'object' && 'items' in item)
    return [
      ...(editor === 'files'
        ? []
        : [
            ...EDITORS.filter((x) => x !== 'files').map((x) => ({
              label: editorName(x),
              checked: x === editor,
              onClick: () => editTree((root) => setHidden(changeEditor(root, editor, x), x, false))
            })),
            'separator' as const
          ]),
      { label: t('area.split'), disabled: split.length === 0, items: split },
      ...(editor === 'files' && ws.panes > 1 ? [{ label: t('area.stackPanes'), checked: ws.paneAxis === 'column', onClick: toggleStackPanes }] : []),
      { label: t(maximized ? 'area.restore' : 'area.maximize'), shortcut: keys.label('maximizeArea'), onClick: () => toggleMaximize(editor) },
      ...(editor === 'files' ? [] : [{ label: t('area.close'), onClick: () => closeArea(editor) }])
    ]
  }

  const toggleStackPanes = (): void => editWorkspace((w) => ({ ...w, paneAxis: w.paneAxis === 'column' ? 'row' : 'column' }))

  return {
    ws,
    workspaces,
    setActiveWs,
    maximized,
    setMaximized,
    renamingWs,
    setRenamingWs,
    paneAxis: ws?.paneAxis ?? 'row',
    shownTree,
    shown,
    isShown,
    editWorkspace,
    setRatio: (path: string, ratio: number) => editTree((root) => setRatio(root, path, ratio)),
    switchWorkspace,
    cycleWorkspace,
    moveWorkspace,
    duplicateCurrent,
    showEditor,
    hideEditor,
    toggleArea,
    toggleFolders,
    toggleMaximize,
    toggleStackPanes,
    closeArea,
    areaDrag,
    workspaceMenuItems,
    addWorkspaceItems,
    addAreaMenuItems,
    areaMenuItems
  }
}

export type WorkspaceLayout = ReturnType<typeof useWorkspaceLayout>
