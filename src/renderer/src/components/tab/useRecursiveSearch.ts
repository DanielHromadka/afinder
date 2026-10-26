import { useEffect, useState } from 'react'
import type { FileEntry } from '@shared/types'

// The filter searching the folder's whole tree (the Subfolders switch): results stream in from the search
// worker; typing restarts the search after a short pause.

const api = window.api
const SEARCH_DEBOUNCE_MS = 250

export interface Search {
  entries: FileEntry[]
  running: boolean
  truncated: boolean
}

export function useRecursiveSearch(options: {
  id: string
  /** The folder to search, null when not searching. */
  root: string | null
  query: string
  fuzzy: boolean
  showHidden: boolean
  /** Bumped to search again (after a reload). */
  nonce: number
  showError(err: unknown): void
}): Search | null {
  const { id, root, query, fuzzy, showHidden, nonce, showError } = options
  const [search, setSearch] = useState<Search | null>(null)

  useEffect(
    () =>
      api.onSearchResults((batch) => {
        if (batch.id !== id) return
        setSearch((s) => s && { entries: s.entries.concat(batch.entries), running: !batch.done, truncated: s.truncated || batch.truncated })
      }),
    [id]
  )

  useEffect(() => {
    if (!root) {
      setSearch(null)
      return
    }
    const timer = setTimeout(() => {
      setSearch({ entries: [], running: true, truncated: false })
      api.search(id, { root, query, fuzzy, showHidden }).catch((err) => {
        setSearch(null)
        showError(err)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      api.cancelSearch(id)
    }
  }, [id, root, query, fuzzy, showHidden, nonce, showError])

  return search
}
