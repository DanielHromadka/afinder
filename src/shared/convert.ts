// Format conversion from the context menu: which files can be converted, to what, and under which name.
// Images are re-encoded by Chromium (canvas), videos by Mediabunny + WebCodecs; both run in the renderer.

import { extensionOf } from './preview'

export type ConvertKind = 'image' | 'video'

/** Targets in menu order; the extension is also the format's id. */
export const IMAGE_TARGETS = ['png', 'jpg', 'webp'] as const
export const VIDEO_TARGETS = ['mp4', 'webm', 'mov'] as const
export type ImageTarget = (typeof IMAGE_TARGETS)[number]
export type VideoTarget = (typeof VIDEO_TARGETS)[number]
export type ConvertTarget = ImageTarget | VideoTarget

/** Chromium decodes these itself; HEIC and TIFF go through the system's decoder (macOS, Windows). */
const IMAGE_SOURCES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico', 'heic', 'heif', 'tif', 'tiff'])
/** Containers Mediabunny reads. */
const VIDEO_SOURCES = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv'])
/** Same format under another extension: no point converting a .jpeg to .jpg. */
const SAME: Record<string, string> = { jpeg: 'jpg', m4v: 'mp4' }

export function convertKind(name: string): ConvertKind | null {
  const ext = extensionOf(name)
  return IMAGE_SOURCES.has(ext) ? 'image' : VIDEO_SOURCES.has(ext) ? 'video' : null
}

export const isVideoTarget = (ext: string): ext is VideoTarget => (VIDEO_TARGETS as readonly string[]).includes(ext)

/** Sound taken out of a video: AAC in MP4, Opus in Ogg, or uncompressed WAV. */
export const AUDIO_TARGETS = ['m4a', 'ogg', 'wav'] as const
export type AudioTarget = (typeof AUDIO_TARGETS)[number]
export const isAudioTarget = (ext: string): ext is AudioTarget => (AUDIO_TARGETS as readonly string[]).includes(ext)

/** What a selection converts to: all of one kind, minus the format they all already have. Null when mixed. */
export function convertTargets(names: string[]): { kind: ConvertKind; targets: ConvertTarget[] } | null {
  if (names.length === 0) return null
  const kind = convertKind(names[0])
  if (!kind || names.some((n) => convertKind(n) !== kind)) return null
  const own = new Set(names.map((n) => SAME[extensionOf(n)] ?? extensionOf(n)))
  const all: readonly ConvertTarget[] = kind === 'image' ? IMAGE_TARGETS : VIDEO_TARGETS
  const targets = own.size === 1 ? all.filter((x) => !own.has(x)) : [...all]
  return targets.length ? { kind, targets } : null
}

/** `clip.mov` → `clip.mp4`, then `clip 2.mp4` … – the first name not taken (like a new file). */
export function convertedName(name: string, ext: string, taken: (name: string) => boolean): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  for (let n = 1; ; n++) {
    const candidate = `${stem}${n > 1 ? ` ${n}` : ''}.${ext}`
    if (!taken(candidate)) return candidate
  }
}
