import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_RETENTION,
  type ActivityEvent,
  type ActivityOptions,
  type ActivityPage,
  type ActivityQuery,
  type ActivityStatus
} from '@shared/activity'
import { isInside } from '@shared/paths'
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, normalizeEmbedding, type EmbeddingProvider } from './activityEmbeddings'

export interface ActivityInput {
  action: ActivityEvent['action']
  folder?: string | null
  paths?: string[]
  destinations?: string[]
  count?: number
  label?: string
  note?: string
  outcome?: ActivityEvent['outcome']
  errorCode?: string | null
}
export interface ActivityToken {
  epoch: number
  at: number
}
const MAX_EVENTS = 10000
const OUTCOMES = ['success', 'failed', 'cancelled', 'started']
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\0/g, '').slice(0, max) : '')
const cleanPaths = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((p): p is string => typeof p === 'string' && path.isAbsolute(p) && !p.includes('\0'))
        .slice(0, 20)
        .map((p) => path.resolve(p).slice(0, 2048))
    : []
const body = (event: ActivityEvent): string =>
  [event.action, event.outcome, event.label, event.folder, ...event.paths, ...event.destinations, event.note].filter(Boolean).join('\n')

export class ActivityService {
  private db: DatabaseSync | null = null
  private options: ActivityOptions
  private epoch = 0
  private session = randomUUID()
  private visits = new Map<number, { folder: string; at: number }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private notifications: ReturnType<typeof setTimeout> | null = null
  private controllers = new Set<AbortController>()
  private indexing = false
  private error: string | null = null
  private modelKey = ''
  private disposed = false
  private downloading = false
  private downloadProgress = 0
  private indexJob: Promise<void> | null = null

  constructor(
    private readonly file: string,
    options: ActivityOptions,
    private readonly changed: () => void,
    private readonly provider: EmbeddingProvider
  ) {
    this.options = { ...options }
    // No database and no requests are created while both options are off.
    if (options.activityEnabled && options.semanticEnabled) this.schedule()
  }
  private database(create = false): DatabaseSync | null {
    if (this.disposed) throw new Error('Activity service is shutting down')
    if (this.db) return this.db
    if (!create && !existsSync(this.file)) return null
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(this.file)
    try {
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
        CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_at ON events(at);
        CREATE VIRTUAL TABLE IF NOT EXISTS event_search USING fts5(event_id UNINDEXED, body, tokenize='unicode61 remove_diacritics 2');
        CREATE TABLE IF NOT EXISTS vectors (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, model TEXT NOT NULL, vector BLOB NOT NULL);`)
      if (process.platform !== 'win32') chmodSync(this.file, 0o600)
      this.db = db
      this.prune()
      return db
    } catch (error) {
      this.db = null
      db.close()
      throw error
    }
  }
  private transaction(fn: (db: DatabaseSync) => void): void {
    const db = this.database(true)!
    db.exec('BEGIN IMMEDIATE')
    try {
      fn(db)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  private prune(): void {
    if (!this.db) return
    this.db.prepare('DELETE FROM events WHERE at < ?').run(Date.now() - this.options.activityRetentionDays * 86400000)
    this.db.exec(`DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ${MAX_EVENTS});
      DELETE FROM event_search WHERE event_id NOT IN (SELECT id FROM events);`)
  }
  private notify(): void {
    if (!this.notifications && !this.disposed)
      this.notifications = setTimeout(() => {
        this.notifications = null
        this.changed()
      }, 150)
  }
  begin(): ActivityToken | null {
    return this.options.activityEnabled && !this.disposed ? { epoch: this.epoch, at: Date.now() } : null
  }
  record(input: ActivityInput, token = this.begin()): boolean {
    if (!token || token.epoch !== this.epoch || !this.options.activityEnabled || this.disposed) return false
    try {
      if (!ACTIVITY_ACTIONS.includes(input.action)) throw new Error('Invalid activity action')
      const event: ActivityEvent = {
        id: randomUUID(),
        at: token.at,
        session: this.session,
        action: input.action,
        outcome: OUTCOMES.includes(input.outcome ?? '') ? input.outcome! : 'success',
        folder: cleanPaths(input.folder ? [input.folder] : [])[0] ?? null,
        paths: cleanPaths(input.paths),
        destinations: cleanPaths(input.destinations),
        count: Number.isInteger(input.count) && input.count! >= 0 ? Math.min(input.count!, 1000000) : (input.paths?.length ?? 0),
        label: text(input.label, 300),
        note: input.action === 'note' ? text(input.note, 8000) : '',
        errorCode: typeof input.errorCode === 'string' && /^[A-Z0-9_]{1,40}$/.test(input.errorCode) ? input.errorCode : null,
        durationMs: Math.max(0, Date.now() - token.at)
      }
      this.transaction((db) => {
        db.prepare('INSERT INTO events VALUES (?,?,?,?,?)').run(event.id, event.at, event.action, event.outcome, JSON.stringify(event))
        db.prepare('INSERT INTO event_search VALUES (?,?)').run(event.id, body(event))
        this.prune()
      })
      this.notify()
      this.schedule()
      return true
    } catch (error) {
      this.error = `Cannot save activity: ${error instanceof Error ? error.message : String(error)}`
      this.notify()
      return false
    }
  }
  /** Logging failures must never turn a successful file operation into an error. */
  async track<T>(input: ActivityInput, work: () => T | Promise<T>, result?: (value: T) => Partial<ActivityInput>): Promise<T> {
    const token = this.begin()
    try {
      const value = await work()
      if (token) {
        try {
          this.record({ ...input, ...result?.(value) }, token)
        } catch {
          /* metadata failure must not affect the operation */
        }
      }
      return value
    } catch (error) {
      this.record({ ...input, outcome: 'failed', errorCode: (error as NodeJS.ErrnoException)?.code }, token)
      throw error
    }
  }
  visit(folder: string, windowId: number): void {
    if (!this.options.activityEnabled) return
    const previous = this.visits.get(windowId)
    if (previous?.folder === folder && Date.now() - previous.at < 60000) return
    this.visits.set(windowId, { folder, at: Date.now() })
    this.record({ action: 'visit', folder })
  }
  forgetWindow(id: number): void {
    this.visits.delete(id)
  }
  note(folder: string, label: unknown, note: unknown): void {
    if (!this.options.activityEnabled) throw new Error('Enable activity history in Settings first')
    if (typeof note !== 'string' || !note.trim() || note.length > 8000 || typeof label !== 'string' || label.length > 300)
      throw new Error('Invalid fragment (maximum 8000 characters)')
    if (!this.record({ action: 'note', folder, label, note })) throw new Error(this.error ?? 'Cannot save fragment')
  }
  configure(options: ActivityOptions): void {
    if (!ACTIVITY_RETENTION.includes(options.activityRetentionDays as 7 | 30 | 90 | 365)) throw new Error('Invalid history retention')
    if (options.activityEnabled !== this.options.activityEnabled || options.semanticEnabled !== this.options.semanticEnabled) {
      this.epoch++
      this.visits.clear()
      this.cancelRequests()
    }
    this.options = { ...options }
    this.prune()
    this.notify()
    this.schedule()
  }
  private cancelRequests(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const controller of this.controllers) controller.abort(new Error('Indexing stopped'))
    this.provider.stop?.()
  }
  private rows(query: ActivityQuery, includeText: boolean): ActivityEvent[] {
    const db = this.database()
    if (!db) return []
    this.prune()
    const clauses: string[] = [],
      args: SQLInputValue[] = []
    if (query.action) {
      if (!ACTIVITY_ACTIONS.includes(query.action)) throw new Error('Invalid action filter')
      clauses.push('e.action = ?')
      args.push(query.action)
    }
    if (query.outcome) {
      if (!OUTCOMES.includes(query.outcome)) throw new Error('Invalid outcome filter')
      clauses.push('e.outcome = ?')
      args.push(query.outcome)
    }
    for (const [key, operator] of [
      ['from', '>='],
      ['to', '<']
    ] as const) {
      if (query[key] !== undefined) {
        if (!Number.isFinite(query[key])) throw new Error('Invalid time filter')
        clauses.push(`e.at ${operator} ?`)
        args.push(query[key]!)
      }
    }
    const words =
      typeof query.text === 'string'
        ? (query.text
            .slice(0, 500)
            .match(/[\p{L}\p{N}_]+/gu)
            ?.slice(0, 30) ?? [])
        : []
    if (includeText && words.length) {
      clauses.push('e.id IN (SELECT event_id FROM event_search WHERE event_search MATCH ?)')
      args.push(words.map((w) => `"${w}"*`).join(' AND '))
    }
    const raw = db
      .prepare(`SELECT e.payload FROM events e ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY e.at DESC, e.rowid DESC`)
      .all(...args)
    const events = raw.map((r) => JSON.parse(String(r.payload)) as ActivityEvent)
    const folder = text(query.folder, 2048).trim()
    return folder ? events.filter((e) => [e.folder, ...e.paths, ...e.destinations].some((p) => p && isInside(p, folder))) : events
  }
  private validateQuery(input: unknown): ActivityQuery {
    if (!input || typeof input !== 'object') return {}
    const q = input as ActivityQuery
    if (q.mode && q.mode !== 'text' && q.mode !== 'semantic') throw new Error('Invalid search mode')
    return {
      ...q,
      text: text(q.text, 500),
      offset: Math.max(0, Math.min(MAX_EVENTS, Number.isInteger(q.offset) ? q.offset! : 0)),
      limit: Math.max(1, Math.min(200, Number.isInteger(q.limit) ? q.limit! : 100))
    }
  }
  async query(input: unknown): Promise<ActivityPage> {
    const query = this.validateQuery(input)
    const lexical = this.rows(query, true)
    if (query.mode !== 'semantic' || !query.text?.trim())
      return { events: lexical.slice(query.offset, query.offset! + query.limit!), total: lexical.length, partial: false }
    if (!this.options.activityEnabled || !this.options.semanticEnabled) throw new Error('Enable local semantic search in Settings first')
    const epoch = this.epoch,
      controller = new AbortController()
    this.controllers.add(controller)
    try {
      const key = await this.identity(controller.signal)
      const [vector] = await this.provider.embed([query.text], true, controller.signal)
      if (epoch !== this.epoch || controller.signal.aborted) throw new Error('Search stopped')
      const normalized = normalizeEmbedding(vector)
      const candidates = this.rows(query, false)
      const db = this.database()
      const cache = new Map(
        db
          ?.prepare('SELECT event_id, vector FROM vectors WHERE model = ?')
          .all(key)
          .map((r) => [String(r.event_id), r.vector as Uint8Array]) ?? []
      )
      const scored = candidates
        .flatMap((event) => {
          const bytes = cache.get(event.id)
          if (!bytes || bytes.byteLength !== EMBEDDING_DIMENSIONS * 4) return []
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          let score = 0
          for (let i = 0; i < normalized.length; i++) score += normalized[i] * view.getFloat32(i * 4, true)
          return score > 0 ? [{ event, score }] : []
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 100)
      // Reciprocal rank fusion retains exact filename matches alongside semantic matches.
      const fused = new Map<string, { event: ActivityEvent; score: number }>()
      for (const list of [scored.map((s) => s.event), lexical.slice(0, 100)])
        list.forEach((event, i) => fused.set(event.id, { event, score: (fused.get(event.id)?.score ?? 0) + 1 / (60 + i + 1) }))
      const all = [...fused.values()].sort((a, b) => b.score - a.score).map((r) => r.event)
      return { events: all.slice(query.offset, query.offset! + query.limit!), total: all.length, partial: this.status().pending > 0 }
    } finally {
      this.controllers.delete(controller)
    }
  }
  export(input: unknown): string {
    const query = this.validateQuery(input)
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), events: this.rows(query, true) }, null, 2)
  }
  status(): ActivityStatus {
    const db = this.database()
    const total = Number(db?.prepare('SELECT count(*) AS n FROM events').get()?.n ?? 0)
    const indexed = Number(db?.prepare('SELECT count(*) AS n FROM vectors WHERE model = ?').get(this.modelKey)?.n ?? 0)
    return {
      enabled: this.options.activityEnabled,
      semanticEnabled: this.options.semanticEnabled,
      total,
      indexed,
      pending: total - indexed,
      indexing: this.indexing,
      modelReady: this.provider.ready?.() ?? true,
      downloading: this.downloading,
      downloadProgress: this.downloadProgress,
      error: this.error,
      model: EMBEDDING_MODEL
    }
  }
  async check(): Promise<ActivityStatus> {
    if (!this.options.activityEnabled || !this.options.semanticEnabled) throw new Error('Enable history and semantic search first')
    const controller = new AbortController()
    this.controllers.add(controller)
    try {
      await this.identity(controller.signal)
      await this.provider.embed(['aFinder connection check'], true, controller.signal)
      this.error = null
      this.schedule()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.controllers.delete(controller)
      this.notify()
    }
    return this.status()
  }
  async download(): Promise<ActivityStatus> {
    if (!this.options.activityEnabled || !this.options.semanticEnabled) throw new Error('Enable history and semantic search first')
    if (!this.provider.download) throw new Error('Model download is not supported')
    if (this.downloading) throw new Error('Model download is already running')
    this.epoch++
    this.cancelRequests()
    const controller = new AbortController()
    this.controllers.add(controller)
    this.downloading = true
    this.downloadProgress = 0
    this.error = null
    this.notify()
    try {
      await this.provider.download(controller.signal, (value) => {
        this.downloadProgress = value
        this.notify()
      })
      if (!controller.signal.aborted) this.schedule()
    } catch (error) {
      if (!controller.signal.aborted) this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.controllers.delete(controller)
      this.downloading = false
      this.notify()
      this.schedule()
    }
    return this.status()
  }
  private async identity(signal: AbortSignal): Promise<string> {
    const key = await this.provider.identity(signal)
    if (signal.aborted) throw signal.reason
    this.modelKey = key
    return key
  }
  private schedule(delay = 1000): void {
    if (
      this.disposed ||
      !this.options.activityEnabled ||
      !this.options.semanticEnabled ||
      this.timer ||
      this.indexing ||
      this.downloading ||
      this.provider.ready?.() === false
    )
      return
    this.timer = setTimeout(() => {
      this.timer = null
      this.indexJob = this.indexBatch()
    }, delay)
  }
  private async indexBatch(): Promise<void> {
    if (this.disposed || !this.options.activityEnabled || !this.options.semanticEnabled) return
    this.indexing = true
    this.notify()
    const controller = new AbortController(),
      epoch = this.epoch
    this.controllers.add(controller)
    let more = false,
      retry = false
    try {
      const key = await this.identity(controller.signal)
      const db = this.database()
      const batch =
        db
          ?.prepare(
            'SELECT e.id,e.payload FROM events e LEFT JOIN vectors v ON e.id = v.event_id AND v.model = ? WHERE v.event_id IS NULL ORDER BY e.at DESC LIMIT 8'
          )
          .all(key) ?? []
      if (!batch.length) return
      const vectors = await this.provider.embed(
        batch.map((r) => body(JSON.parse(String(r.payload)) as ActivityEvent).slice(0, 6000)),
        false,
        controller.signal
      )
      if (epoch !== this.epoch || controller.signal.aborted || key !== this.modelKey) return
      if (vectors.length !== batch.length) throw new Error('Invalid embedding count')
      this.transaction((database) =>
        batch.forEach((row, i) => {
          if (!database.prepare('SELECT 1 FROM events WHERE id = ?').get(row.id)) return
          const vector = normalizeEmbedding(vectors[i]),
            bytes = Buffer.alloc(vector.length * 4)
          vector.forEach((n, j) => bytes.writeFloatLE(n, j * 4))
          database
            .prepare('INSERT INTO vectors VALUES (?,?,?) ON CONFLICT(event_id) DO UPDATE SET model=excluded.model,vector=excluded.vector')
            .run(row.id, key, bytes)
        })
      )
      this.error = null
      more = this.status().pending > 0
    } catch (error) {
      if (!controller.signal.aborted) {
        this.error = error instanceof Error ? error.message : String(error)
        retry = true
      }
    } finally {
      this.controllers.delete(controller)
      this.indexing = false
      this.notify()
      if (more || retry) this.schedule(retry ? 60000 : 500)
      else if (epoch !== this.epoch) this.schedule()
    }
  }
  rebuild(): void {
    if (!this.options.activityEnabled || !this.options.semanticEnabled) throw new Error('Enable history and semantic search first')
    this.epoch++
    this.cancelRequests()
    this.database()?.exec('DELETE FROM vectors')
    this.error = null
    this.notify()
    this.schedule()
  }
  clear(): void {
    this.epoch++
    this.cancelRequests()
    this.visits.clear()
    this.db?.close()
    this.db = null
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${this.file}${suffix}`, { force: true })
    this.error = null
    this.notify()
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.epoch++
    this.cancelRequests()
    if (this.notifications) clearTimeout(this.notifications)
    await this.indexJob
    this.db?.close()
    this.db = null
  }
}
