import { describe, expect, it } from 'vitest'
import { MAX_PANES, MAX_TABS } from '@shared/types'
import { activateTab, addTab, closeTab, fitPanes, layoutOf, moveTab, newPane, newTab, setPaneCount, type Model } from './paneModel'

const same = <T>(x: T): T => x
const paths = (m: Model): string[][] => m.panes.map((p) => p.tabs.map((t) => t.path))
const two = (): Model => ({ panes: [newPane([newTab('/a'), newTab('/b')], 0), newPane([newTab('/c')])], activePane: 0, parked: [] })

describe('pane model', () => {
  it('adds a tab after the active one and keeps that one active', () => {
    const m = addTab(two(), 0, newTab('/new'))
    expect(paths(m)[0]).toEqual(['/a', '/new', '/b'])
    expect(m.panes[0].active).toBe(0)
    const before = addTab(two(), 0, newTab('/first'), 0)
    expect(before.panes[0].active).toBe(1)
  })

  it('refuses a tab beyond the limit', () => {
    let m: Model = { panes: [newPane([newTab('/x')])], activePane: 0, parked: [] }
    for (let i = 0; i < MAX_TABS + 3; i++) m = addTab(m, 0, newTab(`/t${i}`))
    expect(m.panes[0].tabs).toHaveLength(MAX_TABS)
  })

  it('closes a tab, and the pane with its last tab', () => {
    const m = closeTab(two(), 0, 0)
    expect(paths(m)).toEqual([['/b'], ['/c']])
    const gone = closeTab({ ...two(), activePane: 1 }, 1, 0)
    expect(paths(gone)).toEqual([['/a', '/b']])
    expect(gone.activePane).toBe(0)
  })

  it('moves a tab to another pane in its current folder, and into a new pane', () => {
    const current = (t: ReturnType<typeof newTab>) => ({ ...t, path: `${t.path}/now` })
    const m = moveTab(two(), { pane: 0, tab: 1 }, 1, 0, current)
    expect(paths(m)).toEqual([['/a'], ['/b/now', '/c']])
    expect(m.activePane).toBe(1)
    const split = moveTab(two(), { pane: 0, tab: 0 }, 2, 0, same)
    expect(paths(split)).toEqual([['/b'], ['/c'], ['/a']])
  })

  it('parks panes a workspace has no room for and brings them back', () => {
    const fewer = fitPanes(two(), 1, '/home', same)
    expect(paths(fewer)).toEqual([['/a', '/b']])
    expect(fewer.parked.map((p) => p.tabs.map((t) => t.path))).toEqual([['/c']])
    const back = fitPanes(fewer, 2, '/home', same)
    expect(paths(back)).toEqual([['/a', '/b'], ['/c']])
    expect(fitPanes(back, 3, '/home', same).panes[2].tabs[0].path).toBe('/home')
  })

  it('merges removed panes into the last kept one, parking overflow instead of losing tabs', () => {
    const many: Model = { panes: [newPane(Array.from({ length: MAX_TABS }, (_, i) => newTab(`/p${i}`))), newPane([newTab('/extra')])], activePane: 1, parked: [] }
    const one = setPaneCount(many, 1, '/home', same)
    expect(one.panes[0].tabs).toHaveLength(MAX_TABS)
    expect(one.parked[0].tabs.map((t) => t.path)).toEqual(['/extra'])
    expect(one.activePane).toBe(0)
    expect(setPaneCount(one, MAX_PANES, '/home', same).panes).toHaveLength(MAX_PANES)
  })

  it('activates a tab by id and saves the layout with current folders', () => {
    const m = two()
    const id = m.panes[1].tabs[0].id
    expect(activateTab(m, id).activePane).toBe(1)
    expect(layoutOf(m, (t) => ({ ...t, path: t.path.toUpperCase() })).panes[0].tabs[1].path).toBe('/B')
  })
})
