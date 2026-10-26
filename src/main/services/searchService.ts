import { type UtilityProcess, type WebContents, utilityProcess } from 'electron'
import workerPath from '../../workers/searchWorker?modulePath'
import { IPC, type FileEntry, type SearchRequest } from '@shared/types'

/** An idle worker is a whole Node process: it exits after this and restarts with the next search. */
const WORKER_IDLE_MS = 30_000

interface SearchResult {
  entries: FileEntry[]
  /** There are more matches than were returned. */
  truncated: boolean
}

interface WorkerMessage {
  key: string
  entries: FileEntry[]
  done: boolean
  truncated: boolean
}

/**
 * Owns the search worker (one for the whole app) and routes results back to the window that
 * asked. Search ids come from the renderer, so they are namespaced by the sender.
 */
export class SearchService {
  private worker: UtilityProcess | null = null
  private targets = new Map<string, { sender: WebContents; id: string }>()
  /** Searches without a window (the MCP server): results are collected and handed back at the end. */
  private collectors = new Map<string, { entries: FileEntry[]; limit: number; resolve(r: SearchResult): void }>()
  private seq = 0
  private idleTimer: NodeJS.Timeout | null = null

  run(request: SearchRequest, limit: number): Promise<SearchResult> {
    const key = `run:${++this.seq}`
    return new Promise((resolve) => {
      this.collectors.set(key, { entries: [], limit, resolve })
      this.ensureWorker().postMessage({ type: 'start', key, request })
    })
  }

  start(sender: WebContents, id: string, request: SearchRequest): void {
    const key = `${sender.id}:${id}`
    this.targets.set(key, { sender, id })
    this.ensureWorker().postMessage({ type: 'start', key, request })
  }

  cancel(sender: WebContents, id: string): void {
    const key = `${sender.id}:${id}`
    if (!this.targets.delete(key)) return
    this.worker?.postMessage({ type: 'cancel', key })
    this.scheduleIdle()
  }

  /** A window was closed – drop its searches. */
  forget(senderId: number): void {
    for (const [key, t] of this.targets) {
      if (t.sender.id !== senderId) continue
      this.targets.delete(key)
      this.worker?.postMessage({ type: 'cancel', key })
    }
    this.scheduleIdle()
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.worker?.kill()
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (!this.worker || this.targets.size || this.collectors.size) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      const worker = this.worker
      this.worker = null
      worker?.kill()
    }, WORKER_IDLE_MS)
  }

  private ensureWorker(): UtilityProcess {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.worker) return this.worker
    const worker = utilityProcess.fork(workerPath, [], { serviceName: 'aFinder search worker' })
    worker.on('message', (msg: WorkerMessage) => {
      const collector = this.collectors.get(msg.key)
      if (collector) {
        collector.entries.push(...msg.entries)
        const full = collector.entries.length >= collector.limit
        if (full && !msg.done) worker.postMessage({ type: 'cancel', key: msg.key })
        if (full || msg.done) {
          this.collectors.delete(msg.key)
          collector.resolve({ entries: collector.entries.slice(0, collector.limit), truncated: collector.entries.length > collector.limit || msg.truncated || !msg.done })
          this.scheduleIdle()
        }
        return
      }
      const target = this.targets.get(msg.key)
      if (!target) return
      if (msg.done) {
        this.targets.delete(msg.key)
        this.scheduleIdle()
      }
      if (target.sender.isDestroyed()) return
      target.sender.send(IPC.searchResults, { id: target.id, entries: msg.entries, done: msg.done, truncated: msg.truncated })
    })
    worker.on('exit', () => {
      if (this.worker !== worker) return
      this.worker = null
      for (const [key, c] of this.collectors) {
        this.collectors.delete(key)
        c.resolve({ entries: c.entries, truncated: true })
      }
      // Searches in flight are lost; tell their windows so they stop showing "searching…".
      for (const [key, t] of this.targets) {
        if (!t.sender.isDestroyed()) t.sender.send(IPC.searchResults, { id: t.id, entries: [], done: true, truncated: false })
        this.targets.delete(key)
      }
    })
    this.worker = worker
    return worker
  }
}
