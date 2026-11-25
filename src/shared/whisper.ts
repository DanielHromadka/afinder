// The parts of Whisper speech recognition that are plain arithmetic: the log-mel spectrogram the encoder
// reads (as WhisperFeatureExtractor makes it: 16 kHz, 25 ms Hann windows every 10 ms, Slaney mel filters),
// choosing the next token with the timestamp rules, turning timestamp tokens into segments, and SRT.
// Shared by the transcription worker and the tests.

export const SAMPLE_RATE = 16000
export const CHUNK_SECONDS = 30
export const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS
const N_FFT = 400
const HOP = 160
export const N_FRAMES = CHUNK_SAMPLES / HOP
/** Seconds per timestamp token step. */
export const TIME_STEP = 0.02

/** The models aFinder offers, pinned to a revision; files are fetched only from the download button. */
export const WHISPER_MODELS = {
  base: { repo: 'onnx-community/whisper-base', revision: '1846881b6b3a3024392c1eea3ad983695bc23925', megabytes: 80 },
  small: { repo: 'onnx-community/whisper-small', revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732', megabytes: 250 }
} as const
export type WhisperModel = keyof typeof WHISPER_MODELS
export const WHISPER_FILES = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']
export const isWhisperModel = (v: unknown): v is WhisperModel => v === 'base' || v === 'small'

/** Languages offered in the dialog (Whisper knows ~100; these are the likely ones). Null: detect. */
export const TRANSCRIBE_LANGUAGES = ['cs', 'sk', 'en', 'de', 'es', 'fr', 'it', 'pl', 'uk', 'ru', 'pt', 'nl', 'hu'] as const
export const isTranscribeLanguage = (v: unknown): v is (typeof TRANSCRIBE_LANGUAGES)[number] => (TRANSCRIBE_LANGUAGES as readonly unknown[]).includes(v)

// ---- features ----------------------------------------------------------------------------------------

const hzToMel = (f: number): number => (f < 1000 ? (3 * f) / 200 : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27))
const melToHz = (m: number): number => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)))

/** Slaney-normalised triangular mel filters, nMels × (N_FFT/2 + 1), as librosa.filters.mel makes them. */
export function melFilters(nMels: number): Float32Array {
  const bins = N_FFT / 2 + 1
  const out = new Float32Array(nMels * bins)
  const top = hzToMel(SAMPLE_RATE / 2)
  const points = Array.from({ length: nMels + 2 }, (_, i) => melToHz((top * i) / (nMels + 1)))
  for (let m = 0; m < nMels; m++) {
    const [lo, mid, hi] = [points[m], points[m + 1], points[m + 2]]
    const norm = 2 / (hi - lo)
    for (let k = 0; k < bins; k++) {
      const f = (k * SAMPLE_RATE) / N_FFT
      const w = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)))
      out[m * bins + k] = w * norm
    }
  }
  return out
}

let tables: { cos: Float32Array; sin: Float32Array; window: Float32Array } | null = null
function dftTables(): NonNullable<typeof tables> {
  if (tables) return tables
  const bins = N_FFT / 2 + 1
  const cos = new Float32Array(bins * N_FFT)
  const sin = new Float32Array(bins * N_FFT)
  for (let k = 0; k < bins; k++)
    for (let n = 0; n < N_FFT; n++) {
      cos[k * N_FFT + n] = Math.cos((2 * Math.PI * k * n) / N_FFT)
      sin[k * N_FFT + n] = Math.sin((2 * Math.PI * k * n) / N_FFT)
    }
  // Periodic Hann window, as torch.hann_window.
  const window = Float32Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT))
  return (tables = { cos, sin, window })
}

/**
 * The encoder's input for up to 30 s of 16 kHz mono audio: nMels × 3000 log-mel values. The audio is
 * zero-padded to 30 s and reflect-padded at both ends (centre framing), and the last frame is dropped.
 */
export function logMel(samples: Float32Array, filters: Float32Array, nMels: number): Float32Array {
  const audio = new Float32Array(CHUNK_SAMPLES)
  audio.set(samples.subarray(0, CHUNK_SAMPLES))
  const pad = N_FFT / 2
  const padded = new Float32Array(CHUNK_SAMPLES + 2 * pad)
  padded.set(audio, pad)
  for (let i = 1; i <= pad; i++) {
    padded[pad - i] = audio[i]
    padded[pad + CHUNK_SAMPLES - 1 + i] = audio[CHUNK_SAMPLES - 1 - i]
  }
  const { cos, sin, window } = dftTables()
  const bins = N_FFT / 2 + 1
  const power = new Float32Array(bins)
  const frame = new Float32Array(N_FFT)
  const mel = new Float32Array(nMels * N_FRAMES)
  let max = -Infinity
  for (let t = 0; t < N_FRAMES; t++) {
    const start = t * HOP
    for (let n = 0; n < N_FFT; n++) frame[n] = padded[start + n] * window[n]
    for (let k = 0; k < bins; k++) {
      let re = 0
      let im = 0
      const row = k * N_FFT
      for (let n = 0; n < N_FFT; n++) {
        re += frame[n] * cos[row + n]
        im -= frame[n] * sin[row + n]
      }
      power[k] = re * re + im * im
    }
    for (let m = 0; m < nMels; m++) {
      let sum = 0
      const row = m * bins
      for (let k = 0; k < bins; k++) sum += filters[row + k] * power[k]
      const v = Math.log10(Math.max(sum, 1e-10))
      mel[m * N_FRAMES + t] = v
      if (v > max) max = v
    }
  }
  for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], max - 8) + 4) / 4
  return mel
}

// ---- decoding ----------------------------------------------------------------------------------------

export interface TokenIds {
  endOfText: number
  /** First timestamp token (<|0.00|>); every later id is TIME_STEP more. */
  timestampBegin: number
  /** Tokens never generated (special tokens, from generation_config.suppress_tokens). */
  suppress: Set<number>
  /** Not allowed as the first text token (a space, end of text). */
  beginSuppress: Set<number>
}

/**
 * The next token by greedy choice under Whisper's timestamp rules: the first token is a timestamp (at
 * most 1 s in), timestamps come in pairs and never go back, and when timestamps are more likely together
 * than any single text token, a timestamp is taken.
 */
export function nextToken(logits: Float32Array, generated: number[], ids: TokenIds): number {
  const l = Float32Array.from(logits)
  const vocab = l.length
  for (const s of ids.suppress) if (s < vocab) l[s] = -Infinity
  const { timestampBegin: tb, endOfText } = ids
  const n = generated.length
  if (n === 0) {
    for (const s of ids.beginSuppress) if (s < vocab) l[s] = -Infinity
    // Text cannot start the window, and the first timestamp is within its first second.
    for (let i = 0; i < tb; i++) l[i] = -Infinity
    for (let i = tb + 50 + 1; i < vocab; i++) l[i] = -Infinity
  } else {
    const lastTime = generated[n - 1] >= tb
    const penultimateTime = n < 2 || generated[n - 2] >= tb
    if (lastTime) {
      // After a closing timestamp comes text (or the end); after an opening one, no text before its close.
      if (penultimateTime) for (let i = tb; i < vocab; i++) l[i] = -Infinity
      else for (let i = 0; i < endOfText; i++) l[i] = -Infinity
    }
    // Timestamps never go back (nor repeat, except the one closing a pair).
    let lastStamp = -1
    for (let i = n - 1; i >= 0; i--)
      if (generated[i] >= tb) {
        lastStamp = generated[i]
        break
      }
    if (lastStamp >= 0) {
      const floor = lastTime && !penultimateTime ? lastStamp : lastStamp + 1
      for (let i = tb; i < Math.min(floor, vocab); i++) l[i] = -Infinity
    }
  }
  // Timestamps together more likely than the best text token: take the best timestamp.
  let maxText = -Infinity
  for (let i = 0; i < tb; i++) if (l[i] > maxText) maxText = l[i]
  let best = -1
  let bestValue = -Infinity
  let sum = 0
  let top = -Infinity
  for (let i = 0; i < vocab; i++) if (l[i] > top) top = l[i]
  for (let i = tb; i < vocab; i++) {
    if (l[i] === -Infinity) continue
    sum += Math.exp(l[i] - top)
    if (l[i] > bestValue) {
      bestValue = l[i]
      best = i
    }
  }
  if (best >= 0 && Math.log(sum) + top > maxText) return best
  let pick = 0
  for (let i = 1; i < vocab; i++) if (l[i] > l[pick]) pick = i
  return pick
}

export interface Segment {
  /** Seconds from the start of the file. */
  start: number
  end: number
  text: string
}

/**
 * Timestamped tokens of one 30 s window to segments (text decoded by the caller), moved by `offset`
 * seconds; a segment left open at the end closes at the window's end.
 */
export function segmentsOf(tokens: number[], timestampBegin: number, offset: number, windowSeconds: number, decodeIds: (ids: number[]) => string): Segment[] {
  // Tokenizers refuse empty input.
  const decode = (ids: number[]): string => (ids.length ? decodeIds(ids) : '')
  const out: Segment[] = []
  let start: number | null = null
  let text: number[] = []
  for (const tok of tokens) {
    if (tok >= timestampBegin) {
      const at = (tok - timestampBegin) * TIME_STEP
      if (start === null) start = at
      else {
        const s = decode(text).trim()
        if (s) out.push({ start: offset + start, end: offset + at, text: s })
        start = null
        text = []
      }
    } else if (start !== null) text.push(tok)
    else {
      // Text without an opening timestamp: it continues from the previous segment's end.
      start = out.length ? out[out.length - 1].end - offset : 0
      text.push(tok)
    }
  }
  const rest = decode(text).trim()
  if (rest) out.push({ start: offset + (start ?? 0), end: offset + windowSeconds, text: rest })
  return out
}

/** `00:01:02,345`. */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

export function toSrt(segments: Segment[]): string {
  return segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(Math.max(s.end, s.start + 0.5))}\n${s.text}\n`).join('\n')
}

/** Plain text: the segments as paragraphs, joined where a sentence goes on. */
export function toText(segments: Segment[]): string {
  return (
    segments
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/([.!?…])\s+/g, '$1\n')
      .trim() + '\n'
  )
}
