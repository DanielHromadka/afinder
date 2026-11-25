// Speech to text with Whisper (ONNX, offline) in a worker thread. The renderer decodes the media and sends
// 30 s windows of 16 kHz mono audio; this computes the log-mel features, runs the encoder once and the
// decoder token by token (with its key/value cache), and returns timestamped segments. Models are
// downloaded only on an explicit request, from pinned revisions; transcribing reads local files only.

import path from 'node:path'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline as pipe } from 'node:stream/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-node'
import { CHUNK_SECONDS, logMel, melFilters, N_FRAMES, nextToken, segmentsOf, WHISPER_FILES, WHISPER_MODELS, type Segment, type TokenIds, type WhisperModel } from '@shared/whisper'

/** Tokens per 30 s window at most (Whisper's limit is 448 including the prompt). */
const MAX_TOKENS = 224

interface Loaded {
  name: WhisperModel
  tokenizer: Tokenizer
  encoder: ort.InferenceSession
  decoder: ort.InferenceSession
  filters: Float32Array
  nMels: number
  layers: number
  heads: number
  headDim: number
  ids: TokenIds & { start: number; transcribe: number; languages: Map<string, number> }
}

let loaded: Loaded | null = null

const directoryOf = (name: WhisperModel): string => path.join(workerData.cacheDir, WHISPER_MODELS[name].repo, WHISPER_MODELS[name].revision)

async function download(name: WhisperModel): Promise<void> {
  const { repo, revision } = WHISPER_MODELS[name]
  const directory = directoryOf(name)
  for (const [i, file] of WHISPER_FILES.entries()) {
    const target = path.join(directory, file)
    if (!existsSync(target)) {
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      const temporary = `${target}.part`
      try {
        const response = await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${file}`)
        if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`)
        const total = Number(response.headers.get('content-length'))
        let received = 0
        const stream = Readable.fromWeb(response.body)
        stream.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total) parentPort?.postMessage({ progress: ((i + Math.min(1, received / total)) / WHISPER_FILES.length) * 100 })
        })
        await pipe(stream, createWriteStream(temporary, { mode: 0o600 }))
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    }
    parentPort?.postMessage({ progress: ((i + 1) / WHISPER_FILES.length) * 100 })
  }
}

async function load(name: WhisperModel): Promise<Loaded> {
  if (loaded?.name === name) return loaded
  if (loaded) {
    await loaded.encoder.release()
    await loaded.decoder.release()
    loaded = null
  }
  const directory = directoryOf(name)
  const json = async (file: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path.join(directory, file), 'utf8'))
  const config = await json('config.json')
  const generation = await json('generation_config.json')
  const tokenizer = new Tokenizer(await json('tokenizer.json'), await json('tokenizer_config.json'))
  const options: ort.InferenceSession.SessionOptions = { executionProviders: ['cpu'], intraOpNumThreads: 4, interOpNumThreads: 1 }
  const encoder = await ort.InferenceSession.create(path.join(directory, 'onnx/encoder_model_quantized.onnx'), options)
  const decoder = await ort.InferenceSession.create(path.join(directory, 'onnx/decoder_model_merged_quantized.onnx'), options)
  const id = (token: string): number => {
    const v = tokenizer.token_to_id(token)
    if (v === undefined) throw new Error(`Unknown token ${token}`)
    return v
  }
  const noTimestamps = id('<|notimestamps|>')
  const languages = new Map(Object.entries((generation.lang_to_id as Record<string, number>) ?? {}).map(([k, v]) => [k.slice(2, -2), v]))
  const nMels = Number(config.num_mel_bins)
  const heads = Number(config.decoder_attention_heads)
  loaded = {
    name,
    tokenizer,
    encoder,
    decoder,
    filters: melFilters(nMels),
    nMels,
    layers: Number(config.decoder_layers),
    heads,
    headDim: Number(config.d_model) / heads,
    ids: {
      start: id('<|startoftranscript|>'),
      transcribe: id('<|transcribe|>'),
      endOfText: id('<|endoftext|>'),
      timestampBegin: noTimestamps + 1,
      // The other special tokens (languages, tasks, no-timestamps …) are never generated either.
      suppress: new Set([...((generation.suppress_tokens as number[]) ?? []), ...Array.from({ length: noTimestamps + 1 - id('<|startoftranscript|>') }, (_, i) => id('<|startoftranscript|>') + i)]),
      beginSuppress: new Set((generation.begin_suppress_tokens as number[]) ?? []),
      languages
    }
  }
  return loaded
}

/** Runs the decoder over `inputIds` with the cache; returns the last position's logits and the new cache. */
async function step(m: Loaded, inputIds: number[], hidden: ort.Tensor, cache: Record<string, ort.Tensor> | null): Promise<{ logits: Float32Array; cache: Record<string, ort.Tensor> }> {
  const feeds: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]),
    encoder_hidden_states: hidden,
    use_cache_branch: new ort.Tensor('bool', [cache !== null], [1])
  }
  const empty = new ort.Tensor('float32', new Float32Array(0), [1, m.heads, 0, m.headDim])
  for (let i = 0; i < m.layers; i++)
    for (const kind of ['decoder', 'encoder'])
      for (const part of ['key', 'value']) feeds[`past_key_values.${i}.${kind}.${part}`] = cache?.[`${i}.${kind}.${part}`] ?? empty
  const out = await m.decoder.run(feeds)
  const logits = out.logits
  const vocab = logits.dims[2]
  const data = logits.data as Float32Array
  const next: Record<string, ort.Tensor> = {}
  for (let i = 0; i < m.layers; i++)
    for (const part of ['key', 'value']) {
      next[`${i}.decoder.${part}`] = out[`present.${i}.decoder.${part}`]
      // The encoder's keys and values come from the first step; later steps return them empty.
      next[`${i}.encoder.${part}`] = cache?.[`${i}.encoder.${part}`] ?? out[`present.${i}.encoder.${part}`]
    }
  return { logits: data.slice(data.length - vocab), cache: next }
}

/** One window: its segments (moved by `offset` seconds) and the language used. */
async function transcribe(name: WhisperModel, samples: Float32Array, language: string | null, offset: number, seconds: number): Promise<{ segments: Segment[]; language: string }> {
  const m = await load(name)
  const features = logMel(samples, m.filters, m.nMels)
  const encoded = await m.encoder.run({ input_features: new ort.Tensor('float32', features, [1, m.nMels, N_FRAMES]) })
  const hidden = encoded.last_hidden_state
  let lang = language && m.ids.languages.has(language) ? language : null
  if (!lang) {
    // The most likely language token after <|startoftranscript|>.
    const { logits } = await step(m, [m.ids.start], hidden, null)
    let best = -Infinity
    for (const [code, id] of m.ids.languages)
      if (logits[id] > best) {
        best = logits[id]
        lang = code
      }
  }
  const prompt = [m.ids.start, m.ids.languages.get(lang!)!, m.ids.transcribe]
  const generated: number[] = []
  let { logits, cache } = await step(m, prompt, hidden, null)
  for (let i = 0; i < MAX_TOKENS; i++) {
    const token = nextToken(logits, generated, m.ids)
    if (token === m.ids.endOfText) break
    generated.push(token)
    ;({ logits, cache } = await step(m, [token], hidden, cache))
  }
  const decode = (ids: number[]): string => m.tokenizer.decode(ids, { skip_special_tokens: true })
  return { segments: segmentsOf(generated, m.ids.timestampBegin, offset, Math.min(CHUNK_SECONDS, seconds), decode), language: lang! }
}

type Message =
  | { id: number; type: 'download'; model: WhisperModel }
  | { id: number; type: 'chunk'; model: WhisperModel; samples: Float32Array; language: string | null; offset: number; seconds: number }

let queue = Promise.resolve()
parentPort?.on('message', (message: Message) => {
  queue = queue.then(async () => {
    try {
      if (message.type === 'download') {
        await download(message.model)
        await load(message.model)
        parentPort?.postMessage({ id: message.id, result: true })
      } else {
        parentPort?.postMessage({ id: message.id, result: await transcribe(message.model, message.samples, message.language, message.offset, message.seconds) })
      }
    } catch (error) {
      parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) })
    }
  })
})
