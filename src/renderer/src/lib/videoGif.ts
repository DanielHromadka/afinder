// A stretch of video as an animated GIF: Mediabunny decodes frames at the chosen size and rate, one
// palette is built from all of them, and the GIF encoder writes the result. Loaded on first use.

import { encodeGif, indexPixels, medianCut, paletteLookup, samplePixels, type GifOptions } from '@shared/gif'
import { t } from '@shared/i18n'
import { previewUrl } from '@shared/preview'

/** Frames kept in memory at most (30 s at 10 fps); longer requests are cut short. */
const MAX_FRAMES = 300

export async function videoToGif(path: string, o: GifOptions, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Uint8Array> {
  const { ALL_FORMATS, CanvasSink, Input, UrlSource } = await import('mediabunny')
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(path)) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) throw new Error(t('videoEditor.cannotDecode'))
    const width = Math.max(16, Math.min(Math.round(o.width), track.displayWidth))
    const height = Math.max(2, Math.round((width * track.displayHeight) / track.displayWidth))
    const first = await track.getFirstTimestamp()
    const end = first + ((await track.getDurationFromMetadata().catch(() => null)) ?? (await track.computeDuration()))
    const fps = Math.max(1, Math.min(30, o.fps))
    const times: number[] = []
    for (let at = first + Math.max(0, o.start); at < Math.min(end, first + o.start + o.length) && times.length < MAX_FRAMES; at += 1 / fps) times.push(at)
    if (times.length === 0) throw new Error(t('gif.outside'))
    const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 2 })
    const frames: Uint8ClampedArray[] = []
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      signal.throwIfAborted()
      if (!frame) continue
      const ctx = frame.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      frames.push(ctx.getImageData(0, 0, width, height).data)
      onProgress((frames.length / times.length) * 0.8)
    }
    if (frames.length === 0) throw new Error(t('videoEditor.cannotDecode'))
    // One palette for all frames, from a sample of each, so colours do not flicker between frames.
    const step = Math.max(1, Math.floor((width * height * frames.length) / 200_000))
    const samples = frames.map((f) => samplePixels(f, step))
    const all = new Uint8Array(samples.reduce((n, s) => n + s.length, 0))
    let at = 0
    for (const s of samples) {
      all.set(s, at)
      at += s.length
    }
    const palette = medianCut(all, 256)
    const lookup = paletteLookup(palette)
    signal.throwIfAborted()
    const indexed = frames.map((f) => indexPixels(f, lookup))
    onProgress(0.95)
    return encodeGif(indexed, width, height, palette, 100 / fps)
  } finally {
    input.dispose()
  }
}
