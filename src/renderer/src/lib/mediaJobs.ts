// Batch jobs over images and videos from the context menu, run by JobDialog one file after another.
// The heavy parts (Mediabunny, encoders) are imported when a job starts, not with the menu.

import { t } from '@shared/i18n'
import type { AudioTarget, ConvertKind, ConvertTarget } from '@shared/convert'
import { exifReadBytes, readExif, stripGps, stripMetadata, transplantExif, withOrientation } from '@shared/exif'
import { imageOutput, JPEG_QUALITY } from '@shared/imageEdit'
import { turnedOrientation, turnTransform, type Turn } from '@shared/orientation'
import { baseName, dirOf } from '@shared/paths'
import { canOverwrite, fitQuality, resizedExt, resizedSize, type ResizeOptions } from '@shared/resize'
import type { FileEntry } from '@shared/types'
import type { Job } from '../components/JobDialog'
import type { GifOptions } from '@shared/gif'
import type { SheetOptions } from '@shared/contactSheet'
import type { TranscribeOptions } from './transcribe'
import { convertImage, decodeImage, encodeImage } from './imageConvert'
import { fetchBytes } from './mediaInfo'

const api = window.api

export function convertJob(entries: FileEntry[], kind: ConvertKind, target: ConvertTarget): Job {
  return {
    title: t('convert.title', { format: t(`convert.format.${target}`) }),
    entries,
    note: kind === 'video' ? t('convert.videoNote') : undefined,
    run: async (entry, onProgress, signal) => {
      if (kind === 'image') return convertImage(entry.path, target)
      return (await (await import('./videoExport')).convertVideo(entry.path, target, onProgress, signal)).path
    }
  }
}

/** Rewrites photos in place without their location or without any metadata; the image data is not touched. */
export function stripJob(entries: FileEntry[], what: 'gps' | 'all'): Job {
  return {
    title: t(what === 'gps' ? 'strip.titleGps' : 'strip.titleAll'),
    entries,
    note: t('strip.note'),
    unchanged: t('strip.nothing'),
    run: async (entry, _onProgress, signal) => {
      const bytes = await fetchBytes(entry.path, null, signal)
      const out = what === 'gps' ? stripGps(bytes) : stripMetadata(bytes)
      if (!out) return null
      signal.throwIfAborted()
      await api.preview.saveImage(entry.path, out, { modified: entry.modified })
      return entry.path
    }
  }
}

/** Resizes and recompresses images, as copies `name (smaller).ext` or over the originals. */
export function resizeJob(entries: FileEntry[], o: ResizeOptions): Job {
  return {
    title: t('resize.title'),
    entries,
    note: o.overwrite ? t('resize.noteOverwrite') : t('resize.noteCopies'),
    run: async (entry, _onProgress, signal) => {
      const bitmap = await decodeImage(entry.path)
      let data: Uint8Array
      const ext = resizedExt(entry.name, o.format)
      try {
        const { width, height } = resizedSize(bitmap.width, bitmap.height, o)
        const encode = (quality: number): Promise<Uint8Array> => encodeImage(bitmap, width, height, ext, quality)
        data = ext !== 'png' && o.targetKb > 0 ? await fitQuality(encode, o.targetKb * 1024, o.quality / 100) : await encode(o.quality / 100)
      } finally {
        bitmap.close()
      }
      signal.throwIfAborted()
      if (ext === 'jpg' && o.keepMetadata) data = transplantExif(await fetchBytes(entry.path, exifReadBytes(entry.name), signal), data, !o.keepGps)
      if (o.overwrite && canOverwrite(entry.name, o.format)) {
        await api.preview.saveImage(entry.path, data, { modified: entry.modified })
        return entry.path
      }
      const stem = baseName(entry.path).replace(/\.[^.]+$/, '')
      return api.tools.saveImage(dirOf(entry.path), `${stem} (${t('resize.suffix')}).${ext}`, data)
    }
  }
}

/**
 * Turns or mirrors images in place. JPEGs only get a new EXIF orientation (lossless and instant); PNG and
 * WebP are redrawn. The dialog closes by itself when every file went through.
 */
export function turnJob(entries: FileEntry[], turn: Turn): Job {
  return {
    title: t(`turn.${turn}`),
    entries,
    autoClose: true,
    run: async (entry, _onProgress, signal) => {
      const bytes = await fetchBytes(entry.path, null, signal)
      const out = imageOutput(entry.name)
      let data = out.ext === 'jpg' || out.ext === 'jpeg' ? withOrientation(bytes, turnedOrientation(readExif(bytes)?.orientation ?? 1, turn)) : null
      if (!data) {
        const bitmap = await decodeImage(entry.path)
        try {
          const { width, height, matrix } = turnTransform(turn, bitmap.width, bitmap.height)
          const canvas = new OffscreenCanvas(width, height)
          const ctx = canvas.getContext('2d')!
          ctx.setTransform(...matrix)
          ctx.drawImage(bitmap, 0, 0)
          data = new Uint8Array(await (await canvas.convertToBlob({ type: out.mime, quality: JPEG_QUALITY })).arrayBuffer())
        } finally {
          bitmap.close()
        }
        // The pixels are upright now; the rest of the EXIF block stays.
        if (out.mime === 'image/jpeg') data = transplantExif(bytes, data)
      }
      signal.throwIfAborted()
      await api.preview.saveImage(entry.path, data, { modified: entry.modified })
      return entry.path
    }
  }
}

/** A stretch of a video as an animated GIF next to it. */
export function gifJob(entry: FileEntry, o: GifOptions): Job {
  return {
    title: t('gif.making'),
    entries: [entry],
    note: t('gif.note'),
    run: async (e, onProgress, signal) => {
      const data = await (await import('./videoGif')).videoToGif(e.path, o, onProgress, signal)
      signal.throwIfAborted()
      return api.tools.saveImage(dirOf(e.path), `${baseName(e.path).replace(/\.[^.]+$/, '')}.gif`, data)
    }
  }
}

/** The sound of each video as an audio file next to it. */
export function extractJob(entries: FileEntry[], target: AudioTarget): Job {
  return {
    title: t('extract.title', { format: t(`extract.format.${target}`) }),
    entries,
    note: t('extract.note'),
    run: async (entry, onProgress, signal) => (await (await import('./videoExport')).extractAudio(entry.path, target, onProgress, signal)).path
  }
}

/** The videos one after another in a new MP4; shown as one line, named after the first. */
export function mergeJob(entries: FileEntry[]): Job {
  return {
    title: t('merge.title', { n: entries.length }),
    entries: [entries[0]],
    note: t('merge.note', { names: entries.map((e) => e.name).join(', ') }),
    run: async (_entry, onProgress, signal) =>
      (
        await (await import('./videoExport')).mergeVideos(
          entries.map((e) => e.path),
          onProgress,
          signal
        )
      ).path
  }
}

/** The pictures in one grid image, saved in the folder of the first one. */
export function contactSheetJob(entries: FileEntry[], o: SheetOptions): Job {
  const folder = dirOf(entries[0].path)
  return {
    title: t('contact.making'),
    entries: [entries[0]],
    note: t('contact.note', { n: entries.length }),
    run: async (_entry, onProgress, signal) => {
      const data = await (await import('./contactSheet')).contactSheet(entries, `${baseName(folder) || folder} · ${entries.length}`, o, onProgress, signal)
      return api.tools.saveImage(folder, `${t('contact.fileName')}.${o.format}`, data)
    }
  }
}

/** Speech to text of each file, written next to it as subtitles or text. */
export function transcribeJob(entries: FileEntry[], o: TranscribeOptions): Job {
  return {
    title: t('transcribe.title'),
    entries,
    note: t('transcribe.note'),
    run: async (entry, onProgress, signal) => (await import('./transcribe')).transcribeFile(entry.path, o, onProgress, signal)
  }
}
