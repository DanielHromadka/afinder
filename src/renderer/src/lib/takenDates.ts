// Dates taken of photos and videos, read once and shared by the "Date taken" grouping and batch renames.
// Read a few at a time in the background; remote files are skipped (they would be downloaded).

import { hasExifSupport } from '@shared/exif'
import { previewKind } from '@shared/preview'
import type { FileEntry } from '@shared/types'
import { dateTaken, mapLimit } from './mediaInfo'
import { remoteMountOf } from './remotes'

const cache = new Map<string, string | null>()
const keyOf = (e: FileEntry): string => `${e.path}|${e.modified}|${e.size}`

/** Files that can carry a date taken. */
export function canHaveTaken(e: FileEntry): boolean {
  if (e.isDir || remoteMountOf(e.path)) return false
  const kind = previewKind(e.name)
  return (kind === 'image' && hasExifSupport(e.name)) || kind === 'video'
}

/** `YYYY-MM-DDTHH:MM:SS`, null when the file has none, undefined when not read yet. */
export function cachedTaken(e: FileEntry): string | null | undefined {
  return canHaveTaken(e) ? cache.get(keyOf(e)) : null
}

/** Reads the dates not known yet; `onBatch` is called now and then (at most every 300 ms) and at the end. */
export async function loadTaken(entries: FileEntry[], signal: AbortSignal, onBatch: () => void): Promise<(string | null)[]> {
  let last = 0
  const out = await mapLimit(entries, 4, async (e) => {
    if (!canHaveTaken(e)) return null
    const key = keyOf(e)
    if (!cache.has(key)) {
      if (signal.aborted) return null
      cache.set(key, await dateTaken(e))
      if (Date.now() - last > 300) {
        last = Date.now()
        if (!signal.aborted) onBatch()
      }
    }
    return cache.get(key) ?? null
  })
  if (!signal.aborted) onBatch()
  return out
}
