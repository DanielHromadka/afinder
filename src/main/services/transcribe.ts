// Speech to text for audio and video files, offline (Whisper in a worker thread, see transcribeWorker.ts).
// Off by default; the model is downloaded only from the Download button. The renderer decodes the media
// (it has the decoders) and sends 30 s windows of 16 kHz audio one after another; the segments collect
// here and are written next to the file as subtitles (.srt) or text (.txt). Imported on first use.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { app, type WebContents } from 'electron'
import { convertedName } from '@shared/convert'
import { t } from '@shared/i18n'
import { IPC } from '@shared/ipcChannels'
import { previewKind } from '@shared/preview'
import { CHUNK_SAMPLES, isTranscribeLanguage, isWhisperModel, toSrt, toText, WHISPER_MODELS, type Segment, type WhisperModel } from '@shared/whisper'
import { validatePath } from './fileSystem'
import { createBytes, freePath } from './preview'
import { loadState } from './settings'

const IDLE_MS = 60_000

const cacheDir = (): string => path.join(app.getPath('userData'), 'speech-model')
const markerOf = (model: WhisperModel): string => path.join(cacheDir(), `${model}.ready.json`)

let worker: Worker | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let counter = 0
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
let onProgress: ((value: number) => void) | null = null

function ensureWorker(): Worker {
  if (idle) {
    clearTimeout(idle)
    idle = null
  }
  if (worker) return worker
  const w = new Worker(path.join(__dirname, 'transcribeWorker.js'), { workerData: { cacheDir: cacheDir() } })
  w.on('message', (data: { id?: number; progress?: number; result?: unknown; error?: string }) => {
    if (data.progress !== undefined) return onProgress?.(Math.max(0, Math.min(100, data.progress)))
    const item = pending.get(data.id!)
    if (!item) return
    pending.delete(data.id!)
    if (data.error) item.reject(new Error(data.error))
    else item.resolve(data.result)
    if (!pending.size) idle = setTimeout(stop, IDLE_MS)
  })
  w.once('error', (err) => worker === w && stop(err))
  w.once('exit', (code) => worker === w && stop(new Error(`Speech worker exited (${code})`)))
  return (worker = w)
}

function request<T>(message: Record<string, unknown>, transfer: ArrayBuffer[] = []): Promise<T> {
  const w = ensureWorker()
  const id = ++counter
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage({ ...message, id }, transfer)
  })
}

export function stop(error: Error = new Error('Speech worker stopped')): void {
  if (idle) {
    clearTimeout(idle)
    idle = null
  }
  const w = worker
  worker = null
  if (w) void w.terminate()
  for (const item of pending.values()) item.reject(error)
  pending.clear()
}

const ready = (model: WhisperModel): boolean => {
  try {
    return existsSync(markerOf(model)) && JSON.parse(readFileSync(markerOf(model), 'utf8')).revision === WHISPER_MODELS[model].revision
  } catch {
    return false
  }
}

/** Which models are on disk. */
export function status(): Record<WhisperModel, boolean> {
  return { base: ready('base'), small: ready('small') }
}

let downloading: Promise<void> | null = null

/** Downloads the model's pinned files (only from the button); progress 0–100 goes to the window. */
export async function download(sender: WebContents, model: unknown): Promise<void> {
  if (!isWhisperModel(model)) throw new Error(t('error.invalidOption'))
  if (downloading) throw new Error(t('transcribe.busy'))
  mkdirSync(cacheDir(), { recursive: true, mode: 0o700 })
  onProgress = (value) => !sender.isDestroyed() && sender.send(IPC.transcribeProgress, value)
  downloading = request<void>({ type: 'download', model })
  try {
    await downloading
    writeFileSync(markerOf(model), JSON.stringify({ revision: WHISPER_MODELS[model].revision }), { mode: 0o600 })
  } finally {
    downloading = null
    onProgress = null
  }
}

interface Job {
  owner: number
  source: string
  model: WhisperModel
  language: string | null
  segments: Segment[]
}
const jobs = new Map<string, Job>()

/** Starts transcribing the audio or video at p; the renderer then sends its windows with chunk(). */
export async function begin(sender: WebContents, p: unknown, model: unknown, language: unknown): Promise<string> {
  if (!loadState().transcribeEnabled) throw new Error(t('transcribe.disabled'))
  const source = validatePath(p)
  const kind = previewKind(path.basename(source))
  if (kind !== 'audio' && kind !== 'video') throw new Error(t('error.invalidOption'))
  if (!isWhisperModel(model)) throw new Error(t('error.invalidOption'))
  if (!ready(model)) throw new Error(t('transcribe.noModel'))
  const id = randomUUID()
  jobs.set(id, { owner: sender.id, source, model, language: isTranscribeLanguage(language) ? language : null, segments: [] })
  sender.once('destroyed', () => jobs.delete(id))
  return id
}

function jobOf(sender: WebContents, id: unknown): Job {
  const job = typeof id === 'string' ? jobs.get(id) : undefined
  if (!job || job.owner !== sender.id) throw new Error(t('error.invalidOption'))
  return job
}

/** One window of 16 kHz mono audio starting at `offset` seconds; returns its segments. */
export async function chunk(sender: WebContents, id: unknown, samples: unknown, offset: unknown): Promise<Segment[]> {
  const job = jobOf(sender, id)
  if (!(samples instanceof Float32Array) || samples.length === 0 || samples.length > CHUNK_SAMPLES) throw new Error(t('error.invalidOption'))
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) throw new Error(t('error.invalidOption'))
  const copy = samples.slice()
  const result = await request<{ segments: Segment[]; language: string }>(
    { type: 'chunk', model: job.model, samples: copy, language: job.language, offset, seconds: samples.length / 16000 },
    [copy.buffer]
  )
  // The first window's language holds for the rest, so a quiet or musical window does not switch it.
  job.language ??= result.language
  job.segments.push(...result.segments)
  return result.segments
}

/** Writes what was transcribed next to the file as `name.srt` or `name.txt`; returns the new file. */
export async function finish(sender: WebContents, id: unknown, format: unknown): Promise<{ path: string }> {
  const job = jobOf(sender, id)
  if (format !== 'srt' && format !== 'txt') throw new Error(t('error.invalidOption'))
  jobs.delete(id as string)
  if (job.segments.length === 0) throw new Error(t('transcribe.nothing'))
  const target = await freePath(path.dirname(job.source), (taken) => convertedName(path.basename(job.source), format, taken))
  await createBytes(target, new TextEncoder().encode(format === 'srt' ? toSrt(job.segments) : toText(job.segments)))
  return { path: target }
}

export function abort(sender: WebContents, id: unknown): void {
  if (typeof id === 'string' && jobs.get(id)?.owner === sender.id) jobs.delete(id)
}
