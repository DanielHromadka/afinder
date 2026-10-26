// Runs in an Electron utilityProcess: the Tools area's long jobs, off the main process.
//
// Parent → worker: { type: 'hash', id, path } | { type: 'dupes', id, dir } | { type: 'tree', id, dir }
//                  | { type: 'cancel', id }
// Worker → parent: { id, progress: ToolsProgress } | { id, result } | { id, error }

import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import type { DiskNode, DuplicateGroup, FileHashes, ToolsProgress } from '@shared/types'

const parentPort = process.parentPort
const cancelled = new Set<string>()
const PROGRESS_MS = 250
/** Children kept per folder in the disk map; the rest becomes one "other" box. */
const MAX_CHILDREN = 60
/** Levels of the disk map sent at once; zooming deeper scans again from there. */
const TREE_DEPTH = 3
const MAX_DUPLICATE_FILES = 500_000

class Cancelled extends Error {}

function progressor(id: string): (p: ToolsProgress) => void {
  let last = 0
  return (p) => {
    const now = Date.now()
    if (now - last < PROGRESS_MS) return
    last = now
    parentPort.postMessage({ id, progress: p })
  }
}

const check = (id: string): void => {
  if (cancelled.has(id)) throw new Cancelled()
}

async function hashFile(id: string, file: string): Promise<FileHashes> {
  const st = await fs.stat(file)
  if (!st.isFile()) throw new Error('Not a file')
  const algos = { md5: createHash('md5'), sha1: createHash('sha1'), sha256: createHash('sha256'), sha512: createHash('sha512') }
  const report = progressor(id)
  let done = 0
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    check(id)
    for (const h of Object.values(algos)) h.update(chunk as Buffer)
    done += (chunk as Buffer).length
    report({ done, total: st.size })
  }
  return { size: st.size, md5: algos.md5.digest('hex'), sha1: algos.sha1.digest('hex'), sha256: algos.sha256.digest('hex'), sha512: algos.sha512.digest('hex') }
}

/** Every regular file below dir (no symlinks followed), with its size. */
async function walkFiles(id: string, dir: string, onFile: (file: string, size: number) => void): Promise<void> {
  const stack = [dir]
  while (stack.length) {
    check(id)
    const current = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue // unreadable folder: skipped, like the size column does
    }
    for (const e of entries) {
      const full = path.join(current, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile()) {
        try {
          onFile(full, (await fs.lstat(full)).size)
        } catch {
          // vanished meanwhile
        }
      }
    }
  }
}

async function digest(file: string, algo: string, limit?: number): Promise<string> {
  const h = createHash(algo)
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024, ...(limit ? { end: limit - 1 } : {}) })) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** Same size, then the same first 64 KiB, then the same SHA-256: only real candidates are read fully. */
async function duplicates(id: string, dir: string): Promise<DuplicateGroup[]> {
  const report = progressor(id)
  const bySize = new Map<number, string[]>()
  let files = 0
  await walkFiles(id, dir, (file, size) => {
    if (++files > MAX_DUPLICATE_FILES) throw new Error('Too many files')
    if (size === 0) return
    const list = bySize.get(size)
    if (list) list.push(file)
    else bySize.set(size, [file])
    report({ done: files, total: 0, phase: 'scan' })
  })
  const candidates = [...bySize].filter(([, list]) => list.length > 1)
  const total = candidates.reduce((a, [size, list]) => a + size * list.length, 0)
  let done = 0
  const groups: DuplicateGroup[] = []
  const split = async (list: string[], key: (f: string) => Promise<string>): Promise<string[][]> => {
    const by = new Map<string, string[]>()
    for (const f of list) {
      check(id)
      const k = await key(f).catch(() => null)
      if (k === null) continue
      by.set(k, [...(by.get(k) ?? []), f])
    }
    return [...by.values()].filter((g) => g.length > 1)
  }
  for (const [size, list] of candidates) {
    for (const head of await split(list, (f) => digest(f, 'sha1', 64 * 1024))) {
      const full = size <= 64 * 1024 ? [head] : await split(head, (f) => digest(f, 'sha256'))
      for (const paths of full) groups.push({ size, paths: paths.sort() })
    }
    done += size * list.length
    report({ done, total, phase: 'compare' })
  }
  // Most space to win first.
  return groups.sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1))
}

/** Folder sizes as a tree, TREE_DEPTH levels deep, each folder's children biggest first. */
async function diskTree(id: string, dir: string): Promise<DiskNode> {
  const report = progressor(id)
  let files = 0
  let bytes = 0
  const visit = async (p: string, depth: number): Promise<DiskNode> => {
    check(id)
    const node: DiskNode = { name: path.basename(p) || p, path: p, size: 0, dir: true, files: 0 }
    let entries
    try {
      entries = await fs.readdir(p, { withFileTypes: true })
    } catch {
      return node
    }
    const children: DiskNode[] = []
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) {
        const child = await visit(full, depth + 1)
        node.size += child.size
        node.files! += child.files!
        children.push(child)
      } else if (e.isFile()) {
        let size = 0
        try {
          size = (await fs.lstat(full)).size
        } catch {
          continue
        }
        node.size += size
        node.files! += 1
        files++
        bytes += size
        children.push({ name: e.name, path: full, size, dir: false })
      }
    }
    report({ done: files, total: 0, bytes })
    if (depth < TREE_DEPTH) {
      children.sort((a, b) => b.size - a.size)
      const kept = children.slice(0, MAX_CHILDREN).map((c) => (depth + 1 < TREE_DEPTH ? c : { ...c, children: undefined }))
      const rest = children.slice(MAX_CHILDREN)
      if (rest.length) kept.push({ name: '', path: '', size: rest.reduce((a, c) => a + c.size, 0), dir: false, other: rest.length })
      node.children = kept
    }
    return node
  }
  return visit(dir, 0)
}

parentPort.on('message', (e) => {
  const msg = e.data as { type: string; id: string; path?: string; dir?: string }
  if (msg.type === 'cancel') return void cancelled.add(msg.id)
  const job = msg.type === 'hash' ? hashFile(msg.id, msg.path!) : msg.type === 'dupes' ? duplicates(msg.id, msg.dir!) : msg.type === 'tree' ? diskTree(msg.id, msg.dir!) : null
  if (!job) return
  job.then(
    (result) => parentPort.postMessage({ id: msg.id, result }),
    (err: unknown) => parentPort.postMessage({ id: msg.id, error: err instanceof Cancelled ? 'cancelled' : err instanceof Error ? err.message : String(err) })
  ).finally(() => cancelled.delete(msg.id))
})
