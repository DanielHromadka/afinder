import { useCallback, useEffect, useRef, useState } from 'react'
import type { Listing } from '@shared/types'
import { createLoadGate } from '@renderer/lib/loadGate'
import { playSound } from '@renderer/lib/sound'

// A tab's folder: what it lists, where it came from (back/forward) and how it gets there. Every listing goes
// through the load gate, so answers arriving out of order (slow shares, remote connections) never take the
// tab back to a folder the user already left.

const api = window.api

export interface History {
  back: string[]
  forward: string[]
}

export type NavigationMode = 'push' | 'back' | 'forward'

export interface DirectoryNavigation {
  listing: Listing | null
  history: History
  /** Opens `target`; `selectPath` is selected there (going up selects the folder that was left). */
  navigate(target: string, mode?: NavigationMode, selectPath?: string): Promise<void>
  /**
   * Re-reads the current folder. Resolves with the new listing, or null when a navigation or a newer refresh
   * overtook it, or when the folder is gone (the tab then moves to its nearest parent).
   */
  refresh(): Promise<Listing | null>
  goBack(): void
  goForward(): void
}

export function useDirectoryNavigation(options: {
  initialPath: string
  /** The tab entered `listing` (another folder or the same one again): reset what belongs to the old one. */
  onEnter(listing: Listing, selectPath: string | undefined): void
  onError(err: unknown): void
}): DirectoryNavigation {
  const [listing, setListing] = useState<Listing | null>(null)
  const [history, setHistory] = useState<History>({ back: [], forward: [] })
  const listingRef = useRef(listing)
  listingRef.current = listing
  const historyRef = useRef(history)
  historyRef.current = history
  const [gate] = useState(createLoadGate)
  // The callbacks change with every render of the tab; the navigation functions stay the same.
  const callbacks = useRef(options)
  callbacks.current = options

  const navigate = useCallback(
    async (target: string, mode: NavigationMode = 'push', selectPath?: string): Promise<void> => {
      const wanted = gate.navigation()
      let next: Listing
      try {
        next = await api.list(target)
      } catch (err) {
        if (wanted()) callbacks.current.onError(err)
        return
      }
      if (!wanted()) return
      const prev = listingRef.current?.path ?? null
      if (prev && prev !== next.path) {
        setHistory((h) =>
          mode === 'push'
            ? { back: [...h.back, prev], forward: [] }
            : mode === 'back'
              ? { back: h.back.slice(0, -1), forward: [prev, ...h.forward] }
              : { back: [...h.back, prev], forward: h.forward.slice(1) }
        )
        playSound('navigate')
      }
      listingRef.current = next
      setListing(next)
      callbacks.current.onEnter(next, selectPath)
      void api.setSettings({ lastPath: next.path }).catch(() => {})
    },
    [gate]
  )

  const refresh = useCallback(async (): Promise<Listing | null> => {
    const current = listingRef.current
    if (!current) return null
    const wanted = gate.refresh()
    // Shown only while the tab still lists the folder that was re-read: a navigation may have finished meanwhile.
    const stillHere = (): boolean => wanted() && listingRef.current?.path === current.path
    try {
      const next = await api.list(current.path)
      if (!stillHere()) return null
      listingRef.current = next
      setListing(next)
      return next
    } catch {
      // The folder disappeared (deleted, unmounted): go to the nearest parent that is still there.
      if (stillHere() && current.parent) void navigate(current.parent)
      return null
    }
  }, [gate, navigate])

  const goBack = useCallback((): void => {
    const target = historyRef.current.back.at(-1)
    if (target) void navigate(target, 'back')
  }, [navigate])

  const goForward = useCallback((): void => {
    const target = historyRef.current.forward[0]
    if (target) void navigate(target, 'forward')
  }, [navigate])

  // The first folder; one that cannot be read falls back to the home folder.
  useEffect(() => {
    const wanted = gate.navigation()
    void (async () => {
      const first = await api.list(options.initialPath).catch(() => api.list(api.homeDir).catch(() => null))
      if (!first || !wanted()) return
      listingRef.current = first
      setListing(first)
    })()
  }, [])

  return { listing, history, navigate, refresh, goBack, goForward }
}
