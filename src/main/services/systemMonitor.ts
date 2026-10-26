// The Task Manager tool's main-process side: forwards readings from systemWorker and ends processes.

import { utilityProcess, type UtilityProcess } from 'electron'
import workerPath from '../../workers/systemWorker?modulePath'
import { t } from '@shared/i18n'
import type { SysInfo, SysProcess, SysSample, SysSensors } from '@shared/types'

const WORKER_IDLE_MS = 30_000
/** A reading that has not come back by then is given up (e.g. a hung powershell). */
const REQUEST_TIMEOUT_MS = 20_000
let worker: UtilityProcess | null = null
let idle: NodeJS.Timeout | null = null
let counter = 0
const pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>()

function ensureWorker(): UtilityProcess {
  if (idle) clearTimeout(idle)
  idle = null
  if (worker) return worker
  const w = utilityProcess.fork(workerPath, [], { serviceName: 'aFinder system monitor' })
  w.on('message', (m: { id: string; result?: unknown; error?: string }) => {
    const req = pending.get(m.id)
    if (!req) return
    pending.delete(m.id)
    clearTimeout(req.timer)
    if (m.error !== undefined) req.reject(new Error(m.error))
    else req.resolve(m.result)
    scheduleIdle()
  })
  w.on('exit', () => {
    if (worker !== w) return
    worker = null
    for (const [id, req] of pending) {
      pending.delete(id)
      clearTimeout(req.timer)
      req.reject(new Error(t('tools.failed')))
    }
  })
  worker = w
  return w
}

/** Polling stops when the tool is hidden; the worker (a whole Node process) follows shortly after. */
function scheduleIdle(): void {
  if (pending.size || !worker) return
  idle = setTimeout(() => {
    worker?.kill()
    worker = null
  }, WORKER_IDLE_MS)
}

function request<T>(type: 'sample' | 'processes' | 'sensors' | 'info'): Promise<T> {
  const w = ensureWorker()
  const id = `${type}-${++counter}`
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(t('tools.failed')))
      scheduleIdle()
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    w.postMessage({ id, type })
  })
}

export const sample = (): Promise<SysSample> => request('sample')
export const processes = (): Promise<SysProcess[]> => request('processes')
export const sensors = (): Promise<SysSensors> => request('sensors')
export const info = (): Promise<SysInfo> => request('info')

/** Ends another process. Never aFinder itself, the kernel's or init's PID, or a process group (pid ≤ 0). */
export function kill(pid: unknown, force: unknown): void {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid || pid === process.ppid) throw new Error(t('error.invalidId'))
  try {
    process.kill(pid, force === true ? 'SIGKILL' : 'SIGTERM')
  } catch (err) {
    // Not the generic EPERM text: that one points at disk access settings.
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPERM') throw new Error(t('tools.sysKillDenied'))
    if (code === 'ESRCH') throw new Error(t('tools.sysKillGone'))
    throw err
  }
}
