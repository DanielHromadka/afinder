// The Tools area's main-process side: the worker for checksums, duplicates and the disk map, the CNB
// exchange rates, image decoding and saving, the file pickers and the clipboard history.

import { promises as fs } from 'node:fs'
import { BrowserWindow, clipboard, dialog, nativeImage, net, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import workerPath from '../../workers/toolsWorker?modulePath'
import { t } from '@shared/i18n'
import { CNB_URL, parseCnbRates, type Rates } from '@shared/tools/rates'
import { IPC, type ClipboardEntry, type DiskNode, type DuplicateGroup, type FileHashes } from '@shared/types'
import * as files from './fileSystem'
import * as vfs from './vfs'

// ---- worker jobs -------------------------------------------------------------------------------

const WORKER_IDLE_MS = 30_000
let worker: UtilityProcess | null = null
let idle: NodeJS.Timeout | null = null
const jobs = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; sender: WebContents }>()

function ensureWorker(): UtilityProcess {
  if (idle) clearTimeout(idle)
  idle = null
  if (worker) return worker
  const w = utilityProcess.fork(workerPath, [], { serviceName: 'aFinder tools worker' })
  w.on('message', (m: { id: string; progress?: unknown; result?: unknown; error?: string }) => {
    const job = jobs.get(m.id)
    if (!job) return
    if (m.progress) {
      if (!job.sender.isDestroyed()) job.sender.send(IPC.toolsProgress, m.id, m.progress)
      return
    }
    jobs.delete(m.id)
    if (m.error !== undefined) job.reject(new Error(m.error === 'cancelled' ? t('tools.cancelled') : m.error))
    else job.resolve(m.result)
    scheduleIdle()
  })
  w.on('exit', () => {
    if (worker !== w) return
    worker = null
    for (const [id, job] of jobs) {
      jobs.delete(id)
      job.reject(new Error(t('tools.failed')))
    }
  })
  worker = w
  return w
}

/** A worker is a whole Node process: it exits when nothing has run for a while. */
function scheduleIdle(): void {
  if (jobs.size || !worker) return
  idle = setTimeout(() => {
    worker?.kill()
    worker = null
  }, WORKER_IDLE_MS)
}

/** Worker jobs read the disk directly, so they take local paths only (not archives or remotes). */
async function localPath(p: unknown): Promise<string> {
  const valid = files.validatePath(p)
  if (await vfs.isVirtual(valid)) throw new Error(t('tools.localOnly'))
  return valid
}

function run<T>(sender: WebContents, id: unknown, message: Record<string, unknown>): Promise<T> {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new Error('Bad job id')
  return new Promise<T>((resolve, reject) => {
    jobs.set(id, { resolve: resolve as (v: unknown) => void, reject, sender })
    ensureWorker().postMessage({ ...message, id })
  })
}

export const hashFile = async (sender: WebContents, id: unknown, p: unknown): Promise<FileHashes> => run(sender, id, { type: 'hash', path: await localPath(p) })
export const findDuplicates = async (sender: WebContents, id: unknown, dir: unknown): Promise<DuplicateGroup[]> => run(sender, id, { type: 'dupes', dir: await localPath(dir) })
export const diskTree = async (sender: WebContents, id: unknown, dir: unknown): Promise<DiskNode> => run(sender, id, { type: 'tree', dir: await localPath(dir) })
export function cancel(id: unknown): void {
  if (typeof id === 'string' && jobs.has(id)) worker?.postMessage({ type: 'cancel', id })
}
export function stop(): void {
  worker?.kill()
  worker = null
}

// ---- exchange rates ----------------------------------------------------------------------------

const RATES_TTL = 60 * 60_000
let rates: { value: Rates; at: number } | null = null

/** CNB rates, fetched only when the currency converter asks, at most once an hour. */
export async function exchangeRates(): Promise<Rates> {
  if (rates && Date.now() - rates.at < RATES_TTL) return rates.value
  try {
    const res = await net.fetch(CNB_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    rates = { value: parseCnbRates(await res.text()), at: Date.now() }
    return rates.value
  } catch (err) {
    // Offline: the last rates are better than none.
    if (rates) return rates.value
    throw new Error(`${t('tools.ratesFailed')} (${err instanceof Error ? err.message : String(err)})`)
  }
}

// ---- images ------------------------------------------------------------------------------------

/** PNG bytes of an image Chromium cannot decode itself (HEIC, TIFF … on macOS). */
export async function decodeImage(p: unknown): Promise<Uint8Array> {
  const image = nativeImage.createFromPath(await vfs.realPath(files.validatePath(p)))
  if (image.isEmpty()) throw new Error(t('tools.imageUnreadable'))
  return new Uint8Array(image.toPNG())
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i
const MAX_IMAGE_BYTES = 200 * 1024 * 1024

/** Writes a converted image into dir under a free name; returns its path. */
export async function saveImage(dir: unknown, name: unknown, data: unknown): Promise<string> {
  const folder = files.validatePath(dir)
  await vfs.assertWritable(folder)
  const clean = files.validateName(name)
  if (!IMAGE_EXT.test(clean)) throw new Error(t('tools.imageUnreadable'))
  if (!(data instanceof Uint8Array) || data.length === 0 || data.length > MAX_IMAGE_BYTES) throw new Error(t('tools.imageUnreadable'))
  const target = await files.freeName(folder, clean)
  await fs.writeFile(target, data, { flag: 'wx' })
  return target
}

// ---- pickers -----------------------------------------------------------------------------------

export async function pick(sender: WebContents, kind: unknown, multiple: unknown): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(sender)
  const properties: Electron.OpenDialogOptions['properties'] = kind === 'folder' ? ['openDirectory'] : multiple === true ? ['openFile', 'multiSelections'] : ['openFile']
  const options: Electron.OpenDialogOptions = { properties }
  if (kind === 'image') options.filters = [{ name: t('tools.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff'] }]
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return res.canceled ? [] : res.filePaths
}

// ---- clipboard history -------------------------------------------------------------------------

const CLIP_POLL_MS = 1000
const CLIP_MAX = 50
const CLIP_MAX_CHARS = 20_000
let clipTimer: NodeJS.Timeout | null = null
let clipLast = ''
let clips: ClipboardEntry[] = []

const broadcastClips = (): void => {
  for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.toolsClipboardChanged, clips)
}

/**
 * Texts copied anywhere, newest first. Off by default; kept only in memory and dropped when turned off.
 * Polling is the only portable way: no OS reports clipboard changes to Electron.
 */
export function setClipboardHistory(enabled: boolean): void {
  if (!enabled) {
    if (clipTimer) clearInterval(clipTimer)
    clipTimer = null
    clips = []
    broadcastClips()
    return
  }
  if (clipTimer) return
  // What is on the clipboard when the history starts is not "copied" yet.
  void clipboard.readText().then((text) => (clipLast = text))
  clipTimer = setInterval(async () => {
    const text = await clipboard.readText()
    if (!clipTimer || !text || text === clipLast) return
    clipLast = text
    clips = [{ text: text.slice(0, CLIP_MAX_CHARS), at: Date.now() }, ...clips.filter((c) => c.text !== text)].slice(0, CLIP_MAX)
    broadcastClips()
  }, CLIP_POLL_MS)
}

export const clipboardEntries = (): ClipboardEntry[] => clips
export function clearClipboardHistory(): void {
  clips = []
  broadcastClips()
}

