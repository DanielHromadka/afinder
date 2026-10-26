import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { EMBEDDING_DIMENSIONS, EMBEDDING_ID, EMBEDDING_MODEL } from '@shared/embedding'
export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL }

export interface EmbeddingProvider {
  identity(signal: AbortSignal): Promise<string>
  embed(texts: string[], query: boolean, signal: AbortSignal): Promise<number[][]>
  ready?(): boolean
  download?(signal: AbortSignal, progress: (value: number) => void): Promise<void>
  stop?(): void
}
export class EmbeddedEmbeddings implements EmbeddingProvider {
  private worker: Worker | null = null
  private counter = 0
  private idle: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<number, { resolve(value: number[][]): void; reject(error: Error): void; cleanup(): void }>()
  private progress: ((value: number) => void) | null = null
  private readonly marker: string
  constructor(
    private readonly cacheDir: string,
    private readonly workerFile = path.join(__dirname, 'activityEmbeddingWorker.js')
  ) {
    this.marker = path.join(cacheDir, 'ready.json')
  }
  ready(): boolean {
    try {
      return existsSync(this.marker) && JSON.parse(readFileSync(this.marker, 'utf8')).model === EMBEDDING_ID
    } catch {
      return false
    }
  }
  async identity(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    if (!this.ready()) throw new Error('Download the local embedding model in Settings first')
    return EMBEDDING_ID
  }
  async download(signal: AbortSignal, progress: (value: number) => void): Promise<void> {
    mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 })
    this.progress = progress
    try {
      await this.request('download', [], false, signal)
      signal.throwIfAborted()
      writeFileSync(this.marker, JSON.stringify({ model: EMBEDDING_ID }), { mode: 0o600 })
    } finally {
      this.progress = null
    }
  }
  async embed(texts: string[], query: boolean, signal: AbortSignal): Promise<number[][]> {
    await this.identity(signal)
    return this.request('embed', texts, query, signal)
  }
  private request(type: 'download' | 'embed', texts: string[], query: boolean, signal: AbortSignal): Promise<number[][]> {
    signal.throwIfAborted()
    if (this.idle) {
      clearTimeout(this.idle)
      this.idle = null
    }
    if (!this.worker) {
      const worker = new Worker(this.workerFile, { workerData: { cacheDir: this.cacheDir } })
      this.worker = worker
      worker.on('message', (data: { id?: number; progress?: number; vectors?: unknown; error?: string }) => {
        if (data.progress !== undefined) {
          this.progress?.(Math.max(0, Math.min(100, data.progress)))
          return
        }
        const item = this.pending.get(data.id!)
        if (!item) return
        this.pending.delete(data.id!)
        item.cleanup()
        if (data.error) item.reject(new Error(data.error))
        else {
          try {
            if (!Array.isArray(data.vectors)) throw new Error('Invalid embedding response')
            item.resolve(data.vectors.map(normalizeEmbedding))
          } catch (error) {
            item.reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
        if (!this.pending.size) this.idle = setTimeout(() => this.stop(), 60000)
      })
      worker.once('error', (error) => {
        if (this.worker === worker) this.stop(error)
      })
      worker.once('exit', (code) => {
        if (this.worker === worker) this.stop(new Error(`Embedding worker exited (${code})`))
      })
    }
    return new Promise((resolve, reject) => {
      const id = ++this.counter
      const timer = setTimeout(() => this.stop(new Error('Embedding operation timed out')), type === 'download' ? 600000 : 60000)
      const abort = (): void => this.stop(new Error('Embedding operation stopped'))
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
        }
      })
      this.worker!.postMessage({ id, type, texts, query })
    })
  }
  stop(error = new Error('Embedding worker stopped')): void {
    if (this.idle) {
      clearTimeout(this.idle)
      this.idle = null
    }
    const worker = this.worker
    this.worker = null
    if (worker) void worker.terminate()
    for (const item of this.pending.values()) {
      item.cleanup()
      item.reject(error)
    }
    this.pending.clear()
  }
}
export function normalizeEmbedding(input: unknown): number[] {
  if (!Array.isArray(input) || input.length !== EMBEDDING_DIMENSIONS || input.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
    throw new Error('Invalid embedding vector')
  const norm = Math.hypot(...input)
  if (!norm) throw new Error('Empty embedding vector')
  return (input as number[]).map((n) => n / norm)
}
