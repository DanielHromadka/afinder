// Pure helpers for the video cutter in Quick Look: which videos it opens, and the timeline arithmetic
// (trimmed ends and cut-out pieces → the parts that stay). Shared so that main and the tests use the same rules.

import { extensionOf } from './preview'

/** A stretch of the source timeline, in seconds. */
export interface Span {
  start: number
  end: number
}

/** What the user did: where the video starts and ends, and the pieces cut out in between. */
export interface VideoCut {
  trim: Span
  cuts: Span[]
}

/** Containers Mediabunny reads and writes; the copy keeps the source's own container. */
const CUTTABLE = new Set(['mp4', 'm4v', 'mov', 'webm'])

/** Anything shorter is a stray click, not a piece to keep or remove. */
export const MIN_SPAN = 0.05

export function canCutVideo(name: string): boolean {
  return CUTTABLE.has(extensionOf(name))
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Sorted, merged spans inside [0, duration]; empty and stray ones dropped. */
export function normalizeSpans(spans: Span[], duration: number): Span[] {
  const sorted = spans
    .map((s) => ({ start: clamp(Math.min(s.start, s.end), 0, duration), end: clamp(Math.max(s.start, s.end), 0, duration) }))
    .filter((s) => s.end - s.start >= MIN_SPAN)
    .sort((a, b) => a.start - b.start)
  const merged: Span[] = []
  for (const s of sorted) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }
  return merged
}

/** Adds a piece to cut out; it merges with the ones it touches. */
export function addCut(cuts: Span[], span: Span, duration: number): Span[] {
  return normalizeSpans([...cuts, span], duration)
}

/** The parts of the source that end up in the output, in order. */
export function keptSpans(edit: VideoCut, duration: number): Span[] {
  const start = clamp(edit.trim.start, 0, duration)
  const end = clamp(edit.trim.end, start, duration)
  const kept: Span[] = []
  let at = start
  for (const c of normalizeSpans(edit.cuts, duration)) {
    if (c.end <= at) continue
    if (c.start >= end) break
    if (c.start > at) kept.push({ start: at, end: c.start })
    at = Math.max(at, c.end)
  }
  if (end > at) kept.push({ start: at, end })
  return kept.filter((s) => s.end - s.start >= MIN_SPAN)
}

export function totalLength(spans: Span[]): number {
  return spans.reduce((sum, s) => sum + (s.end - s.start), 0)
}

/** Where playback should jump to when it reaches `time`: the end of the removed stretch, or null to go on. */
export function skipTarget(edit: VideoCut, duration: number, time: number): number | null {
  const kept = keptSpans(edit, duration)
  if (kept.length === 0 || kept.some((s) => time >= s.start && time < s.end)) return null
  const next = kept.find((s) => s.start > time)
  return next ? next.start : null
}

/** Whether the edit leaves the video as it was. */
export function isUncut(edit: VideoCut, duration: number): boolean {
  const kept = keptSpans(edit, duration)
  return kept.length === 1 && kept[0].start < MIN_SPAN && duration - kept[0].end < MIN_SPAN
}

/** `75.25` → `1:15.2`, `3725` → `1:02:05.0`. */
export function formatVideoTime(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6))
  const s = Math.floor(tenths / 10)
  const frac = tenths % 10
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}.${frac}` : `${m}:${sec}.${frac}`
}
