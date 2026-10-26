// Runs in an Electron utilityProcess. Computes recursive folder sizes off the main process.
//
// Protocol (parent → worker):  { type: 'want', paths: string[] }
//   Replaces the set of folders the UI currently needs. Running jobs that are no longer wanted
//   are aborted, new ones are queued. At most MAX_JOBS folders are walked at once.
// Worker → parent: SizeUpdate { path, size, state: 'partial' | 'done' | 'denied' }

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SizeUpdate } from '@shared/types'

const MAX_JOBS = 4
const MAX_STATS_PER_JOB = 32
const PARTIAL_INTERVAL_MS = 700

interface Job {
  path: string
  total: number
  aborted: boolean
}

const parentPort = process.parentPort
let queue: string[] = []
const running = new Map<string, Job>()

function post(update: SizeUpdate): void {
  parentPort.postMessage(update)
}

parentPort.on('message', (e) => {
  const msg = e.data as { type: 'want'; paths: string[] }
  if (msg?.type !== 'want' || !Array.isArray(msg.paths)) return
  const wanted = new Set(msg.paths)
  for (const [p, job] of running) {
    if (!wanted.has(p)) {
      job.aborted = true
      running.delete(p)
    }
  }
  queue = msg.paths.filter((p) => !running.has(p))
  pump()
})

function pump(): void {
  while (running.size < MAX_JOBS && queue.length > 0) {
    const p = queue.shift()!
    const job: Job = { path: p, total: 0, aborted: false }
    running.set(p, job)
    void runJob(job).finally(() => {
      if (running.get(p) === job) running.delete(p)
      pump()
    })
  }
}

async function runJob(job: Job): Promise<void> {
  try {
    await fs.access(job.path, fs.constants.R_OK | fs.constants.X_OK)
    await fs.readdir(job.path) // fail fast on permission problems of the root itself
  } catch {
    if (!job.aborted) post({ path: job.path, size: 0, state: 'denied' })
    return
  }

  const timer = setInterval(() => {
    if (!job.aborted) post({ path: job.path, size: job.total, state: 'partial' })
  }, PARTIAL_INTERVAL_MS)

  try {
    await walk(job)
  } finally {
    clearInterval(timer)
  }
  if (!job.aborted) post({ path: job.path, size: job.total, state: 'done' })
}

/** Iterative walk; symlinks are never followed, unreadable subfolders are skipped. */
async function walk(job: Job): Promise<void> {
  const stack: string[] = [job.path]
  while (stack.length > 0) {
    if (job.aborted) return
    const dir = stack.pop()!
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const files: string[] = []
    for (const d of dirents) {
      const full = path.join(dir, d.name)
      if (d.isDirectory()) stack.push(full)
      else if (d.isFile()) files.push(full)
      // symlinks, sockets, fifos… are ignored
    }
    for (let i = 0; i < files.length; i += MAX_STATS_PER_JOB) {
      if (job.aborted) return
      const sizes = await Promise.all(
        files.slice(i, i + MAX_STATS_PER_JOB).map((f) => fs.lstat(f).then((s) => s.size, () => 0))
      )
      for (const s of sizes) job.total += s
    }
  }
}
