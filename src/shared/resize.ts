// Batch resize and compression of images: the target size, format and name of each result. The pixels
// are drawn and encoded by Chromium in the renderer; this is the arithmetic around it, shared with tests.

import { extensionOf } from './preview'

export type ResizeFormat = 'keep' | 'jpg' | 'webp' | 'png'

export interface ResizeOptions {
  /** 'fit': into maxWidth × maxHeight (0 = no limit); 'percent': scale by percent. Never enlarges. */
  mode: 'fit' | 'percent'
  maxWidth: number
  maxHeight: number
  percent: number
  format: ResizeFormat
  /** 1–100, for JPEG and WebP. */
  quality: number
  /** Kilobytes the file should not exceed (JPEG and WebP; 0 = no target): the quality is lowered to fit. */
  targetKb: number
  /** Overwrite the originals (only when the format stays) instead of writing copies. */
  overwrite: boolean
  /** Copy EXIF (date taken, camera …) into JPEG results; the location only with keepGps. */
  keepMetadata: boolean
  keepGps: boolean
}

export const DEFAULT_RESIZE: ResizeOptions = {
  mode: 'fit',
  maxWidth: 1920,
  maxHeight: 1920,
  percent: 50,
  format: 'keep',
  quality: 85,
  targetKb: 0,
  overwrite: false,
  keepMetadata: true,
  keepGps: false
}

/** Formats the result can be written in; anything else (HEIC, GIF, TIFF …) becomes a JPEG when kept. */
const ENCODABLE: Record<string, 'jpg' | 'png' | 'webp'> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' }

/** The extension of the result for a source name. */
export function resizedExt(name: string, format: ResizeFormat): 'jpg' | 'png' | 'webp' {
  return format === 'keep' ? (ENCODABLE[extensionOf(name)] ?? 'jpg') : format
}

/** Whether the result may replace the original: same format, and one Chromium can write. */
export function canOverwrite(name: string, format: ResizeFormat): boolean {
  const own = ENCODABLE[extensionOf(name)]
  return own !== undefined && resizedExt(name, format) === own
}

/** New pixel size, keeping the aspect ratio, never larger than the original and at least 1 px. */
export function resizedSize(width: number, height: number, o: Pick<ResizeOptions, 'mode' | 'maxWidth' | 'maxHeight' | 'percent'>): { width: number; height: number } {
  const scale =
    o.mode === 'percent'
      ? Math.min(1, Math.max(0.01, o.percent / 100))
      : Math.min(1, o.maxWidth > 0 ? o.maxWidth / width : 1, o.maxHeight > 0 ? o.maxHeight / height : 1)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Finds the highest quality whose result fits into `maxBytes` by bisection (encode is the expensive
 * part, so at most `steps` tries). Returns the smallest result when even the lowest quality is too big.
 */
export async function fitQuality(encode: (quality: number) => Promise<Uint8Array>, maxBytes: number, start: number, steps = 7): Promise<Uint8Array> {
  let best: Uint8Array | null = null
  let smallest: Uint8Array | null = null
  let lo = 0.05
  let hi = Math.min(1, Math.max(lo, start))
  // The requested quality may already fit.
  const first = await encode(hi)
  if (first.length <= maxBytes) return first
  smallest = first
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2
    const data = await encode(mid)
    if (data.length < smallest.length) smallest = data
    if (data.length <= maxBytes) {
      best = data
      lo = mid
    } else hi = mid
  }
  return best ?? smallest
}
