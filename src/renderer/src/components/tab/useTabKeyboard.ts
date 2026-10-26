import { useEffect, useRef } from 'react'
import { dirOf } from '@shared/paths'
import { keys } from '@renderer/lib/keys'
import { isModalOpen } from '@renderer/lib/modal'
import type { TabContext } from './actions'
import { favoriteOf } from './contextMenu'

// The focused tab's keyboard: file list navigation, the file shortcuts and the ones that work while typing
// in the filter. The window's own shortcuts (tabs, panes, palette) run before these, in the capture phase.

export interface TabKeys {
  /** Only the active tab of the active pane listens. */
  focused: boolean
  /** A rename field, the conflict question or a running transfer has the keys. */
  blocked: boolean
  filterInput: HTMLInputElement | null
  ctx: TabContext
}

/** Rows per Page Up/Down. */
const page = (): number => Math.max(1, Math.floor((window.innerHeight - 200) / 20))

export function useTabKeyboard(state: TabKeys): void {
  const latest = useRef(state)
  latest.current = state

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { focused, blocked, filterInput, ctx } = latest.current
      if (!focused || blocked || isModalOpen()) return
      const target = e.target as HTMLElement
      if (target.closest?.('.console')) return // keys typed into the integrated console
      if (target.closest?.('.preview')) return // the text viewer and media controls
      const inFilter = target === filterInput
      const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable
      const is = (command: Parameters<typeof keys.is>[1]): boolean => keys.is(e, command)
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey
      const handled = (): void => e.preventDefault()
      const { rows, focusIndex, path, selection } = ctx

      // Global shortcuts (work even while typing in the filter).
      if (is('recursive')) return handled(), ctx.toggleRecursive()
      if (is('filter')) return handled(), ctx.focusFilter(true)
      if (is('newFolder')) return handled(), ctx.newFolder()
      if (is('terminal')) return handled(), ctx.openTerminal()
      if (is('hidden')) return handled(), ctx.toggleHidden()
      if (is('copyPath')) return handled(), ctx.copyPath()
      if (is('preview')) return handled(), ctx.togglePreview()
      if (is('screenshot')) return handled(), ctx.takeScreenshot('region')
      if (is('viewDetails')) return handled(), ctx.setView('details')
      if (is('viewList')) return handled(), ctx.setView('list')
      if (is('viewIcons')) return handled(), ctx.setView('icons')
      if (is('favorite') && path) {
        const item = focusIndex >= 0 && selection.size > 0 ? rows[focusIndex].entry : null
        return handled(), ctx.toggleFavorite(item ? favoriteOf(item) : { path, isDir: true, kind: 'folder' })
      }
      // Alt+← / Alt+→ on Windows and Linux would move the caret in the filter – only outside inputs there.
      if (is('back') && (keys.isMac || !inInput)) return handled(), ctx.goBack()
      if (is('forward') && (keys.isMac || !inInput)) return handled(), ctx.goForward()

      if (inFilter) {
        if (e.key === 'Escape') return handled(), ctx.setFilter(''), filterInput?.blur()
        if (e.key === 'ArrowDown') return handled(), filterInput?.blur(), ctx.moveFocus(Math.max(focusIndex, 0), false)
        if (e.key === 'Enter' && rows.length) return handled(), ctx.openEntry(rows[Math.max(focusIndex, 0)].entry)
        return
      }
      if (inInput) return // the address bar handles its own keys

      const columns = ctx.columns()
      switch (true) {
        case is('up'):
          return handled(), ctx.goUp()
        case is('open') || (plain && e.key === 'Enter'):
          if (ctx.parentFocused) ctx.goUp()
          else if (focusIndex >= 0) ctx.openEntry(rows[focusIndex].entry)
          return handled()
        case is('trash'):
          return handled(), ctx.trashSelected()
        case is('quickLook'):
          if (focusIndex >= 0) ctx.setQuickLook(true)
          return handled()
        case plain && e.key === 'Backspace':
          return handled(), ctx.goUp()
        case is('pasteMove'):
          return handled(), ctx.paste(true)
        case is('copy'):
          return handled(), ctx.copySelection(false)
        case is('cut'):
          return handled(), ctx.copySelection(true)
        case is('paste'):
          return handled(), ctx.paste()
        case is('duplicate'):
          return handled(), ctx.duplicate()
        case is('selectAll'):
          return handled(), ctx.selectAll()
        case is('rename'):
          return handled(), ctx.startRename()
        case is('copyToPane'):
          return handled(), ctx.toOtherPane('copy')
        case is('moveToPane'):
          return handled(), ctx.toOtherPane('move')
        case !plain:
          return
        case e.key === 'ArrowDown':
          return handled(), ctx.moveFocus(focusIndex < 0 ? 0 : focusIndex + columns, e.shiftKey)
        case e.key === 'ArrowUp':
          return handled(), ctx.moveFocus(focusIndex < 0 ? -1 : focusIndex - columns, e.shiftKey)
        case ctx.treeOn && focusIndex >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft'): {
          const row = rows[focusIndex]
          handled()
          if (e.key === 'ArrowRight') return void (row.entry.isDir && ctx.toggleExpand(row.entry.path, true))
          if (row.entry.isDir && ctx.expanded.has(row.entry.path)) return ctx.toggleExpand(row.entry.path, false)
          // ← on an item inside an opened folder goes to that folder.
          if (row.depth) return ctx.select([dirOf(row.entry.path)])
          return
        }
        case ctx.view !== 'details' && e.key === 'ArrowRight':
          return handled(), ctx.moveFocus(focusIndex + 1, e.shiftKey)
        case ctx.view !== 'details' && e.key === 'ArrowLeft':
          return handled(), ctx.moveFocus(focusIndex < 0 ? -1 : focusIndex - 1, e.shiftKey)
        case e.key === 'Home':
          return handled(), ctx.moveFocus(ctx.hasParentRow ? -1 : 0, e.shiftKey)
        case e.key === 'End':
          return handled(), ctx.moveFocus(rows.length - 1, e.shiftKey)
        case e.key === 'PageDown':
          return handled(), ctx.moveFocus(focusIndex + page(), e.shiftKey)
        case e.key === 'PageUp':
          return handled(), ctx.moveFocus(focusIndex - page(), e.shiftKey)
        case e.key === 'Escape':
          return handled(), ctx.filter ? ctx.setFilter('') : ctx.select([])
        case e.key === '/':
          return handled(), ctx.focusFilter(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
