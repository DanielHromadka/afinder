import path from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { LAYA_FILES, LAYA_ID, type DecisionInput, type DecisionOutput } from '@shared/fileAssistant'
export interface DecisionProvider {
  ready(): boolean
  download(signal: AbortSignal, progress: (value: number) => void): Promise<void>
  decide(input: DecisionInput, signal: AbortSignal): Promise<DecisionOutput>
  stop(): void
}
export class LocalDecisionModel implements DecisionProvider {
  private worker: Worker | null = null
  private next = 0
  private idle: ReturnType<typeof setTimeout> | null = null
  private progress: ((value: number) => void) | null = null
  private jobs = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void }>()
  constructor(
    private readonly directory: string,
    private readonly workerFile = path.join(__dirname, 'fileAssistantWorker.js')
  ) {}
  ready(): boolean {
    try {
      return (
        JSON.parse(readFileSync(path.join(this.directory, 'ready.json'), 'utf8')).model === LAYA_ID &&
        LAYA_FILES.every((f) => existsSync(path.join(this.directory, f.file)) && statSync(path.join(this.directory, f.file)).size === f.size)
      )
    } catch {
      return false
    }
  }
  async download(signal: AbortSignal, progress: (value: number) => void): Promise<void> {
    this.progress = progress
    try {
      await this.request('download', undefined, signal)
    } finally {
      this.progress = null
    }
  }
  async decide(input: DecisionInput, signal: AbortSignal): Promise<DecisionOutput> {
    if (!this.ready()) throw new Error('Download Laya in Settings first')
    const result = (await this.request('decide', input, signal)) as DecisionOutput
    if (
      !result ||
      !input.choices.some((c) => c.id === result.choice) ||
      !Number.isFinite(result.score) ||
      result.score < 0 ||
      result.score > 1 ||
      result.probabilities?.length !== input.choices.length ||
      result.probabilities.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
    )
      throw new Error('Invalid local model response')
    return result
  }
  private request(type: 'download' | 'decide', input: DecisionInput | undefined, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (this.idle) clearTimeout(this.idle)
    if (!this.worker) {
      const worker = new Worker(this.workerFile, { workerData: { directory: this.directory } })
      this.worker = worker
      worker.on('message', (message: { id?: number; result?: unknown; error?: string; progress?: number }) => {
        if (message.progress !== undefined) {
          this.progress?.(message.progress)
          return
        }
        const job = this.jobs.get(message.id!)
        if (!job) return
        this.jobs.delete(message.id!)
        job.cleanup()
        if (message.error) job.reject(new Error(message.error))
        else job.resolve(message.result)
        if (!this.jobs.size) this.idle = setTimeout(() => this.stop(), 60000)
      })
      worker.once('error', (e) => {
        if (this.worker === worker) this.stop(e)
      })
      worker.once('exit', (code) => {
        if (this.worker === worker) this.stop(new Error(`Local model worker exited (${code})`))
      })
    }
    return new Promise((resolve, reject) => {
      const id = ++this.next
      const timeout = setTimeout(() => this.stop(new Error('Local model timed out')), type === 'download' ? 20 * 60000 : 90000)
      const abort = (): void => this.stop(new Error('Local analysis stopped'))
      signal.addEventListener('abort', abort, { once: true })
      this.jobs.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timeout)
          signal.removeEventListener('abort', abort)
        }
      })
      this.worker!.postMessage({ id, type, input })
    })
  }
  stop(error = new Error('Local model stopped')): void {
    if (this.idle) {
      clearTimeout(this.idle)
      this.idle = null
    }
    const worker = this.worker
    this.worker = null
    if (worker) void worker.terminate()
    for (const job of this.jobs.values()) {
      job.cleanup()
      job.reject(error)
    }
    this.jobs.clear()
  }
}
