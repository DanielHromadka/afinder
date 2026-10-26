// Runs in an Electron utilityProcess. Searches a folder tree by name off the main process.
//
// Protocol (parent → worker):
//   { type: 'start', key, request: SearchRequest }   starts a search, replacing one with the same key
//   { type: 'cancel', key }
// Worker → parent: { key, entries: FileEntry[], done, truncated }
//
// The walk is breadth-first, so shallow matches arrive first. Symlinks and macOS .app bundles are
// never entered, hidden folders only when hidden files are shown.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { match } from '@shared/matcher'
import type { FileEntry, SearchRequest } from '@shared/types'
import { isHiddenName, toEntry } from '../main/services/entries'

const MAX_RESULTS = 5000
const FLUSH_INTERVAL_MS = 150
const isMac = process.platform === 'darwin'
/** Mount points, system trees and pseudo file systems that would repeat or bloat a search from a root. */
const SKIP = new Set(
  process.platform === 'win32'
    ? ['$recycle.bin', 'system volume information', 'windows', '$windows.~bt', '$windows.~ws', 'recovery'].map((n) => n.toLowerCase())
    : isMac
      ? ['/Volumes', '/System', '/dev', '/private/var/vm', '/cores']
      : ['/proc', '/sys', '/dev', '/run', '/snap', '/media', '/mnt']
)
const isRoot = (p: string): boolean => path.dirname(p) === p

/** Should the walk stay out of this folder? (.app bundles on macOS, system trees under a root) */
function skipDir(dir: string, name: string, root: string): boolean {
  if (isMac && name.endsWith('.app')) return true
  if (!isRoot(root)) return false
  // Windows: top-level system folders of the drive; Unix: the listed absolute paths.
  return process.platform === 'win32' ? isRoot(dir) && SKIP.has(name.toLowerCase()) : SKIP.has(path.join(dir, name))
}

interface Job {
  key: string
  cancelled: boolean
}

type Message = { type: 'start'; key: string; request: SearchRequest } | { type: 'cancel'; key: string }

const parentPort = process.parentPort
const jobs = new Map<string, Job>()

parentPort.on('message', (e) => {
  const msg = e.data as Message
  const previous = jobs.get(msg?.key)
  if (previous) previous.cancelled = true
  jobs.delete(msg?.key)
  if (msg?.type !== 'start') return
  const job: Job = { key: msg.key, cancelled: false }
  jobs.set(msg.key, job)
  void run(job, msg.request).finally(() => {
    if (jobs.get(job.key) === job) jobs.delete(job.key)
  })
})

async function run(job: Job, req: SearchRequest): Promise<void> {
  let batch: FileEntry[] = []
  let found = 0
  let lastFlush = Date.now()
  const flush = (done: boolean, truncated = false): void => {
    if (job.cancelled) return
    parentPort.postMessage({ key: job.key, entries: batch, done, truncated })
    batch = []
    lastFlush = Date.now()
  }

  if (!req.query.trim()) return flush(true)
  const queue: string[] = [req.root]
  while (queue.length > 0) {
    if (job.cancelled) return
    const dir = queue.shift()!
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable folder – skip it
    }
    for (const d of dirents) {
      const hidden = isHiddenName(d.name)
      if (hidden && !req.showHidden) continue
      const full = path.join(dir, d.name)
      if (d.isDirectory() && !skipDir(dir, d.name, req.root)) {
        queue.push(full)
      }
      if (!match(d.name, req.query, req.fuzzy)) continue
      const entry = await toEntry(dir, d.name)
      if (!entry) continue
      batch.push(entry)
      if (++found >= MAX_RESULTS) return flush(true, true)
    }
    if (Date.now() - lastFlush > FLUSH_INTERVAL_MS) flush(false)
  }
  flush(true)
}
