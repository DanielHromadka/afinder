// Pure helpers for the image editor in Quick Look: which images it can open, how they are written back,
// and the geometry of crops and rotations. Shared so that main and the tests use the same rules.

import { extensionOf } from './preview'

/** Formats Chromium both decodes and encodes, so an edit can overwrite the original in place. */
const ENCODABLE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
/** Decodable but not encodable (or animated / vector): edits are saved as a PNG copy. */
const COPY_ONLY = new Set(['gif', 'bmp', 'avif', 'ico', 'svg', 'apng'])

export const JPEG_QUALITY = 0.92

/** Whether the editor can open the file at all (HEIC, TIFF … are only shown through OS thumbnails). */
export function canEditImage(name: string): boolean {
  const ext = extensionOf(name)
  return ext in ENCODABLE || COPY_ONLY.has(ext)
}

/** How edits to the file are written: the MIME type to encode, the extension, and whether in place is allowed. */
export function imageOutput(name: string): { mime: string; ext: string; overwrite: boolean } {
  const ext = extensionOf(name)
  if (ext in ENCODABLE) return { mime: ENCODABLE[ext], ext, overwrite: true }
  return { mime: 'image/png', ext: 'png', overwrite: false }
}

/** `photo.jpg` → `photo (edited).jpg`, then `photo (edited 2).jpg` … – the first name not taken. */
export function editedCopyName(name: string, ext: string, suffix: string, taken: (name: string) => boolean): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${suffix}${n > 1 ? ` ${n}` : ''}).${ext}`
    if (!taken(candidate)) return candidate
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The rectangle spanned by two drag points, clamped to the image and rounded to whole pixels. */
export function dragRect(x1: number, y1: number, x2: number, y2: number, maxW: number, maxH: number): Rect {
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, Math.round(v)))
  const left = clamp(Math.min(x1, x2), maxW)
  const top = clamp(Math.min(y1, y2), maxH)
  return { x: left, y: top, width: clamp(Math.max(x1, x2), maxW) - left, height: clamp(Math.max(y1, y2), maxH) - top }
}

/** Canvas size after turning by a multiple of 90°. */
export function rotatedSize(width: number, height: number, quarterTurns: number): { width: number; height: number } {
  return Math.abs(quarterTurns) % 2 === 1 ? { width: height, height: width } : { width, height }
}

/** New size for a target width, keeping the aspect ratio; never below 1 px. */
export function scaledSize(width: number, height: number, targetWidth: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(targetWidth))
  return { width: w, height: Math.max(1, Math.round((height * w) / width)) }
}

/** Colour adjustments in CSS filter units. */
export interface Adjustments {
  /** Percent, 100 = unchanged. */
  brightness: number
  contrast: number
  saturation: number
  /** Degrees. */
  hue: number
  grayscale: boolean
  sepia: boolean
  invert: boolean
}

export const NEUTRAL: Adjustments = { brightness: 100, contrast: 100, saturation: 100, hue: 0, grayscale: false, sepia: false, invert: false }

export function isNeutral(a: Adjustments): boolean {
  return (Object.keys(NEUTRAL) as (keyof Adjustments)[]).every((k) => a[k] === NEUTRAL[k])
}

/** The adjustments as a canvas `filter` string ('none' when nothing changes). */
export function filterString(a: Adjustments): string {
  if (isNeutral(a)) return 'none'
  const parts = [`brightness(${a.brightness}%)`, `contrast(${a.contrast}%)`, `saturate(${a.saturation}%)`, `hue-rotate(${a.hue}deg)`]
  if (a.grayscale) parts.push('grayscale(1)')
  if (a.sepia) parts.push('sepia(1)')
  if (a.invert) parts.push('invert(1)')
  return parts.join(' ')
}
