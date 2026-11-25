import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { addPeaks, formatDuration } from '@shared/media'
import { previewUrl } from '@shared/preview'
import type { FileEntry } from '@shared/types'
import { readMediaDetails, type MediaDetails } from '../lib/mediaInfo'
import { Icon } from './Icon'

/** Bars across the waveform; enough for a wide Quick Look, cheap to draw. */
const BUCKETS = 400

/** Set when a song ended and the next one was selected, so its player starts by itself. */
let autoplayNext = false

/**
 * A song in the preview: cover art and tags, a waveform to see and click to seek (built while the file is
 * decoded, chunk by chunk, so long recordings never sit decoded in memory), and the next song in the
 * folder when this one ends (`onNext`).
 */
export function AudioPlayer({ entry, onNext }: { entry: FileEntry; onNext?: () => void }): React.JSX.Element {
  const audio = useRef<HTMLAudioElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const peaks = useRef<Float32Array>(new Float32Array(BUCKETS))
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [drawn, setDrawn] = useState(0)
  const [autoPlay] = useState(() => {
    const go = autoplayNext
    autoplayNext = false
    return go
  })

  // Tags and cover first (headers only), then the waveform from the decoded samples.
  useEffect(() => {
    let live = true
    let url: string | null = null
    const ctrl = new AbortController()
    void (async () => {
      try {
        const d = await readMediaDetails(entry.path, entry.size)
        if (!live) return
        setDetails(d)
        if (d.cover) {
          url = URL.createObjectURL(new Blob([d.cover.data as BlobPart], { type: d.cover.mimeType }))
          setCover(url)
        }
        if (d.duration) await buildWaveform(entry.path, d.duration, peaks.current, ctrl.signal, () => live && setDrawn((n) => n + 1))
      } catch {
        /* no tags or not decodable: the plain player still works */
      }
    })()
    return () => {
      live = false
      ctrl.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [entry])

  // Redraws on new peaks, on playback progress and when the theme changes the colours.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    c.width = Math.round(w * ratio)
    c.height = Math.round(h * ratio)
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    const style = getComputedStyle(c)
    const played = style.getPropertyValue('--selection').trim() || '#316ac5'
    const rest = style.getPropertyValue('--face-dark').trim() || '#aca899'
    const bar = w / BUCKETS
    const at = duration ? time / duration : 0
    // Quiet recordings are scaled up to the full height.
    const loudest = Math.max(0.05, ...peaks.current)
    for (let i = 0; i < BUCKETS; i++) {
      const v = Math.max(0.02, peaks.current[i] / loudest)
      const bh = v * (h - 2)
      ctx.fillStyle = i / BUCKETS < at ? played : rest
      ctx.fillRect(i * bar, (h - bh) / 2, Math.max(1, bar - 1), bh)
    }
  }, [drawn, time, duration])

  const seek = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const a = audio.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const tags = details?.tags
  return (
    <div className="preview-audio">
      {cover ? <img className="audio-cover" src={cover} alt="" draggable={false} /> : <Icon name="audio" size={96} />}
      {(tags?.title || tags?.artist) && (
        <div className="audio-tags">
          {tags.title && <strong>{tags.title}</strong>}
          {tags.artist && <span>{[tags.artist, tags.album].filter(Boolean).join(' – ')}</span>}
        </div>
      )}
      <canvas ref={canvas} className="audio-wave" title={t('audio.seek')} onClick={seek} />
      <div className="audio-time">
        {formatDuration(time)} / {formatDuration(duration)}
      </div>
      <audio
        ref={audio}
        src={previewUrl(entry.path)}
        controls
        preload="metadata"
        autoPlay={autoPlay}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || details?.duration || 0)}
        onEnded={() => {
          if (!onNext) return
          autoplayNext = true
          onNext()
        }}
      />
    </div>
  )
}

/** Decodes the first audio track chunk by chunk into the peaks, calling `onChunk` now and then to redraw. */
async function buildWaveform(path: string, duration: number, peaks: Float32Array, signal: AbortSignal, onChunk: () => void): Promise<void> {
  const { ALL_FORMATS, AudioSampleSink, Input, UrlSource } = await import('mediabunny')
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(path)) })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return
    let last = performance.now()
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        if (signal.aborted) return
        const buffer = sample.toAudioBuffer()
        addPeaks(peaks, duration, sample.timestamp, buffer.sampleRate, buffer.getChannelData(0))
      } finally {
        sample.close()
      }
      if (performance.now() - last > 150) {
        last = performance.now()
        onChunk()
      }
    }
    onChunk()
  } finally {
    input.dispose()
  }
}
