import { type FSWatcher, watch } from 'node:fs'
import path from 'node:path'
import { type UtilityProcess, type WebContents, utilityProcess } from 'electron'
import workerPath from '../../workers/sizeWorker?modulePath'
import { IPC, type SizeUpdate } from '@shared/types'

interface CacheEntry {
  size: number
  state: 'done' | 'denied'
  computedAt: number
  stale: boolean
}

/** A stale size is shown as-is and only recomputed when it is older than this. */
const RECOMPUTE_STALE_AFTER_MS = 30_000
const FLUSH_INTERVAL_MS = 120
const CHANGE_DEBOUNCE_MS = 400
/** An idle worker is a whole Node process (~50–100 MB): it exits after this and restarts on demand. */
const WORKER_IDLE_MS = 30_000

interface DirWatch {
  watcher: FSWatcher | null
  timer: NodeJS.Timeout | null
}

/**
 * Owns the size worker, the size cache and the watchers of the folders currently shown.
 * One instance per window; a window shows several views (visible tabs), each with one folder.
 */
export class SizeService {
  private worker: UtilityProcess | null = null
  private cache = new Map<string, CacheEntry>()
  /** Per view: the folder shown and the subfolders whose sizes it still waits for. */
  private views = new Map<string, { dir: string; toCompute: string[] }>()
  private wanted: string[] = []
  private pending: SizeUpdate[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private watches = new Map<string, DirWatch>()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly target: WebContents) {}

  /** Called when a view shows a folder: answers from cache and computes the rest. */
  watch(viewId: string, dir: string, subdirs: string[]): void {
    const now = Date.now()
    const toCompute: string[] = []
    for (const p of subdirs) {
      const hit = this.cache.get(p)
      if (hit) this.emit({ path: p, size: hit.size, state: hit.state })
      if (!hit || (hit.stale && now - hit.computedAt > RECOMPUTE_STALE_AFTER_MS)) toCompute.push(p)
    }
    this.views.set(viewId, { dir, toCompute })
    this.update()
  }

  unwatch(viewId: string): void {
    if (this.views.delete(viewId)) this.update()
  }

  dispose(): void {
    for (const w of this.watches.values()) this.closeWatch(w)
    this.worker?.kill()
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
  }

  /** Syncs folder watchers and the worker's job list with the views. */
  private update(): void {
    const dirs = new Set([...this.views.values()].map((v) => v.dir))
    for (const [dir, w] of this.watches) {
      if (dirs.has(dir)) continue
      this.closeWatch(w)
      this.watches.delete(dir)
    }
    for (const dir of dirs) if (!this.watches.has(dir)) this.watches.set(dir, this.openWatch(dir))

    const wanted = new Set<string>()
    for (const v of this.views.values()) for (const p of v.toCompute) if (!this.cache.get(p) || this.cache.get(p)!.stale) wanted.add(p)
    this.wanted = [...wanted]
    if (this.wanted.length || this.worker) this.ensureWorker().postMessage({ type: 'want', paths: this.wanted })
    this.scheduleIdle()
  }

  /** Stops the worker once every wanted size is known; the next update() starts a new one. */
  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (!this.worker || this.wanted.some((p) => this.cache.get(p)?.stale !== false)) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      const worker = this.worker
      this.worker = null
      worker?.kill()
    }, WORKER_IDLE_MS)
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker
    const worker = utilityProcess.fork(workerPath, [], { serviceName: 'aFinder size worker' })
    worker.on('message', (update: SizeUpdate) => {
      if (update.state !== 'partial') {
        this.cache.set(update.path, { size: update.size, state: update.state, computedAt: Date.now(), stale: false })
        this.scheduleIdle()
      }
      this.emit(update)
    })
    worker.on('exit', () => {
      // Crashed or killed: restart lazily and resume what the UI still wants.
      if (this.worker !== worker) return
      this.worker = null
      if (!this.target.isDestroyed() && this.wanted.length) {
        this.ensureWorker().postMessage({ type: 'want', paths: this.wanted })
      }
    })
    this.worker = worker
    return worker
  }

  private emit(update: SizeUpdate): void {
    this.pending.push(update)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS)
  }

  private flush(): void {
    this.flushTimer = null
    if (this.target.isDestroyed() || this.pending.length === 0) return
    this.target.send(IPC.sizes, this.pending)
    this.pending = []
  }

  private openWatch(dir: string): DirWatch {
    const w: DirWatch = { watcher: null, timer: null }
    const changed = new Set<string>()
    try {
      // FSEvents-backed recursive watch: catches changes deep inside subfolders, so sizes stay correct.
      w.watcher = watch(dir, { recursive: true, persistent: false }, (_event, filename) => {
        changed.add(filename ? path.join(dir, filename.toString()) : dir)
        if (w.timer) clearTimeout(w.timer)
        w.timer = setTimeout(() => {
          this.invalidate([...changed])
          changed.clear()
          if (!this.target.isDestroyed()) this.target.send(IPC.dirChanged, dir)
        }, CHANGE_DEBOUNCE_MS)
      })
      w.watcher.on('error', () => w.watcher?.close())
    } catch {
      // Unwatchable folder (permissions, network volume) – sizes just won't auto-refresh.
    }
    return w
  }

  private closeWatch(w: DirWatch): void {
    w.watcher?.close()
    if (w.timer) clearTimeout(w.timer)
  }

  /** Marks every cached folder that contains one of the changed paths as stale. */
  private invalidate(changedPaths: string[]): void {
    for (const [p, entry] of this.cache) {
      const prefix = p.endsWith(path.sep) ? p : p + path.sep
      if (changedPaths.some((c) => c.startsWith(prefix))) entry.stale = true
    }
  }
}
