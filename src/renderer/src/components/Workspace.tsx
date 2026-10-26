import { useEffect, useRef, useState } from 'react'
import { t, type MessageKey } from '@shared/i18n'
import { isLeaf, type AreaNode, type Edge, type Editor, type SplitPath, type Workspace } from '@shared/workspace'
import { Icon, type IconName } from './Icon'

// Blender-style area layout: a split tree of areas with draggable dividers, headers that pick the editor
// and drag the area to another place, and the workspace tabs above it all.

export const EDITOR_ICON: Record<Editor, IconName> = {
  files: 'open',
  folders: 'folders',
  tasks: 'view',
  preview: 'preview',
  git: 'git',
  todo: 'todo',
  games: 'games',
  stocks: 'stocks',
  tools: 'tools',
  monitor: 'monitor',
  docker: 'docker',
  console: 'console'
}

export const editorName = (e: Editor): string => t(`editor.${e}` as MessageKey)
export const workspaceName = (w: Workspace): string => w.name || (w.preset ? t(`workspace.preset.${w.preset}` as MessageKey) : '?')

/** Where a dragged area would land: an edge of the target area, or its centre (swap). */
export type DockZone = Edge | 'center'
export interface DockTarget {
  editor: Editor
  zone: DockZone
  rect: DOMRect
}

/** Edge zones take the outer 30 % of the area; the centre swaps the two areas. */
function zoneAt(rect: DOMRect, x: number, y: number): DockZone {
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const d: [DockZone, number][] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]]
  const [zone, dist] = d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))
  return dist < 0.3 ? zone : 'center'
}

/**
 * Pointer-driven area drag (HTML drag and drop stays reserved for files and tabs). Starts after a few
 * pixels, so a click on the header still works, and calls `onDrop` with the target under the pointer.
 */
export function useAreaDrag(onDrop: (editor: Editor, target: DockTarget) => void): {
  start(e: React.MouseEvent, editor: Editor): void
  target: DockTarget | null
  dragging: Editor | null
} {
  const [state, setState] = useState<{ editor: Editor; target: DockTarget | null } | null>(null)
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop

  const start = (e: React.MouseEvent, editor: Editor): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, .console-tab')) return
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    let target: DockTarget | null = null
    const move = (ev: MouseEvent): void => {
      // The button was released outside the window: the mouseup never came.
      if (ev.buttons === 0) return up()
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
      if (!active) document.body.classList.add('dragging-area')
      active = true
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.area[data-editor]')
      const over = el?.dataset.editor as Editor | undefined
      if (!el || !over || over === editor) target = null
      else {
        const rect = el.getBoundingClientRect()
        target = { editor: over, zone: zoneAt(rect, ev.clientX, ev.clientY), rect }
      }
      setState({ editor, target })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('keydown', key, true)
      document.body.classList.remove('dragging-area')
      setState(null)
      if (active && target) dropRef.current(editor, target)
    }
    // Escape cancels the move.
    const key = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      target = null
      up()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', key, true)
  }

  return { start, target: state?.target ?? null, dragging: state?.editor ?? null }
}

/** The highlighted part of the target area while an area is dragged over it. */
export function DockOverlay({ target }: { target: DockTarget }): React.JSX.Element {
  const r = target.rect
  const half = { left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5], center: [0, 0, 1, 1] }[target.zone]
  return (
    <div
      className={`dock-overlay ${target.zone}`}
      style={{ left: r.left + half[0] * r.width, top: r.top + half[1] * r.height, width: half[2] * r.width, height: half[3] * r.height }}
    >
      <span>{target.zone === 'center' ? t('area.swap') : t(`area.dock.${target.zone}` as MessageKey)}</span>
    </div>
  )
}

interface TreeProps {
  node: AreaNode
  path: SplitPath
  renderArea(editor: Editor): React.ReactNode
  onRatio(path: SplitPath, ratio: number): void
}

/** Renders the split tree; each leaf's content comes from `renderArea`. */
export function AreaTree(p: TreeProps): React.JSX.Element {
  const { node } = p
  if (isLeaf(node)) return <>{p.renderArea(node.editor)}</>
  return (
    <div className={`area-split split-${node.split}`}>
      <div className="area-cell" style={{ flex: `${node.ratio} 1 0` }}>
        <AreaTree {...p} node={node.a} path={p.path + 'a'} />
      </div>
      <Divider axis={node.split} ratio={node.ratio} onChange={(r) => p.onRatio(p.path, r)} />
      <div className="area-cell" style={{ flex: `${1 - node.ratio} 1 0` }}>
        <AreaTree {...p} node={node.b} path={p.path + 'b'} />
      </div>
    </div>
  )
}

/** A draggable, keyboard-operable divider between the two halves of a split. */
function Divider({ axis, ratio, onChange }: { axis: 'row' | 'column'; ratio: number; onChange(ratio: number): void }): React.JSX.Element {
  const row = axis === 'row'
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const parent = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect()
    const move = (ev: MouseEvent): void => {
      if (ev.buttons === 0) return up()
      onChange(row ? (ev.clientX - parent.left) / parent.width : (ev.clientY - parent.top) / parent.height)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove(row ? 'resizing-col' : 'resizing-row')
    }
    document.body.classList.add(row ? 'resizing-col' : 'resizing-row')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const onKey = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 0.1 : 0.02
    const dir = { ArrowLeft: row ? -1 : 0, ArrowRight: row ? 1 : 0, ArrowUp: row ? 0 : -1, ArrowDown: row ? 0 : 1 }[e.key]
    if (!dir) return
    e.preventDefault()
    e.stopPropagation()
    onChange(ratio + dir * step)
  }
  return (
    <div
      className={`area-divider split-${axis}`}
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t('area.resize')}
      tabIndex={0}
      onMouseDown={startDrag}
      onKeyDown={onKey}
    />
  )
}

/** Header of a non-Files area: editor menu, drag handle, maximize and close. */
export function AreaHeader(p: {
  editor: Editor
  title?: string
  maximized: boolean
  onMenu(e: React.MouseEvent): void
  onDragStart(e: React.MouseEvent): void
  onMaximize(): void
  onClose(): void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="area-header" onMouseDown={p.onDragStart} onContextMenu={(e) => (e.preventDefault(), p.onMenu(e))} title={t('area.dragHint')}>
      <EditorButton editor={p.editor} onMenu={p.onMenu} />
      <span className="area-title">{p.title ?? editorName(p.editor)}</span>
      {p.children}
      <div className="toolbar-spacer" />
      <button className="area-btn" title={t(p.maximized ? 'area.restore' : 'area.maximize')} onClick={p.onMaximize}>
        {p.maximized ? '❐' : '⤢'}
      </button>
      <button className="area-btn" title={t('area.close')} onClick={p.onClose}>
        ✕
      </button>
    </div>
  )
}

/** The editor-type button Blender puts at the start of every area header. */
export function EditorButton({ editor, onMenu }: { editor: Editor; onMenu(e: React.MouseEvent): void }): React.JSX.Element {
  return (
    <button className="area-editor" title={t('area.editorType')} onClick={onMenu}>
      <Icon name={EDITOR_ICON[editor]} size={14} />
    </button>
  )
}

/** Workspace tabs (Blender's top bar): switch, rename in place, context menu, add. */
export function WorkspaceBar(p: {
  workspaces: Workspace[]
  active: string
  /** Tab being renamed in place. */
  editing: string | null
  onEdit(id: string | null): void
  onSelect(id: string): void
  onRename(id: string, name: string): void
  onMenu(id: string, e: React.MouseEvent): void
  onAdd(e: React.MouseEvent): void
  onAreas(e: React.MouseEvent): void
  onReorder(id: string, toIndex: number): void
}): React.JSX.Element {
  const { editing, onEdit: setEditing } = p
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /** Workspace tabs reorder by dragging, like file tabs. */
  const startDrag = (e: React.MouseEvent, id: string): void => {
    if (e.button !== 0 || editing) return
    const x0 = e.clientX
    let over: number | null = null
    const move = (ev: MouseEvent): void => {
      if (ev.buttons === 0) return up()
      if (over === null && Math.abs(ev.clientX - x0) < 6) return
      const tabs = [...(listRef.current?.querySelectorAll<HTMLElement>('.ws-tab') ?? [])]
      over = tabs.findIndex((tab) => ev.clientX < tab.getBoundingClientRect().left + tab.offsetWidth / 2)
      if (over < 0) over = tabs.length
      setDrag({ id, over })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (over !== null) p.onReorder(id, over)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="workspace-bar" role="tablist" aria-label={t('workspace.title')}>
      <div className="ws-tabs" ref={listRef}>
        {p.workspaces.map((w, i) => (
          <div
            key={w.id}
            role="tab"
            aria-selected={w.id === p.active}
            tabIndex={w.id === p.active ? 0 : -1}
            className={`ws-tab${w.id === p.active ? ' current' : ''}${drag?.id === w.id ? ' dragging' : ''}${drag && drag.over === i && drag.id !== w.id ? ' drop-before' : ''}`}
            onMouseDown={(e) => {
              if (e.button === 0 && !editing) p.onSelect(w.id)
              startDrag(e, w.id)
            }}
            onDoubleClick={() => setEditing(w.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onMenu(w.id, e)
            }}
            onKeyDown={(e) => {
              if (e.key === 'F2') setEditing(w.id)
            }}
          >
            {editing === w.id ? (
              <RenameInput
                initial={workspaceName(w)}
                onDone={(name) => {
                  setEditing(null)
                  if (name !== null) p.onRename(w.id, name)
                }}
              />
            ) : (
              workspaceName(w)
            )}
          </div>
        ))}
        {drag && drag.over === p.workspaces.length && <div className="ws-drop-end" />}
        <button className="ws-add" title={t('workspace.add')} onClick={p.onAdd}>
          +
        </button>
      </div>
      <div className="toolbar-spacer" />
      <button className="ws-areas" title={t('area.addTitle')} onClick={p.onAreas}>
        <Icon name="panes" size={14} />
        {t('area.add')}
      </button>
    </div>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone(name: string | null): void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="ws-rename"
      defaultValue={initial}
      maxLength={40}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value.trim() || null)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
    />
  )
}
