import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ActivityService } from './activityService'
import { normalizeEmbedding, type EmbeddingProvider } from './activityEmbeddings'

const directories: string[] = [], services: ActivityService[] = []
const options = { activityEnabled: true, semanticEnabled: false, activityRetentionDays: 90 }
const vector = (i: number): number[] => Array.from({ length: 384 }, (_, j) => j === i ? 1 : 0)
function setup(patch = {}, provider: EmbeddingProvider = { identity: vi.fn(async () => 'test'), embed: vi.fn(async (texts) => texts.map(() => vector(0))) }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'afinder-activity-test-')); directories.push(dir)
  const file = path.join(dir, 'history.sqlite')
  const service = new ActivityService(file, { ...options, ...patch }, vi.fn(), provider); services.push(service)
  return { service, file, provider }
}
afterEach(async () => { for (const service of services.splice(0)) await service.dispose(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.useRealTimers() })

describe('private opt-in activity history', () => {
  it('creates no database and makes no model calls while disabled', async () => {
    const { service, file, provider } = setup({ activityEnabled: false })
    service.visit('/work', 1); service.record({ action: 'open', paths: ['/work/a'] })
    expect(service.status().total).toBe(0); expect(existsSync(file)).toBe(false)
    expect(await service.track({ action: 'edit' }, () => 42)).toBe(42)
    await expect(service.download()).rejects.toThrow('Enable')
    await expect(service.query({ mode: 'semantic', text: 'hello' })).rejects.toThrow('Enable')
    expect(provider.identity).not.toHaveBeenCalled(); expect(provider.embed).not.toHaveBeenCalled()
  })
  it('does not resurrect operations begun before turning recording off and on', async () => {
    const { service } = setup()
    let finish!: () => void
    const work = service.track({ action: 'copy' }, () => new Promise<void>((resolve) => { finish = resolve }))
    service.configure({ ...options, activityEnabled: false }); service.configure(options)
    finish(); await work
    expect(service.status().total).toBe(0)
  })
  it('stores explicit fragments, deduplicates visits and omits automatic contents', async () => {
    const { service } = setup()
    service.visit('/work', 1); service.visit('/work', 1)
    service.note('/work', 'Zálohování', 'Fotografie na externím disku')
    service.record({ action: 'edit', folder: '/work', paths: ['/work/a'], note: 'secret file contents', errorCode: 'private raw error' })
    const rows = (await service.query({})).events
    expect(rows).toHaveLength(3)
    expect(rows.find((e) => e.action === 'edit')).toMatchObject({ note: '', errorCode: null })
    expect((await service.query({ text: 'zalohov' })).events[0].label).toBe('Zálohování')
    expect((await service.query({ text: 'secret' })).total).toBe(0)
    expect(JSON.parse(service.export({})).events).toHaveLength(3)
  })
  it('persists across restarts, filters descendants, actions and dates and pages results', async () => {
    const { service, file, provider } = setup()
    service.record({ action: 'copy', folder: '/work/a' }); service.record({ action: 'move', folder: '/work/abc' })
    service.record({ action: 'open', folder: '/work/a/b' })
    expect((await service.query({ folder: '/work/a' })).total).toBe(2)
    expect((await service.query({ action: 'copy', from: Date.now() - 10000, to: Date.now() + 1 })).total).toBe(1)
    expect((await service.query({ limit: 1, offset: 1 })).events).toHaveLength(1)
    await service.dispose(); services.splice(services.indexOf(service), 1)
    const reopened = new ActivityService(file, options, () => {}, provider); services.push(reopened)
    expect(reopened.status().total).toBe(3)
  })
  it('preserves operation results and errors and bounds stored metadata', async () => {
    const { service } = setup()
    await expect(service.track({ action: 'copy' }, () => { throw Object.assign(new Error('secret'), { code: 'EACCES' }) })).rejects.toThrow('secret')
    const event = (await service.query({})).events[0]
    expect(event.outcome).toBe('failed'); expect(event.errorCode).toBe('EACCES'); expect(service.export({})).not.toContain('secret')
    service.record({ action: 'rename', paths: Array.from({ length: 30 }, (_, i) => `/work/${i}`) })
    expect((await service.query({ action: 'rename' })).events[0].paths).toHaveLength(20)
  })
  it('prunes expired events and clears all persisted files', async () => {
    const { service, file } = setup()
    service.record({ action: 'open' }, { epoch: 0, at: Date.now() - 100 * 86400000 })
    service.record({ action: 'open' }); expect(service.status().total).toBe(1)
    service.clear(); expect(service.status().total).toBe(0)
    for (const suffix of ['', '-wal', '-shm']) expect(existsSync(file + suffix)).toBe(false)
  })
  it('indexes locally, finds meaning, and cascades vector deletion', async () => {
    vi.useFakeTimers()
    const provider: EmbeddingProvider = { identity: async () => 'test', embed: async (texts, query) => texts.map((s) => vector(query || s.includes('Pictures') ? 0 : 1)) }
    const { service, file } = setup({ semanticEnabled: true }, provider)
    service.note('/work', 'Pictures', 'Sync camera images to external drive')
    service.note('/work', 'Invoices', 'Quarterly accounting')
    await vi.advanceTimersByTimeAsync(1200)
    expect(service.status().indexed).toBe(2)
    const result = await service.query({ mode: 'semantic', text: 'backup photographs' })
    expect(result.events[0].label).toBe('Pictures'); expect(result.total).toBe(1); expect(result.partial).toBe(false)
    const db = new DatabaseSync(file)
    expect(db.prepare('SELECT count(*) AS n FROM vectors').get()?.n).toBe(2); db.close()
    service.clear(); expect(service.status().total).toBe(0)
  })
  it('aborts an in-flight index on clear and prevents reinsertion', async () => {
    vi.useFakeTimers()
    let release!: (value: number[][]) => void, signal!: AbortSignal
    const provider: EmbeddingProvider = { identity: async () => 'test', embed: async (_, __, s) => { signal = s; return new Promise((resolve) => { release = resolve }) } }
    const { service, file } = setup({ semanticEnabled: true }, provider)
    service.note('/work', 'Pictures', 'Sync')
    await vi.advanceTimersByTimeAsync(1100)
    service.clear(); expect(signal.aborted).toBe(true); release([vector(0)]); await vi.advanceTimersByTimeAsync(10)
    expect(service.status().total).toBe(0); expect(existsSync(file)).toBe(false)
  })
  it('retains text search when model fails', async () => {
    const { service } = setup({ semanticEnabled: true }, { identity: async () => { throw new Error('offline model missing') }, embed: async () => [] })
    service.note('/work', 'Pictures', 'Camera backup')
    await expect(service.query({ mode: 'semantic', text: 'camera' })).rejects.toThrow('missing')
    expect((await service.query({ text: 'camera' })).total).toBe(1)
  })
  it('rejects malformed embedding vectors', () => {
    expect(() => normalizeEmbedding([1])).toThrow(); expect(() => normalizeEmbedding(vector(-1))).toThrow()
    const bad = vector(0); bad[1] = NaN; expect(() => normalizeEmbedding(bad)).toThrow()
    expect(Math.hypot(...normalizeEmbedding(vector(0)))).toBe(1)
  })
})
