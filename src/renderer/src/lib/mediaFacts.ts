// Duration and pixel size of files for the media columns of the details view. Images give their size from
// the header (first bytes only); audio and video ask Mediabunny for the headers. A few files at a time,
// rows that scrolled away drop out of the queue, and results stay in a cache keyed by the file's version.

import { IMAGE_SIZE_BYTES, imageSize } from '@shared/imageSize'
import { previewKind } from '@shared/preview'
import type { FileEntry } from '@shared/types'
import { fetchBytes, readMediaDetails } from './mediaInfo'
import { remoteMountOf } from './remotes'

export interface MediaFacts {
  duration?: number
  width?: number
  height?: number
}

const CONCURRENCY = 4
const CACHE_SIZE = 5000

const cache = new Map<string, MediaFacts | null>()
const waiting: { key: string; entry: FileEntry; resolve(f: MediaFacts | null): void; signal: AbortSignal }[] = []
const pending = new Map<string, Promise<MediaFacts | null>>()
let running = 0

const keyOf = (e: FileEntry): string => `${e.path}|${e.modified}|${e.size}`

/** Photos, videos and songs on local disks. */
export function hasMediaFacts(entry: FileEntry): boolean {
  if (entry.isDir || remoteMountOf(entry.path)) return false
  const kind = previewKind(entry.name)
  return kind === 'image' || kind === 'video' || kind === 'audio'
}

export const cachedFacts = (entry: FileEntry): MediaFacts | null | undefined => cache.get(keyOf(entry))

export function mediaFacts(entry: FileEntry, signal: AbortSignal): Promise<MediaFacts | null> {
  const key = keyOf(entry)
  if (cache.has(key)) return Promise.resolve(cache.get(key)!)
  const already = pending.get(key)
  if (already) return already
  const promise = new Promise<MediaFacts | null>((resolve) => {
    waiting.push({ key, entry, resolve, signal })
    pump()
  })
  pending.set(key, promise)
  void promise.finally(() => pending.delete(key))
  return promise
}

function pump(): void {
  while (running < CONCURRENCY && waiting.length) {
    const job = waiting.pop()!
    if (job.signal.aborted) {
      job.resolve(null)
      continue
    }
    running++
    void read(job.entry)
      .catch(() => null)
      .then((facts) => {
        cache.set(job.key, facts)
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
        job.resolve(facts)
      })
      .finally(() => {
        running--
        pump()
      })
  }
}

async function read(entry: FileEntry): Promise<MediaFacts | null> {
  if (previewKind(entry.name) === 'image') return imageSize(await fetchBytes(entry.path, IMAGE_SIZE_BYTES))
  const d = await readMediaDetails(entry.path, entry.size, false)
  return { duration: d.duration, width: d.width, height: d.height }
}
