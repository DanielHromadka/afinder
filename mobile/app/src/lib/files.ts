// Files of the computer as the phone keeps them, so opening one feels local: a copy is downloaded on the
// first open (resuming a broken transfer), reused while the computer's version is unchanged, evicted when
// the cache grows too big, and kept for good when the user makes it available offline. Edits made on the
// phone go back to the computer, but never over a version someone changed there in the meantime.

import { sha256 } from '@noble/hashes/sha2.js'
import { Directory, File, FileMode, Paths } from 'expo-file-system'
import { useSyncExternalStore } from 'react'
import { utf8 } from '../../../../src/shared/companion/bytes'
import { CONFLICT, sameVersion, type FileVersion, type RemoteEntry } from '../../../../src/shared/companion/protocol'
import { dirOf } from '../../../../src/shared/paths'
import type { HostClient } from './client'

/** Copies that are not pinned are evicted, least recently used first, above this size. */
const CACHE_BYTES = 1024 ** 3

export interface Kept {
  computer: string
  path: string
  name: string
  /** The computer's version this copy was made from (or last sent back as). */
  remote: FileVersion
  /** The copy right after it was downloaded or sent back; a different file means unsent edits. */
  local: FileVersion
  /** Folder name under the cache or offline root. */
  slot: string
  used: number
  pinned: boolean
  /** A part file of this remote version is being (or was being) downloaded. */
  partial?: FileVersion
  /** The last attempt to send edits back found the file changed on the computer. */
  conflict?: boolean
}

const keyOf = (computer: string, path: string): string => `${computer}\n${path}`
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

const INDEX = new File(Paths.document, 'afinder-files.json')
const cacheRoot = (): Directory => new Directory(Paths.cache, 'files')
const offlineRoot = (): Directory => new Directory(Paths.document, 'offline')

let index = new Map<string, Kept>()
let snapshot: Kept[] = []
const listeners = new Set<() => void>()

function load(): void {
  try {
    const list = INDEX.exists ? (JSON.parse(INDEX.textSync()) as Kept[]) : []
    index = new Map(list.filter((k) => typeof k?.path === 'string' && typeof k.slot === 'string').map((k) => [keyOf(k.computer, k.path), k]))
  } catch {
    index = new Map()
  }
  // iOS may empty the cache folder whenever the app is not running.
  for (const [k, kept] of index) if (!fileOf(kept).exists) index.delete(k)
  // Copies downloaded before that was fixed were recorded as size 0 at time 0 and showed as edited.
  for (const kept of index.values()) if (!kept.local.size && !kept.local.modified && fileOf(kept).size === kept.remote.size) kept.local = versionOf(fileOf(kept))
  snapshot = [...index.values()]
}

function save(): void {
  snapshot = [...index.values()]
  try {
    INDEX.write(JSON.stringify(snapshot))
  } catch {
    // The index is rebuilt from scratch next time; the files are only a cache.
  }
  for (const fn of listeners) fn()
}

const folderOf = (kept: Pick<Kept, 'pinned' | 'slot'>): Directory => new Directory(kept.pinned ? offlineRoot() : cacheRoot(), kept.slot)
export const fileOf = (kept: Kept): File => new File(folderOf(kept), kept.name)
const versionOf = (file: File): FileVersion => ({ size: file.size ?? 0, modified: Math.floor(file.modificationTime ?? 0) })

// After the helpers it uses: they are consts and not there yet above.
load()

export const kept = (computer: string, path: string): Kept | undefined => index.get(keyOf(computer, path))

/** The phone's copy has changes the computer does not have yet. */
export function edited(k: Kept): boolean {
  const file = fileOf(k)
  return file.exists && !sameVersion(versionOf(file), k.local)
}

/** A copy that can be opened right now without asking the computer: current, or edited here. */
export function ready(computer: string, entry: RemoteEntry): File | null {
  const k = kept(computer, entry.path)
  if (!k || !fileOf(k).exists) return null
  if (edited(k) || sameVersion(k.remote, { size: entry.size ?? 0, modified: entry.modified })) return fileOf(k)
  return null
}

export type Progress = (done: number, total: number) => void

/** Returns a current copy of the file, downloading only what is missing. */
export async function ensure(client: HostClient, entry: Pick<RemoteEntry, 'path' | 'name' | 'size' | 'modified'>, progress?: Progress, signal?: AbortSignal): Promise<File> {
  const computer = client.computer.id
  const want: FileVersion = { size: entry.size ?? 0, modified: entry.modified }
  let k = kept(computer, entry.path)
  if (k && fileOf(k).exists && (edited(k) || sameVersion(k.remote, want))) {
    k.used = Date.now()
    save()
    return fileOf(k)
  }
  if (!k) {
    k = { computer, path: entry.path, name: entry.name, remote: want, local: want, slot: hex(sha256(utf8(keyOf(computer, entry.path)))).slice(0, 24), used: Date.now(), pinned: false }
    index.set(keyOf(computer, entry.path), k)
  }
  const dir = folderOf(k)
  dir.create({ intermediates: true, idempotent: true })
  const part = new File(dir, `${entry.name}.part`)
  // A part of the same version is continued; anything else starts over.
  const resume = k.partial && sameVersion(k.partial, want) && part.exists ? (part.size ?? 0) : 0
  if (!resume) {
    if (part.exists) part.delete()
    part.create()
  }
  k.partial = want
  save()
  const handle = part.open(FileMode.Append)
  let meta: FileVersion
  try {
    meta = await client.download(entry.path, async (data) => handle.writeBytes(data), progress, resume, signal)
  } finally {
    handle.close()
  }
  const target = new File(dir, entry.name)
  if (target.exists) target.delete()
  part.move(target)
  // A fresh File: `target` was deleted above and reports no size or time after the move.
  Object.assign(k, { name: entry.name, remote: { size: meta.size, modified: meta.modified }, local: versionOf(new File(dir, entry.name)), used: Date.now(), partial: undefined, conflict: false })
  save()
  evict()
  return target
}

/** Keeps the cache under its size; pinned copies, unsent edits and the newest file always stay. */
function evict(): void {
  const loose = [...index.values()].filter((k) => !k.pinned && !edited(k)).sort((a, b) => b.used - a.used)
  let total = 0
  for (const k of loose) {
    total += fileOf(k).size ?? 0
    if (total > CACHE_BYTES && k !== loose[0]) forget(k)
  }
}

function forget(k: Kept): void {
  try {
    folderOf(k).delete()
  } catch {
    // already gone
  }
  index.delete(keyOf(k.computer, k.path))
}

/** Sends the phone's edits to the computer. `force` overwrites a version changed there meanwhile. */
export async function sendBack(client: HostClient, k: Kept, force = false, progress?: Progress): Promise<void> {
  const file = fileOf(k)
  const now = versionOf(file)
  const handle = file.open(FileMode.ReadOnly)
  try {
    await client.replace(k.path, now.size, async (offset, length) => ((handle.offset = offset), handle.readBytes(length)), force ? undefined : k.remote, progress)
  } catch (err) {
    if ((err as Error).message === CONFLICT) {
      k.conflict = true
      save()
    }
    throw err
  } finally {
    handle.close()
  }
  const stat = await client.call('stat', { path: k.path })
  Object.assign(k, { remote: { size: stat.size, modified: stat.modified }, local: now, conflict: false })
  save()
}

/** Keeps both versions: the phone's edits become a new file next to the original. */
export async function sendAsCopy(client: HostClient, k: Kept, progress?: Progress): Promise<string> {
  const file = fileOf(k)
  const size = file.size ?? 0
  const handle = file.open(FileMode.ReadOnly)
  let saved: string
  try {
    saved = await client.upload(dirOf(k.path), k.name, size, async (offset, length) => ((handle.offset = offset), handle.readBytes(length)), progress)
  } finally {
    handle.close()
  }
  // The edits now live in the new file on the computer; the original is downloaded fresh next time.
  forget(k)
  save()
  return saved
}

/** Discards the phone's edits; the next open downloads the computer's version. */
export function discard(k: Kept): void {
  forget(k)
  save()
}

/** Moves the copy out of (or back into) the cache, which the system and eviction may empty. */
export async function setPinned(client: HostClient, entry: Pick<RemoteEntry, 'path' | 'name' | 'size' | 'modified'>, pinned: boolean, progress?: Progress): Promise<void> {
  if (pinned) await ensure(client, entry, progress)
  const k = kept(client.computer.id, entry.path)
  if (!k || k.pinned === pinned) return
  const from = folderOf(k)
  const to = folderOf({ ...k, pinned })
  to.parentDirectory.create({ intermediates: true, idempotent: true })
  if (to.exists) to.delete()
  from.move(to)
  k.pinned = pinned
  save()
}

/**
 * Brings the offline files of a computer up to date once it is reachable: edits made here go back (a
 * file changed on both sides is marked and left for the user), newer versions come down.
 */
const syncing = new Set<string>()
export async function sync(client: HostClient): Promise<void> {
  if (syncing.has(client.computer.id)) return
  syncing.add(client.computer.id)
  try {
    await syncNow(client)
  } finally {
    syncing.delete(client.computer.id)
  }
}

async function syncNow(client: HostClient): Promise<void> {
  for (const k of [...index.values()].filter((x) => x.pinned && x.computer === client.computer.id)) {
    try {
      if (edited(k)) {
        if (!k.conflict && client.state.kind === 'ready' && client.state.info.write) await sendBack(client, k)
        continue
      }
      const stat = await client.call('stat', { path: k.path })
      if (!sameVersion(stat, k.remote)) await ensure(client, { path: k.path, name: k.name, size: stat.size, modified: stat.modified })
    } catch {
      // Gone, renamed or offline again: try next time.
    }
  }
}

export function useKept(): Kept[] {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => snapshot
  )
}
