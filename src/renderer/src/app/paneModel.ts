import { MAX_PANES, MAX_TABS, type GroupBy, type Layout, type ViewMode } from '@shared/types'

// The Files area of a window: panes side by side, each with tabs. Every change is a pure function from one
// model to the next, so the rules (limits, which tab becomes active, where moved tabs land, parking) live in
// one place and are tested without React.

export interface TabModel {
  id: string
  /** Folder the tab starts in (its current folder is in the tab's report). */
  path: string
  groupBy: GroupBy
  /** The tab shows the preview pane. */
  preview: boolean
  view: ViewMode
}

export interface PaneModel {
  id: string
  tabs: TabModel[]
  active: number
  weight: number
}

export interface Model {
  panes: PaneModel[]
  activePane: number
  /** Panes the active workspace has no room for; a workspace with more panes brings them back. */
  parked: PaneModel[]
}

/** Where a dragged tab came from. */
export interface TabDrag {
  pane: number
  tab: number
}

/** A tab as it is now (its current folder, grouping, preview, view) – what it continues with when remounted. */
export type CurrentOf = (tab: TabModel) => TabModel

let seq = 0
export const newTab = (path: string, groupBy: GroupBy = 'none', preview = false, view: ViewMode = 'details'): TabModel => ({ id: `t${++seq}`, path, groupBy, preview, view })
export const newPane = (tabs: TabModel[], active = 0, weight = 1): PaneModel => ({ id: `p${++seq}`, tabs, active, weight })

export const singlePane = (path: string): Model => ({ panes: [newPane([newTab(path)])], activePane: 0, parked: [] })

/** All saved panes come back visible; the workspace then parks those it has no room for. */
export function fromLayout(l: Layout): Model {
  return {
    activePane: l.activePane,
    panes: l.panes.map((p) => newPane(p.tabs.map((tab) => newTab(tab.path, tab.groupBy, tab.preview, tab.view ?? 'details')), p.active, p.weight)),
    parked: []
  }
}

export function layoutOf(m: Model, current: CurrentOf): Layout {
  return {
    activePane: m.activePane,
    panes: [...m.panes, ...m.parked].map((p) => ({
      active: p.active,
      weight: p.weight,
      tabs: p.tabs.map((tab) => {
        const c = current(tab)
        return { path: c.path, groupBy: c.groupBy, preview: c.preview, view: c.view }
      })
    }))
  }
}

/** Inserts `tab` into a pane (after its active tab unless `at` says where); a full pane stays as it is. */
export function addTab(m: Model, paneIndex: number, tab: TabModel, at?: number): Model {
  if (!m.panes[paneIndex] || m.panes[paneIndex].tabs.length >= MAX_TABS) return m
  const panes = m.panes.map((p, i) => {
    if (i !== paneIndex) return p
    const index = at ?? p.active + 1
    const tabs = [...p.tabs]
    tabs.splice(index, 0, tab)
    return { ...p, tabs, active: index <= p.active ? p.active + 1 : p.active }
  })
  return { ...m, panes }
}

export function selectTab(m: Model, paneIndex: number, tabIndex: number): Model {
  if (!m.panes[paneIndex]?.tabs[tabIndex]) return m
  if (m.activePane === paneIndex && m.panes[paneIndex].active === tabIndex) return m
  return { ...m, activePane: paneIndex, panes: m.panes.map((p, i) => (i === paneIndex ? { ...p, active: tabIndex } : p)) }
}

/** Activates the tab with this id wherever it is (a new tab shows once its first listing arrived). */
export function activateTab(m: Model, id: string): Model {
  const pi = m.panes.findIndex((p) => p.tabs.some((tab) => tab.id === id))
  if (pi < 0) return m
  return selectTab(m, pi, m.panes[pi].tabs.findIndex((tab) => tab.id === id))
}

/** Closes a tab; the pane goes when it was its last tab. (Closing the window's last tab is the caller's.) */
export function closeTab(m: Model, paneIndex: number, tabIndex: number): Model {
  const pane = m.panes[paneIndex]
  if (!pane?.tabs[tabIndex]) return m
  if (pane.tabs.length > 1) {
    const tabs = pane.tabs.filter((_, i) => i !== tabIndex)
    const active = tabIndex < pane.active ? pane.active - 1 : Math.min(pane.active, tabs.length - 1)
    return { ...m, panes: m.panes.map((p, i) => (i === paneIndex ? { ...p, tabs, active } : p)) }
  }
  const panes = m.panes.filter((_, i) => i !== paneIndex)
  const activePane = Math.min(m.activePane > paneIndex ? m.activePane - 1 : m.activePane, panes.length - 1)
  return { ...m, panes, activePane }
}

export function closeOtherTabs(m: Model, paneIndex: number, tabIndex: number): Model {
  if (!m.panes[paneIndex]?.tabs[tabIndex]) return m
  return { ...m, activePane: paneIndex, panes: m.panes.map((p, i) => (i === paneIndex ? { ...p, tabs: [p.tabs[tabIndex]], active: 0 } : p)) }
}

/** Moves a tab within a pane or to another pane (a new pane when `toPane` is past the end). */
export function moveTab(m: Model, drag: TabDrag, toPane: number, toIndex: number, current: CurrentOf): Model {
  const tab = m.panes[drag.pane]?.tabs[drag.tab]
  if (!tab) return m
  const panes = m.panes.map((p) => ({ ...p, tabs: [...p.tabs] }))
  if (toPane >= panes.length) {
    if (panes.length >= MAX_PANES) return m
    panes.push(newPane([]))
  }
  if (toPane !== drag.pane && panes[toPane].tabs.length >= MAX_TABS) return m
  panes[drag.pane].tabs.splice(drag.tab, 1)
  const index = toPane === drag.pane && drag.tab < toIndex ? toIndex - 1 : toIndex
  // A tab moved to another pane is mounted anew – it continues in its current folder.
  panes[toPane].tabs.splice(index, 0, toPane === drag.pane ? tab : current(tab))
  panes[toPane].active = Math.min(index, panes[toPane].tabs.length - 1)
  const source = panes[drag.pane]
  if (toPane !== drag.pane) source.active = Math.min(source.active > drag.tab ? source.active - 1 : source.active, source.tabs.length - 1)
  let activePane = toPane
  if (source.tabs.length === 0) {
    panes.splice(drag.pane, 1)
    if (toPane > drag.pane) activePane--
  }
  return { ...m, panes, activePane }
}

/** Adds panes up to `count`: parked panes come back first, new ones show `path`; the first added is active. */
function growPanes(m: Model, count: number, path: string): Model {
  const need = count - m.panes.length
  const revived = m.parked.slice(0, need)
  const added = Array.from({ length: need - revived.length }, () => newPane([newTab(path)]))
  return { panes: [...m.panes, ...revived, ...added], activePane: m.panes.length, parked: m.parked.slice(revived.length) }
}

/** Shows `count` panes for a workspace: extra panes are parked with their tabs, not merged. */
export function fitPanes(m: Model, count: number, path: string, current: CurrentOf): Model {
  if (count === m.panes.length) return m
  if (count > m.panes.length) return { ...growPanes(m, count, path), activePane: m.activePane }
  const extra = m.panes.slice(count).map((p) => ({ ...p, tabs: p.tabs.map(current) }))
  return { panes: m.panes.slice(0, count), activePane: Math.min(m.activePane, count - 1), parked: [...extra, ...m.parked] }
}

/** Splits into `count` panes: new panes show `path`, removed panes hand their tabs to the last one. */
export function setPaneCount(m: Model, count: number, path: string, current: CurrentOf): Model {
  if (count === m.panes.length) return m
  if (count > m.panes.length) return growPanes(m, count, path)
  const kept = m.panes.slice(0, count).map((p) => ({ ...p }))
  const orphans = m.panes.slice(count).flatMap((p) => p.tabs.map(current))
  const last = kept[count - 1]
  const combined = [...last.tabs, ...orphans]
  last.tabs = combined.slice(0, MAX_TABS)
  // Tabs beyond what one pane holds are parked rather than lost.
  const overflow: PaneModel[] = []
  for (let i = MAX_TABS; i < combined.length; i += MAX_TABS) overflow.push(newPane(combined.slice(i, i + MAX_TABS)))
  return { panes: kept, activePane: Math.min(m.activePane, count - 1), parked: [...overflow, ...m.parked] }
}

export const focusPane = (m: Model, index: number): Model => (m.activePane !== index && m.panes[index] ? { ...m, activePane: index } : m)

/** Gives pane `index` the share `left` of its own and its left neighbour's weight together. */
export function resizePanes(m: Model, index: number, left: number, total: number): Model {
  return { ...m, panes: m.panes.map((p, i) => (i === index - 1 ? { ...p, weight: left } : i === index ? { ...p, weight: total - left } : p)) }
}
