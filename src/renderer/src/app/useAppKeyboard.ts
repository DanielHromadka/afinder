import { useEffect, useRef } from 'react'
import { keys } from '@renderer/lib/keys'
import { isModalOpen } from '@renderer/lib/modal'

// The window's shortcuts: settings, tour, palette, console, workspaces and areas, tabs and panes. They run in
// the capture phase, before the focused tab's own shortcuts, and stand back while something modal is open.

export interface AppKeyActions {
  /** False until the window has its panes, and while an error is shown. */
  ready: boolean
  openSettings(): void
  startTour(): void
  openPalette(): void
  toggleConsole(): void
  cycleWorkspace(step: number): void
  toggleMaximize(): void
  newTab(): void
  closeTab(): void
  newWindow(): void
  toggleSplit(): void
  cycleTab(step: number): void
  /** 1–8 select that tab, 9 the last one. */
  selectTabDigit(digit: number): void
  paneCount: number
  /** Tab moves between panes when there are several. */
  cyclePane(step: number): void
}

export function useAppKeyboard(actions: AppKeyActions): void {
  const latest = useRef(actions)
  latest.current = actions

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const a = latest.current
      // A rename field in a tab also keeps the window's shortcuts away.
      if (!a.ready || isModalOpen() || document.querySelector('.rename-input')) return
      const take = (action: () => unknown): void => {
        e.preventDefault()
        e.stopImmediatePropagation()
        action()
      }
      const target = e.target as HTMLElement
      if ((keys.isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key === ',') return take(a.openSettings)
      if (keys.is(e, 'tour')) return take(a.startTour)
      if (keys.is(e, 'palette') && !target.closest?.('.console')) return take(a.openPalette)
      if (keys.is(e, 'toggleConsole')) return take(a.toggleConsole)
      // Workspace and area commands work from every area, the console included.
      if (keys.is(e, 'nextWorkspace')) return take(() => a.cycleWorkspace(1))
      if (keys.is(e, 'prevWorkspace')) return take(() => a.cycleWorkspace(-1))
      if (keys.is(e, 'maximizeArea')) return take(a.toggleMaximize)
      // Everything else typed into the integrated console belongs to the shell or agent running there.
      if (target.closest?.('.console')) return
      const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable
      const digit = keys.tabDigit(e)
      if (keys.is(e, 'newTab')) return take(a.newTab)
      if (keys.is(e, 'closeTab')) return take(a.closeTab)
      if (keys.is(e, 'newWindow')) return take(a.newWindow)
      if (keys.is(e, 'split')) return take(a.toggleSplit)
      if (keys.is(e, 'nextTab')) return take(() => a.cycleTab(1))
      if (keys.is(e, 'prevTab')) return take(() => a.cycleTab(-1))
      if (digit) return take(() => a.selectTabDigit(digit))
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && !inInput && a.paneCount > 1) take(() => a.cyclePane(e.shiftKey ? -1 : 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
