import { describe, expect, it } from 'vitest'
import {
  changeEditor,
  defaultWorkspaces,
  editorsOf,
  insertEditor,
  presetWorkspace,
  removeEditor,
  sanitizeTree,
  sanitizeWorkspaces,
  setRatio,
  toggleEditor,
  visibleTree,
  type AreaNode
} from './workspace'

const agent = presetWorkspace('agent').root

describe('workspace tree', () => {
  it('lists editors in reading order', () => {
    expect(editorsOf(agent)).toEqual(['folders', 'files', 'console'])
  })

  it('removes an area and lets the sibling take its space, but never Files', () => {
    expect(editorsOf(removeEditor(agent, 'console'))).toEqual(['folders', 'files'])
    expect(removeEditor(agent, 'files')).toBe(agent)
  })

  it('inserts at an edge with the requested share', () => {
    const t = insertEditor({ editor: 'files' }, 'files', 'bottom', 'console', 0.3)
    expect(t).toEqual({ split: 'column', ratio: 0.7, a: { editor: 'files' }, b: { editor: 'console' } })
    const left = insertEditor({ editor: 'files' }, 'files', 'left', 'folders', 0.2)
    expect(left).toEqual({ split: 'row', ratio: 0.2, a: { editor: 'folders' }, b: { editor: 'files' } })
  })

  it('moves an editor that is already present instead of duplicating it', () => {
    const moved = insertEditor(agent, 'files', 'top', 'console')
    expect(editorsOf(moved).sort()).toEqual(['console', 'files', 'folders'])
    expect(editorsOf(moved)).toEqual(['folders', 'console', 'files'])
  })

  it('swaps when changing to an editor shown elsewhere', () => {
    expect(editorsOf(changeEditor(agent, 'folders', 'console'))).toEqual(['console', 'files', 'folders'])
    expect(editorsOf(changeEditor(agent, 'folders', 'preview'))).toEqual(['preview', 'files', 'console'])
  })

  it('hides in place and restores the same position', () => {
    const hidden = toggleEditor(agent, 'console', false, 'bottom', 0.3)
    expect(visibleTree(hidden)).toEqual(visibleTree(removeEditor(agent, 'console')))
    expect(toggleEditor(hidden, 'console', true, 'bottom', 0.3)).toEqual(agent)
    // Absent editors are added next to Files.
    expect(editorsOf(toggleEditor(agent, 'preview', true, 'right', 0.3))).toEqual(['folders', 'files', 'preview', 'console'])
  })

  it('sets the ratio of a nested divider and clamps it', () => {
    const t = setRatio(agent, 'b', 2) as Extract<AreaNode, { split: string }>
    expect((t.b as Extract<AreaNode, { split: string }>).ratio).toBeLessThan(1)
    expect(t.ratio).toBe(0.18)
  })
})

describe('validation', () => {
  it('drops duplicates and bad nodes, requires Files', () => {
    expect(sanitizeTree({ split: 'row', ratio: 9, a: { editor: 'files' }, b: { editor: 'files' } })).toEqual({ editor: 'files' })
    expect(sanitizeTree({ editor: 'console' })).toBeNull()
    expect(sanitizeTree({ split: 'diagonal', a: { editor: 'files' } })).toBeNull()
    expect(sanitizeTree({ editor: 'files', hidden: true })).toEqual({ editor: 'files' })
  })

  it('keeps valid workspaces and fixes their fields', () => {
    const list = sanitizeWorkspaces([...defaultWorkspaces(), { id: 'files', root: { editor: 'files' } }, { id: 'x y', root: { editor: 'files' } }, { id: 'mine', name: '  Mine  ', root: { editor: 'files' }, panes: 9, paneAxis: 'up' }])
    expect(list?.map((w) => w.id)).toEqual(['files', 'commander', 'agent', 'preview', 'mine'])
    expect(list?.at(-1)).toEqual({ id: 'mine', name: 'Mine', root: { editor: 'files' }, panes: 4, paneAxis: 'row' })
    expect(sanitizeWorkspaces([])).toBeNull()
  })
})
