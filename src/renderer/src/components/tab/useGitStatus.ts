import { useEffect, useMemo, useState } from 'react'
import { gitLookup, type GitState, type GitStatus } from '@shared/git'
import { isInside, samePath } from '@shared/paths'
import type { Listing } from '@shared/types'
import type { Row } from '../FileList'
import { GIT_CHANGED } from '../GitPanel'

// The git state of a tab's folder and of its rows. Refreshed with every listing (the folder changed on disk),
// when the window regains focus, when the source control area changed something and every 15 s while the
// tab is in front – commits and checkouts change nothing in the folder itself.

const api = window.api

export function useGitStatus(path: string | null, listing: Listing | null, visible: boolean, rows: Row[]): { git: GitStatus | null; states: Map<string, GitState> } {
  const [git, setGit] = useState<GitStatus | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!visible) return
    const bump = (): void => setTick((n) => n + 1)
    const timer = setInterval(bump, 15_000)
    window.addEventListener('focus', bump)
    window.addEventListener(GIT_CHANGED, bump)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', bump)
      window.removeEventListener(GIT_CHANGED, bump)
    }
  }, [visible])

  useEffect(() => {
    if (!path || !visible) return
    let live = true
    const timer = setTimeout(() => {
      api.gitStatus(path).then(
        (s) => live && setGit(s),
        () => live && setGit(null)
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [path, listing, visible, tick])
  useEffect(() => setGit(null), [path])

  /** Rows with a state, keyed by path. */
  const states = useMemo(() => {
    const out = new Map<string, GitState>()
    if (!git || !path) return out
    const look = gitLookup(git)
    for (const { entry } of rows) {
      if (!isInside(entry.path, path) || samePath(entry.path, path)) continue
      const rel = entry.path.slice(path.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
      const state = look(rel, entry.isDir)
      if (state) out.set(entry.path, state)
    }
    return out
  }, [git, rows, path])

  return { git, states }
}
