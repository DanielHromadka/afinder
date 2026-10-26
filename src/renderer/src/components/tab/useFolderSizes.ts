import { useEffect, useState } from 'react'
import type { FileEntry, Listing, SizeUpdate } from '@shared/types'

// Sizes of the folders a tab shows, computed in the size worker and streamed back. Only a visible tab
// watches; a hidden one asks again when it is shown.

const api = window.api

/** Folders whose size has to be computed (symlinks are never followed). */
const needsSize = (e: FileEntry): boolean => e.size === null && !e.isSymlink

export function useFolderSizes(options: {
  id: string
  listing: Listing | null
  visible: boolean
  showHidden: boolean
  /** Entries of folders opened in place, sized too. */
  opened: FileEntry[]
  showError(err: unknown): void
}): [Map<string, SizeUpdate>, () => void] {
  const { id, listing, visible, showHidden, opened, showError } = options
  const [sizes, setSizes] = useState<Map<string, SizeUpdate>>(new Map())

  useEffect(
    () =>
      api.onSizes((updates) =>
        setSizes((m) => {
          const next = new Map(m)
          for (const u of updates) next.set(u.path, u)
          return next
        })
      ),
    []
  )

  useEffect(() => {
    if (!listing || !visible) return
    const dirs = [...listing.entries, ...opened].filter((e) => needsSize(e) && (showHidden || !e.hidden)).map((e) => e.path)
    void api.watchSizes(id, listing.path, dirs).catch(showError)
  }, [id, listing, visible, showHidden, showError, opened])
  useEffect(() => {
    if (!visible) api.unwatchSizes(id)
  }, [id, visible])
  useEffect(() => () => api.unwatchSizes(id), [id])

  return [sizes, () => setSizes(new Map())]
}
