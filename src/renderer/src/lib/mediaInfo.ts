// Reading the details of photos, videos and songs for the preview, the columns and batch renames. Photos
// are read with the EXIF parser over the preview protocol (only the first bytes of a JPEG); audio and video
// go through Mediabunny, which reads just the headers it needs with HTTP ranges; it is imported on first use.

import { exifReadBytes, hasExifSupport, readExif, type ExifData } from '@shared/exif'
import { localIso } from '@shared/media'
import { previewKind, previewUrl } from '@shared/preview'
import type { FileEntry } from '@shared/types'

/** Whole files are read only up to this size to find their EXIF block (PNG, WebP, HEIC). */
const MAX_EXIF_FILE_BYTES = 64 * 1024 * 1024

export interface MediaTags {
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: number
  track?: number
  /** Recording date as local `YYYY-MM-DDTHH:MM:SS`. */
  date?: string
}

export interface MediaDetails {
  /** Seconds. */
  duration?: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string | null
  audioCodec?: string | null
  channels?: number
  sampleRate?: number
  /** Bits per second, over the whole file. */
  bitrate?: number
  tags: MediaTags
  /** Cover art as stored in the file. */
  cover?: { data: Uint8Array; mimeType: string }
}

/** The bytes of the file (or its first `limit` bytes) over the preview protocol. */
export async function fetchBytes(path: string, limit: number | null = null, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(previewUrl(path), { headers: limit ? { Range: `bytes=0-${limit - 1}` } : {}, signal })
  if (!res.ok) throw new Error(String(res.status))
  return new Uint8Array(await res.arrayBuffer())
}

/** The photo's EXIF data; null when it has none or is too large to scan. */
export async function readPhotoExif(path: string, name: string, size: number | null, signal?: AbortSignal): Promise<ExifData | null> {
  const limit = exifReadBytes(name)
  if (limit === null && (size === null || size > MAX_EXIF_FILE_BYTES)) return null
  return readExif(await fetchBytes(path, limit, signal))
}

/** Duration, tracks and tags of an audio or video file; `full` also reads the cover and the frame rate. */
export async function readMediaDetails(path: string, size: number | null, full = true): Promise<MediaDetails> {
  const { ALL_FORMATS, Input, UrlSource } = await import('mediabunny')
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(path)) })
  try {
    const out: MediaDetails = { tags: {} }
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    out.duration = (await input.getDurationFromMetadata().catch(() => null)) ?? (await input.computeDuration().catch(() => undefined))
    if (video) {
      out.width = await video.getDisplayWidth()
      out.height = await video.getDisplayHeight()
      out.videoCodec = video.codec
      if (full) out.fps = (await video.computePacketStats(120).catch(() => null))?.averagePacketRate || undefined
    }
    if (audio) {
      out.audioCodec = audio.codec
      out.channels = audio.numberOfChannels
      out.sampleRate = audio.sampleRate
    }
    if (size && out.duration) out.bitrate = (size * 8) / out.duration
    const tags = await input.getMetadataTags().catch(() => null)
    if (tags) {
      out.tags = {
        title: tags.title,
        artist: tags.artist ?? tags.albumArtist,
        album: tags.album,
        genre: tags.genre,
        year: tags.date ? tags.date.getFullYear() : undefined,
        date: tags.date && !Number.isNaN(tags.date.getTime()) ? localIso(tags.date.getTime()) : undefined,
        track: tags.trackNumber
      }
      const cover = full ? (tags.images?.find((i) => i.kind === 'coverFront') ?? tags.images?.[0]) : undefined
      if (cover) out.cover = { data: cover.data, mimeType: cover.mimeType }
    }
    return out
  } finally {
    input.dispose()
  }
}

/** When a photo or video was taken (`YYYY-MM-DDTHH:MM:SS`, local), null when the file does not say. */
export async function dateTaken(entry: FileEntry): Promise<string | null> {
  const kind = previewKind(entry.name)
  try {
    if (kind === 'image') return !hasExifSupport(entry.name) ? null : (await readPhotoExif(entry.path, entry.name, entry.size))?.taken ?? null
    if (kind === 'video' || kind === 'audio') return (await readMediaDetails(entry.path, entry.size, false)).tags.date ?? null
  } catch {
    /* unreadable: no date */
  }
  return null
}

/** Runs fn over items with at most `limit` at a time, keeping the order of the results. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
