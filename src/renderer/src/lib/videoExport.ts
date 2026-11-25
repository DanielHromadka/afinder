// Videos made in the renderer: the kept parts of a cut, and format conversions. Mediabunny reads the
// source through the preview protocol (HTTP ranges), WebCodecs decodes and re-encodes, and the container
// is streamed to main in positioned chunks. Loaded on first use, like the editor itself.

import {
  ALL_FORMATS,
  AudioSample,
  CanvasSink,
  Conversion,
  AudioSampleSink,
  AudioSampleSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  MovOutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  StreamTarget,
  UrlSource,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WavOutputFormat,
  WebMOutputFormat,
  type AudioCodec,
  type InputAudioTrack,
  type OutputFormat,
  type StreamTargetChunk,
  type VideoCodec
} from 'mediabunny'
import { t } from '@shared/i18n'
import { extensionOf, previewUrl } from '@shared/preview'
import { remix } from '@shared/media'
import { totalLength, type Span } from '@shared/videoCut'

const api = window.api

/** Chunks sent to main; MP4 header patches come as small extra ones. */
const CHUNK_BYTES = 8 * 1024 * 1024

function formatFor(name: string): OutputFormat {
  const ext = extensionOf(name)
  return ext === 'webm' ? new WebMOutputFormat() : ext === 'mov' ? new MovOutputFormat() : new Mp4OutputFormat()
}

/** The source codec first, so a cut changes as little as possible. */
const preferring = <T extends string>(own: T | null, list: T[]): T[] => (own && list.includes(own) ? [own, ...list.filter((c) => c !== own)] : list)

/** Writes the spans of the video at path, back to back, as `name (cut).ext`. */
export async function exportCut(path: string, spans: Span[], onProgress: (fraction: number) => void, signal: AbortSignal): Promise<{ path: string; modified: number }> {
  const total = totalLength(spans)
  if (spans.length === 0 || total <= 0) throw new Error(t('videoEditor.nothingLeft'))
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(path)) })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video || !(await video.canDecode())) throw new Error(t('videoEditor.cannotDecode'))
    const format = formatFor(path)
    const quality = new Quality('high')
    const videoCodec = await getFirstEncodableVideoCodec(preferring<VideoCodec>(video.codec, format.getSupportedVideoCodecs()), {
      width: video.codedWidth,
      height: video.codedHeight,
      quality
    })
    if (!videoCodec) throw new Error(t('videoEditor.cannotDecode'))
    const audio = await usableAudio(input, format)

    const id = await api.preview.writeVideo.begin(path)
    const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => api.preview.writeVideo.write(id, chunk.position, chunk.data) })
    const output = new Output({ format, target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_BYTES }) })
    const videoSource = new VideoSampleSource({ codec: videoCodec, quality })
    // Decoded frames keep their raw orientation, so the track carries the source's rotation as metadata.
    output.addVideoTrack(videoSource, { rotation: await video.getRotation(), flip: await video.getFlip() })
    const audioSource = audio ? new AudioSampleSource({ codec: audio.codec, quality: new Quality('high') }) : null
    if (audio && audioSource) output.addAudioTrack(audioSource)
    const stop = (): void => void output.cancel()
    signal.addEventListener('abort', stop)
    try {
      await output.start()
      // Audio is cheap and runs ahead; the muxer holds its packets until video catches up.
      await Promise.all([
        pumpVideo(new VideoSampleSink(video), videoSource, spans, signal, (at) => onProgress(Math.min(1, at / total))),
        audio && audioSource ? pumpAudio(new AudioSampleSink(audio.track), audioSource, spans, signal) : null
      ])
      signal.throwIfAborted()
      await output.finalize()
      return await api.preview.writeVideo.finish(id)
    } catch (err) {
      await output.cancel().catch(() => {})
      await api.preview.writeVideo.abort(id).catch(() => {})
      throw signal.aborted ? new DOMException('Aborted', 'AbortError') : err
    } finally {
      signal.removeEventListener('abort', stop)
    }
  } finally {
    input.dispose()
  }
}

/**
 * Converts the video at path into another container (mp4, webm, mov) as `name.<target>` next to it.
 * Packets are copied where the target can hold the source's codecs (MP4 ↔ MOV), else re-encoded.
 */
export async function convertVideo(path: string, target: string, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<{ path: string; modified: number }> {
  signal.throwIfAborted()
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(path)) })
  let id: string | null = null
  try {
    const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => api.preview.writeVideo.write(id!, chunk.position, chunk.data) })
    const output = new Output({ format: formatFor(`video.${target}`), target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_BYTES }) })
    const conversion = await Conversion.init({ input, output, tracks: 'primary', showWarnings: false })
    // Without a video track the result would be just sound under a video extension.
    if (!conversion.isValid || !conversion.utilizedTracks.some((track) => track.type === 'video')) throw new Error(t('videoEditor.cannotDecode'))
    id = await api.preview.writeVideo.begin(path, target)
    conversion.onProgress = (fraction) => onProgress(fraction)
    const stop = (): void => void conversion.cancel()
    signal.addEventListener('abort', stop)
    try {
      await conversion.execute()
    } finally {
      signal.removeEventListener('abort', stop)
    }
    signal.throwIfAborted()
    const saved = await api.preview.writeVideo.finish(id)
    id = null
    return saved
  } catch (err) {
    if (id) await api.preview.writeVideo.abort(id).catch(() => {})
    throw signal.aborted ? new DOMException('Aborted', 'AbortError') : err
  } finally {
    input.dispose()
  }
}

/** The primary audio track and a codec to write it with; null drops audio (none, or nothing can encode it). */
async function usableAudio(input: Input, format: OutputFormat): Promise<{ track: InputAudioTrack; codec: AudioCodec } | null> {
  const track = await input.getPrimaryAudioTrack()
  if (!track || !(await track.canDecode())) return null
  const codec = await getFirstEncodableAudioCodec(preferring<AudioCodec>(track.codec, format.getSupportedAudioCodecs()), {
    numberOfChannels: track.numberOfChannels,
    sampleRate: track.sampleRate
  })
  return codec ? { track, codec } : null
}

/** Frames inside the spans, clipped to them and moved so that the spans follow each other. */
async function pumpVideo(sink: VideoSampleSink, source: VideoSampleSource, spans: Span[], signal: AbortSignal, onAt: (at: number) => void): Promise<void> {
  let base = 0
  for (const span of spans) {
    for await (const sample of sink.samples(span.start, span.end)) {
      try {
        if (signal.aborted) return
        const from = Math.max(span.start, sample.timestamp)
        const to = Math.min(span.end, sample.timestamp + sample.duration)
        if (to <= from) continue
        sample.setTimestamp(base + from - span.start)
        sample.setDuration(to - from)
        await source.add(sample)
        onAt(base + to - span.start)
      } finally {
        sample.close()
      }
    }
    base += span.end - span.start
  }
  source.close()
}

/** Audio chunks inside the spans; the ones crossing an edge are trimmed to the frame. */
async function pumpAudio(sink: AudioSampleSink, source: AudioSampleSource, spans: Span[], signal: AbortSignal): Promise<void> {
  let base = 0
  for (const span of spans) {
    for await (const sample of sink.samples(span.start, span.end)) {
      let part = sample
      try {
        if (signal.aborted) return
        const from = Math.max(span.start, sample.timestamp)
        const to = Math.min(span.end, sample.timestamp + sample.duration)
        if (to <= from) continue
        const first = Math.max(0, Math.round((from - sample.timestamp) * sample.sampleRate))
        const last = Math.min(sample.numberOfFrames, Math.round((to - sample.timestamp) * sample.sampleRate))
        if (last <= first) continue
        if (first > 0 || last < sample.numberOfFrames) part = sample.trim(first, last)
        part.setTimestamp(base + from - span.start)
        await source.add(part)
      } finally {
        if (part !== sample) part.close()
        sample.close()
      }
    }
    base += span.end - span.start
  }
  source.close()
}

/** The sound of the video at path as `name.m4a` (AAC), `name.ogg` (Opus) or `name.wav` next to it. */
export async function extractAudio(path: string, target: string, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<{ path: string; modified: number }> {
  signal.throwIfAborted()
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(path)) })
  let id: string | null = null
  try {
    const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => api.preview.writeVideo.write(id!, chunk.position, chunk.data) })
    const format = target === 'wav' ? new WavOutputFormat() : target === 'ogg' ? new OggOutputFormat() : new Mp4OutputFormat()
    const output = new Output({ format, target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_BYTES }) })
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { discard: true },
      audio: target === 'ogg' ? { codec: 'opus' } : target === 'm4a' ? { codec: 'aac' } : undefined,
      showWarnings: false
    })
    if (!conversion.isValid || !conversion.utilizedTracks.some((track) => track.type === 'audio')) throw new Error(t('extract.noAudio'))
    id = await api.preview.writeVideo.begin(path, target)
    conversion.onProgress = (fraction) => onProgress(fraction)
    const stop = (): void => void conversion.cancel()
    signal.addEventListener('abort', stop)
    try {
      await conversion.execute()
    } finally {
      signal.removeEventListener('abort', stop)
    }
    signal.throwIfAborted()
    const saved = await api.preview.writeVideo.finish(id)
    id = null
    return saved
  } catch (err) {
    if (id) await api.preview.writeVideo.abort(id).catch(() => {})
    throw signal.aborted ? new DOMException('Aborted', 'AbortError') : err
  } finally {
    input.dispose()
  }
}

/**
 * Joins videos one after another into an MP4 named after the first (`name (joined).mp4`). Every frame is
 * drawn at the first video's size (others are letterboxed), and the sound is brought to one sample rate
 * and channel count; a clip without sound gets silence, so picture and sound stay together.
 */
export async function mergeVideos(paths: string[], onProgress: (fraction: number) => void, signal: AbortSignal): Promise<{ path: string; modified: number }> {
  const inputs = paths.map((p) => new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(p)) }))
  let id: string | null = null
  try {
    const clips = await Promise.all(
      inputs.map(async (input) => {
        const video = await input.getPrimaryVideoTrack()
        if (!video || !(await video.canDecode())) throw new Error(t('videoEditor.cannotDecode'))
        const audio = await input.getPrimaryAudioTrack()
        const start = await video.getFirstTimestamp()
        const duration = (await input.computeDuration()) - start
        return { video, audio: audio && (await audio.canDecode()) ? audio : null, start, duration }
      })
    )
    const total = clips.reduce((n, c) => n + c.duration, 0)
    // Even sizes: H.264 encoders refuse odd ones.
    const width = clips[0].video.displayWidth & ~1
    const height = clips[0].video.displayHeight & ~1
    const format = new Mp4OutputFormat()
    const quality = new Quality('high')
    const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height, quality })
    if (!videoCodec) throw new Error(t('videoEditor.cannotDecode'))
    const withSound = clips.find((c) => c.audio)?.audio ?? null
    const rate = withSound?.sampleRate ?? 48000
    const channels = Math.min(2, withSound?.numberOfChannels ?? 2)
    const audioCodec = withSound ? await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), { numberOfChannels: channels, sampleRate: rate }) : null

    id = await api.preview.writeVideo.begin(paths[0], 'mp4', true)
    const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => api.preview.writeVideo.write(id!, chunk.position, chunk.data) })
    const output = new Output({ format, target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_BYTES }) })
    const videoSource = new VideoSampleSource({ codec: videoCodec, quality })
    output.addVideoTrack(videoSource)
    const audioSource = audioCodec ? new AudioSampleSource({ codec: audioCodec, quality: new Quality('high') }) : null
    if (audioSource) output.addAudioTrack(audioSource)
    const stop = (): void => void output.cancel()
    signal.addEventListener('abort', stop)
    try {
      await output.start()
      let base = 0
      for (const clip of clips) {
        const sink = new CanvasSink(clip.video, { width, height, fit: 'contain', poolSize: 2 })
        const pictures = (async () => {
          for await (const frame of sink.canvases()) {
            if (signal.aborted) return
            const at = frame.timestamp - clip.start
            if (at < 0 || at >= clip.duration) continue
            const sample = new VideoSample(frame.canvas, { timestamp: base + at, duration: frame.duration })
            try {
              await videoSource.add(sample)
            } finally {
              sample.close()
            }
            onProgress(Math.min(1, (base + at) / total))
          }
        })()
        const sound = audioSource ? addClipAudio(audioSource, clip.audio, clip.start, clip.duration, base, rate, channels, signal) : null
        await Promise.all([pictures, sound])
        base += clip.duration
      }
      videoSource.close()
      audioSource?.close()
      signal.throwIfAborted()
      await output.finalize()
    } catch (err) {
      await output.cancel().catch(() => {})
      throw err
    } finally {
      signal.removeEventListener('abort', stop)
    }
    const saved = await api.preview.writeVideo.finish(id)
    id = null
    return saved
  } catch (err) {
    if (id) await api.preview.writeVideo.abort(id).catch(() => {})
    throw signal.aborted ? new DOMException('Aborted', 'AbortError') : err
  } finally {
    for (const input of inputs) input.dispose()
  }
}

/** One clip's sound at the joined rate and channels, moved to `base`; silence when it has none. */
async function addClipAudio(source: AudioSampleSource, track: InputAudioTrack | null, start: number, duration: number, base: number, rate: number, channels: number, signal: AbortSignal): Promise<void> {
  const silence = async (from: number, seconds: number): Promise<void> => {
    // In one-second pieces, so no single buffer gets large.
    for (let at = 0; at < seconds; at += 1) {
      const frames = Math.round(Math.min(1, seconds - at) * rate)
      if (frames <= 0) break
      const sample = new AudioSample({ data: new Float32Array(frames * channels), format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: from + at })
      try {
        await source.add(sample)
      } finally {
        sample.close()
      }
    }
  }
  if (!track) return silence(base, duration)
  let written = 0
  for await (const sample of new AudioSampleSink(track).samples()) {
    try {
      if (signal.aborted) return
      const at = sample.timestamp - start
      if (at >= duration) break
      if (at < 0) continue
      const planes = Array.from({ length: sample.numberOfChannels }, (_, c) => {
        const plane = new Float32Array(sample.numberOfFrames)
        sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
        return plane
      })
      const out = remix(planes, sample.sampleRate, rate, channels)
      const data = new Float32Array(out[0].length * channels)
      out.forEach((p, c) => data.set(p, c * p.length))
      const converted = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: base + at })
      try {
        await source.add(converted)
      } finally {
        converted.close()
      }
      written = at + out[0].length / rate
    } finally {
      sample.close()
    }
  }
  // A track that ends before the picture is padded, so the next clip starts in sync.
  if (written < duration - 0.05) await silence(base + written, duration - written)
}
