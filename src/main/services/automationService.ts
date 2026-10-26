import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeJsonFile } from './jsonStore'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Script } from 'node:vm'
import { nextAutomationRun, validateAutomationDraft, type Automation, type AutomationRun } from '@shared/automation'

export type ScriptExecutor = (file: string, signal: AbortSignal, output: (text: string) => void) => Promise<void>
const HISTORY_LIMIT = 20
const LOG_LIMIT = 24000

export class AutomationService {
  private items: Automation[] = []
  private active = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  private timer: ReturnType<typeof setInterval> | null = null
  private notification: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private storageError: unknown = null
  private readonly file: string

  constructor(
    private readonly directory: string,
    private readonly execute: ScriptExecutor,
    private readonly changed: () => void = () => {},
    private readonly activity: { started?(item: Automation, run: AutomationRun): void; finished?(item: Automation, run: AutomationRun): void } = {}
  ) {
    this.file = path.join(directory, 'automations.json')
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      if (!existsSync(this.file)) return
      const raw = readFileSync(this.file, 'utf8')
      if (raw.length > 32_000_000) throw new Error('Automation storage is too large')
      const data: unknown = JSON.parse(raw)
      if (!Array.isArray(data) || data.length > 100) throw new Error('Invalid automation storage')
      this.items = data.map((item: Automation) => {
        const draft = validateAutomationDraft(item)
        if (!item || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || !Array.isArray(item.runs)) throw new Error('Invalid saved automation')
        const runs = item.runs.slice(0, HISTORY_LIMIT).map((r): AutomationRun => {
          if (
            !r ||
            typeof r.id !== 'string' ||
            !Number.isFinite(r.startedAt) ||
            typeof r.log !== 'string' ||
            !['running', 'verifying', 'success', 'failed', 'cancelled', 'interrupted'].includes(r.status)
          )
            throw new Error('Invalid run history')
          return r.status === 'running' || r.status === 'verifying'
            ? { ...r, status: 'interrupted', finishedAt: Date.now(), error: 'Application stopped before the run finished', log: r.log.slice(-LOG_LIMIT) }
            : { ...r, log: r.log.slice(-LOG_LIMIT) }
        })
        return {
          ...draft,
          id: item.id,
          enabled: item.enabled === true,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          nextRunAt: Number.isFinite(item.nextRunAt) ? item.nextRunAt : null,
          runs
        }
      })
      if (new Set(this.items.map((i) => i.id)).size !== this.items.length) throw new Error('Duplicate automation IDs')
      this.persist()
    } catch (error) {
      this.storageError = error
    }
  }

  private ready(): void {
    if (this.storageError) throw new Error(`Cannot load automations: ${String(this.storageError)}`)
    if (this.disposed) throw new Error('Automation service is shutting down')
  }
  private find(id: unknown): Automation {
    this.ready()
    const item = this.items.find((i) => i.id === id)
    if (!item) throw new Error('Automation not found')
    return item
  }
  private persist(): void {
    writeJsonFile(this.file, this.items)
  }
  private notify(): void {
    if (!this.notification && !this.disposed)
      this.notification = setTimeout(() => {
        this.notification = null
        this.changed()
      }, 200)
  }
  list(): Automation[] {
    this.ready()
    return structuredClone(this.items)
  }

  /** Saving code always pauses the schedule so an edit never executes unseen. */
  save(id: unknown, input: unknown): string {
    this.ready()
    const draft = validateAutomationDraft(input)
    new Script(`(function(require,module,exports,__filename,__dirname){\n${draft.script}\n})`)
    new Script(`(function(require,module,exports,__filename,__dirname){\n${draft.verificationScript}\n})`)
    const existing = id === null ? null : this.find(id)
    if (existing && this.active.has(existing.id)) throw new Error('Stop the running automation before editing it')
    if (!existing && this.items.length >= 100) throw new Error('Maximum of 100 automations reached')
    const now = Date.now()
    const item: Automation = {
      ...draft,
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      enabled: false,
      nextRunAt: null,
      runs: existing?.runs ?? []
    }
    const previous = this.items
    this.items = existing ? this.items.map((i) => (i.id === item.id ? item : i)) : [...this.items, item]
    try {
      this.persist()
    } catch (error) {
      this.items = previous
      throw error
    }
    this.notify()
    return item.id
  }
  enable(id: unknown, enabled: unknown): void {
    const item = this.find(id)
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled flag')
    const old = { enabled: item.enabled, nextRunAt: item.nextRunAt }
    item.enabled = enabled
    item.nextRunAt = enabled ? nextAutomationRun(item.trigger, Date.now()) : null
    try {
      this.persist()
    } catch (error) {
      Object.assign(item, old)
      throw error
    }
    this.notify()
  }
  remove(id: unknown): void {
    const item = this.find(id)
    if (this.active.has(item.id)) throw new Error('Stop the automation before deleting it')
    const previous = this.items
    this.items = this.items.filter((i) => i.id !== item.id)
    try {
      this.persist()
    } catch (error) {
      this.items = previous
      throw error
    }
    this.notify()
  }
  cancel(id: unknown): void {
    const item = this.find(id)
    this.active.get(item.id)?.controller.abort(new Error('Cancelled by user'))
  }
  run(id: unknown, reason: AutomationRun['reason'] = 'manual'): void {
    const item = this.find(id)
    if (this.active.has(item.id)) throw new Error('This automation is already running')
    const run: AutomationRun = { id: randomUUID(), startedAt: Date.now(), finishedAt: null, reason, status: 'running', log: '', error: null }
    const previous = item.runs
    const next = item.nextRunAt
    item.runs = [run, ...item.runs].slice(0, HISTORY_LIMIT)
    if (reason === 'schedule') item.nextRunAt = nextAutomationRun(item.trigger, Date.now())
    try {
      this.persist()
    } catch (error) {
      item.runs = previous
      item.nextRunAt = next
      throw error
    }
    const controller = new AbortController()
    // Deferring execution keeps the active guard in place before the first await or output.
    const promise = Promise.resolve().then(() => this.perform(item, run, controller))
    this.active.set(item.id, { controller, promise })
    try {
      this.activity.started?.(item, run)
    } catch {
      /* optional history cannot affect execution */
    }
    this.notify()
  }
  private async perform(item: Automation, run: AutomationRun, controller: AbortController): Promise<void> {
    let directory: string | undefined
    const timeout = setTimeout(() => controller.abort(new Error(`Run exceeded ${item.timeoutSeconds} seconds`)), item.timeoutSeconds * 1000)
    const output = (text: string): void => {
      run.log = (run.log + text).slice(-LOG_LIMIT)
      this.notify()
    }
    try {
      controller.signal.throwIfAborted()
      directory = await mkdtemp(path.join(this.directory, 'run-'))
      const workflow = path.join(directory, 'workflow.cjs')
      const verify = path.join(directory, 'verify.cjs')
      await writeFile(workflow, item.script, { mode: 0o600 })
      await writeFile(verify, item.verificationScript, { mode: 0o600 })
      output('— WORKFLOW —\n')
      await this.execute(workflow, controller.signal, output)
      controller.signal.throwIfAborted()
      run.status = 'verifying'
      this.persist()
      output('\n— VERIFICATION —\n')
      await this.execute(verify, controller.signal, output)
      controller.signal.throwIfAborted()
      run.status = 'success'
    } catch (error) {
      run.status = controller.signal.aborted && controller.signal.reason?.message === 'Cancelled by user' ? 'cancelled' : 'failed'
      run.error = error instanceof Error ? error.message : String(error)
      output(`\n${run.error}\n`)
    } finally {
      clearTimeout(timeout)
      run.finishedAt = Date.now()
      // Do not immediately replay intervals that elapsed while this job was still running.
      if (item.enabled && item.nextRunAt !== null && item.nextRunAt <= run.finishedAt) item.nextRunAt = nextAutomationRun(item.trigger, run.finishedAt)
      this.active.delete(item.id)
      try {
        this.persist()
      } catch (error) {
        run.status = 'failed'
        run.error = `Cannot save run history: ${String(error)}`
      }
      try {
        this.activity.finished?.(item, run)
      } catch {
        /* optional history cannot affect execution */
      }
      this.notify()
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }
  start(): void {
    if (this.storageError || this.timer || this.disposed) return
    for (const item of this.items) {
      if (!item.enabled) continue
      if (item.trigger.kind === 'startup') {
        try {
          this.run(item.id, 'startup')
        } catch (error) {
          console.error('Automation startup:', error)
        }
      } else if (item.nextRunAt === null) item.nextRunAt = nextAutomationRun(item.trigger, Date.now())
    }
    this.tick()
    this.timer = setInterval(() => this.tick(), 1000)
  }
  /** Public for deterministic scheduler tests; no automatic retries on failure. */
  tick(now = Date.now()): void {
    if (this.disposed || this.storageError) return
    for (const item of this.items) {
      if (item.enabled && item.nextRunAt !== null && item.nextRunAt <= now && !this.active.has(item.id)) {
        try {
          this.run(item.id, 'schedule')
        } catch (error) {
          console.error('Automation schedule:', error)
        }
      }
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    if (this.notification) clearTimeout(this.notification)
    for (const { controller } of this.active.values()) controller.abort(new Error('Application is shutting down'))
    await Promise.allSettled([...this.active.values()].map((v) => v.promise))
  }
}
