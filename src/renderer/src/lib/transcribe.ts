// The renderer half of speech to text: Mediabunny decodes the file's first audio track, the samples are
// brought to 16 kHz mono and sent to main in 30 s windows, one at a time (main's worker runs Whisper).

import { remix } from '@shared/media'
import { previewUrl } from '@shared/preview'
import { CHUNK_SAMPLES, SAMPLE_RATE, type WhisperModel } from '@shared/whisper'
import { t } from '@shared/i18n'

const api = window.api

export interface TranscribeOptions {
  model: WhisperModel
  /** Null: detected from the first window. */
  language: string | null
  format: 'srt' | 'txt'
}

/** Transcribes the file and writes `name.srt` / `name.txt` next to it; returns the new file's path. */
export async function transcribeFile(path: string, o: TranscribeOptions, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string> {
  const { ALL_FORMATS, AudioSampleSink, Input, UrlSource } = await import('mediabunny')
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(previewUrl(path)) })
  let id: string | null = null
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) throw new Error(t('extract.noAudio'))
    const duration = (await input.computeDuration()) || 1
    id = await api.transcribe.begin(path, o.model, o.language)
    const window = new Float32Array(CHUNK_SAMPLES)
    let filled = 0
    let offset = 0
    const send = async (): Promise<void> => {
      if (filled === 0) return
      await api.transcribe.chunk(id!, window.slice(0, filled), offset)
      offset += filled / SAMPLE_RATE
      filled = 0
      onProgress(Math.min(1, offset / duration))
    }
    for await (const sample of new AudioSampleSink(track).samples()) {
      let mono: Float32Array
      try {
        signal.throwIfAborted()
        const planes = Array.from({ length: sample.numberOfChannels }, (_, c) => {
          const plane = new Float32Array(sample.numberOfFrames)
          sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
          return plane
        })
        mono = remix(planes, sample.sampleRate, SAMPLE_RATE, 1)[0]
      } finally {
        sample.close()
      }
      for (let at = 0; at < mono.length; ) {
        const take = Math.min(mono.length - at, CHUNK_SAMPLES - filled)
        window.set(mono.subarray(at, at + take), filled)
        filled += take
        at += take
        if (filled === CHUNK_SAMPLES) await send()
        signal.throwIfAborted()
      }
    }
    await send()
    signal.throwIfAborted()
    const { path: saved } = await api.transcribe.finish(id, o.format)
    id = null
    return saved
  } catch (err) {
    if (id) await api.transcribe.abort(id).catch(() => {})
    throw signal.aborted ? new DOMException('Aborted', 'AbortError') : err
  } finally {
    input.dispose()
  }
}
