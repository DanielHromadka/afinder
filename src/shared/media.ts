// Pure helpers for audio and video details: codec names people know, durations and bit rates as text.

const VIDEO_CODECS: Record<string, string> = { avc: 'H.264', hevc: 'H.265 (HEVC)', vp8: 'VP8', vp9: 'VP9', av1: 'AV1' }
const AUDIO_CODECS: Record<string, string> = { aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', eac3: 'E-AC-3', dts: 'DTS', ulaw: 'G.711 µ-law', alaw: 'G.711 A-law' }

export function codecLabel(codec: string | null | undefined): string | undefined {
  if (!codec) return undefined
  if (codec.startsWith('pcm-')) return `PCM ${codec.slice(4).replace(/be$/, ' BE')}`
  return VIDEO_CODECS[codec] ?? AUDIO_CODECS[codec] ?? codec.toUpperCase()
}

/** 75 → `1:15`, 3725 → `1:02:05`; seconds are floored, as players show them. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** Bits per second → `320 kb/s`, `12.4 Mb/s`. */
export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return ''
  return bps >= 1e6 ? `${Number((bps / 1e6).toFixed(1))} Mb/s` : `${Math.round(bps / 1000)} kb/s`
}

/** 29.97, 25, 59.94 – frame rates with at most two decimals. */
export const formatFps = (fps: number): string => `${Number(fps.toFixed(2))} fps`

/** Channel count as a name: mono, stereo, 5.1 … (the key of an i18n string for the first two). */
export const channelsLabel = (n: number): string => (n === 6 ? '5.1' : n === 8 ? '7.1' : String(n))

/** Local date and time of a timestamp in the form EXIF dates are kept in: `YYYY-MM-DDTHH:MM:SS`. */
export function localIso(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** A time in a file name (no colons, which Windows refuses): 65.4 → `1m05s`, 3725 → `1h02m05s`. */
export function timeForName(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h ? `${h}h${pad(m)}m${pad(s % 60)}s` : `${m}m${pad(s % 60)}s`
}

/**
 * Adds a chunk of samples (one channel, starting at `timestamp` seconds) to waveform peaks spread over
 * `duration`: each bucket keeps the loudest absolute value it has seen, 0–1.
 */
export function addPeaks(peaks: Float32Array, duration: number, timestamp: number, sampleRate: number, data: Float32Array): void {
  if (duration <= 0 || peaks.length === 0) return
  const perBucket = (duration * sampleRate) / peaks.length
  const first = timestamp * sampleRate
  for (let i = 0; i < data.length; i++) {
    const bucket = Math.floor((first + i) / perBucket)
    if (bucket < 0) continue
    if (bucket >= peaks.length) break
    const v = Math.abs(data[i])
    if (v > peaks[bucket]) peaks[bucket] = Math.min(1, v)
  }
}

/**
 * Audio planes brought to another channel count and sample rate (linear interpolation), for joining
 * clips recorded differently. Mono is copied to every channel; more channels fold down by averaging.
 */
export function remix(planes: Float32Array[], fromRate: number, toRate: number, toChannels: number): Float32Array[] {
  const frames = planes[0]?.length ?? 0
  const mixed: Float32Array[] = Array.from({ length: toChannels }, (_, c) => {
    if (planes.length === toChannels) return planes[c]
    if (planes.length === 1) return planes[0]
    if (toChannels === 1) {
      const out = new Float32Array(frames)
      for (const p of planes) for (let i = 0; i < frames; i++) out[i] += p[i] / planes.length
      return out
    }
    return planes[c % planes.length]
  })
  if (fromRate === toRate) return mixed
  const length = Math.max(1, Math.round((frames * toRate) / fromRate))
  return mixed.map((p) => {
    const out = new Float32Array(length)
    const ratio = fromRate / toRate
    for (let i = 0; i < length; i++) {
      const x = i * ratio
      const a = Math.floor(x)
      const b = Math.min(frames - 1, a + 1)
      const f = x - a
      out[i] = (p[Math.min(a, frames - 1)] ?? 0) * (1 - f) + (p[b] ?? 0) * f
    }
    return out
  })
}
