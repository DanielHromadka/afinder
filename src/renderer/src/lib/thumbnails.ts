// Small pictures of photos and videos for the icon view. Made in the renderer: images are decoded at a
// reduced size, videos give a frame from Mediabunny (a tenth into the clip); what Chromium cannot read
// (HEIC, TIFF, HEVC on some systems) asks the OS (Quick Look, Explorer). A few at a time, newest first
// dropped when the tile scrolled away, and kept as object URLs in a small LRU cache.

import { previewKind, previewUrl } from '@shared/preview'
import type { FileEntry } from '@shared/types'
import { remoteMountOf } from './remotes'

const api = window.api

/** What drawing a file needs to know about it. */
type Picture = Pick<FileEntry, 'path' | 'name' | 'size'>

/** Pixel box of a thumbnail (twice the CSS box, for sharp tiles on Retina screens). */
const BOX_W = 160
const BOX_H = 96
const CONCURRENCY = 3
const CACHE_SIZE = 400
/** Larger files are left to the OS (a 40 MB RAW decoded in the renderer is not worth it). */
const MAX_DECODE_BYTES = 60 * 1024 * 1024

const cache = new Map<string, string | null>()
const waiting: { key: string; entry: Picture & { modified: number }; resolve(url: string | null): void; signal: AbortSignal }[] = []
const pending = new Map<string, Promise<string | null>>()
let running = 0

const keyOf = (e: Pick<FileEntry, 'path' | 'modified' | 'size'>): string => `${e.path}|${e.modified}|${e.size}`

/** Photos and videos on local disks (remote files would be downloaded whole). */
export function thumbnailable(entry: FileEntry): boolean {
  if (entry.isDir || remoteMountOf(entry.path)) return false
  const kind = previewKind(entry.name)
  return kind === 'image' || kind === 'video'
}

/** A thumbnail already made (undefined when not yet tried), so a tile can show it on its first render. */
export const cachedThumbnail = (entry: Picture & { modified: number }): string | null | undefined => cache.get(keyOf(entry))

/** The thumbnail's URL, or null when none can be made. Aborting before it starts takes it out of the queue. */
export function thumbnail(entry: Picture & { modified: number }, signal: AbortSignal): Promise<string | null> {
  const key = keyOf(entry)
  if (cache.has(key)) return Promise.resolve(cache.get(key)!)
  const already = pending.get(key)
  if (already) return already
  const promise = new Promise<string | null>((resolve) => {
    waiting.push({ key, entry, resolve, signal })
    pump()
  })
  pending.set(key, promise)
  void promise.finally(() => pending.delete(key))
  return promise
}

function pump(): void {
  while (running < CONCURRENCY && waiting.length) {
    // Newest requests first: those are the tiles on screen now.
    const job = waiting.pop()!
    if (job.signal.aborted) {
      job.resolve(null)
      continue
    }
    running++
    void make(job.entry)
      .catch(() => null)
      .then((url) => {
        remember(job.key, url)
        job.resolve(url)
      })
      .finally(() => {
        running--
        pump()
      })
  }
}

function remember(key: string, url: string | null): void {
  cache.set(key, url)
  while (cache.size > CACHE_SIZE) {
    const [oldest, old] = cache.entries().next().value!
    cache.delete(oldest)
    if (old?.startsWith('blob:')) URL.revokeObjectURL(old)
  }
}

/** The size that fits w×h into the box, keeping the aspect ratio and never enlarging. */
function fit(w: number, h: number, boxW: number, boxH: number): [number, number] {
  const scale = Math.min(boxW / w, boxH / h, 1)
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]
}

function drawn(source: CanvasImageSource, w: number, h: number, boxW: number, boxH: number): OffscreenCanvas {
  const [tw, th] = fit(w, h, boxW, boxH)
  const canvas = new OffscreenCanvas(tw, th)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, tw, th)
  return canvas
}

async function make(entry: Picture): Promise<string | null> {
  const picture = await renderPicture(entry, BOX_W, BOX_H)
  return picture ? URL.createObjectURL(await picture.convertToBlob({ type: 'image/webp', quality: 0.8 })) : null
}

/**
 * A photo or a video frame drawn to fit boxW×boxH (for thumbnails and contact sheets); null when neither
 * Chromium nor the OS can show it.
 */
export async function renderPicture(entry: Picture, boxW: number, boxH: number): Promise<OffscreenCanvas | null> {
  if (entry.size === null || entry.size <= MAX_DECODE_BYTES) {
    try {
      return previewKind(entry.name) === 'video' ? await videoFrame(entry, boxW, boxH) : await imageThumb(entry, boxW, boxH)
    } catch {
      /* the OS may still have a thumbnail */
    }
  }
  const url = await api.preview.thumbnail(entry.path, Math.min(2048, Math.max(256, boxW))).catch(() => null)
  if (!url) return null
  const bitmap = await createImageBitmap(await (await fetch(url)).blob())
  try {
    return drawn(bitmap, bitmap.width, bitmap.height, boxW, boxH)
  } finally {
    bitmap.close()
  }
}

async function imageThumb(entry: Picture, boxW: number, boxH: number): Promise<OffscreenCanvas> {
  const res = await fetch(previewUrl(entry.path))
  if (!res.ok) throw new Error(String(res.status))
  // Decoding at a reduced width keeps a 50 MP photo from taking 200 MB for a 48 px tile.
  const bitmap = await createImageBitmap(await res.blob(), { resizeWidth: boxW * 2, resizeQuality: 'medium' })
  try {
    return drawn(bitmap, bitmap.width, bitmap.height, boxW, boxH)
  } finally {
    bitmap.close()
  }
}

async function videoFrame(entry: Picture, boxW: number, boxH: number): Promise<OffscreenCanvas> {
  const { ALL_FORMATS, CanvasSink, Input, UrlSource } = await import('mediabunny')
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(entry.path)) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) throw new Error('undecodable')
    const [w, h] = fit(track.displayWidth, track.displayHeight, boxW, boxH)
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 1 })
    const start = await track.getFirstTimestamp()
    const duration = (await track.getDurationFromMetadata().catch(() => null)) ?? 0
    // A tenth into the clip skips black fade-ins, but not further than 10 s.
    const frame = await sink.getCanvas(start + Math.min(10, duration * 0.1))
    if (!frame) throw new Error('no frame')
    return drawn(frame.canvas, w, h, boxW, boxH)
  } finally {
    input.dispose()
  }
}
