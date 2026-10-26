import path from 'node:path'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline as pipe } from 'node:stream/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-node'
import { EMBEDDING_MODEL, EMBEDDING_REVISION } from '@shared/embedding'

const MAX_TOKENS = 512
let model: { tokenizer: Tokenizer; session: ort.InferenceSession; pad: number } | null = null
async function load(download: boolean): Promise<NonNullable<typeof model>> {
  if (model) return model
  const directory = path.join(workerData.cacheDir, EMBEDDING_MODEL, EMBEDDING_REVISION)
  // Download only these pinned files, only on an explicit request. Inference reads local files only.
  if (download) {
    const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
    for (const [i, file] of files.entries()) {
      const target = path.join(directory, file)
      if (!existsSync(target)) {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
        const temporary = `${target}.part`
        try {
          const response = await fetch(`https://huggingface.co/${EMBEDDING_MODEL}/resolve/${EMBEDDING_REVISION}/${file}`)
          if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`)
          const total = Number(response.headers.get('content-length'))
          let loaded = 0
          const stream = Readable.fromWeb(response.body)
          stream.on('data', (chunk: Buffer) => {
            loaded += chunk.length
            if (total) parentPort?.postMessage({ progress: (i + Math.min(1, loaded / total)) / files.length * 100 })
          })
          await pipe(stream, createWriteStream(temporary, { mode: 0o600 }))
          await rename(temporary, target)
        } catch (error) { await rm(temporary, { force: true }); throw error }
      }
      parentPort?.postMessage({ progress: (i + 1) / files.length * 100 })
    }
  }
  const json = async (file: string): Promise<object> => JSON.parse(await readFile(path.join(directory, file), 'utf8'))
  const tokenizer = new Tokenizer(await json('tokenizer.json'), await json('tokenizer_config.json'))
  const session = await ort.InferenceSession.create(path.join(directory, 'onnx/model_quantized.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1 })
  return (model = { tokenizer, session, pad: tokenizer.token_to_id('<pad>') ?? 1 })
}
/** Mean-pooled, L2-normalized sentence vectors (what the E5 models are trained for). */
async function embed(texts: string[]): Promise<number[][]> {
  const { tokenizer, session, pad } = await load(false)
  const ids = texts.map((t) => tokenizer.encode(t).ids.slice(0, MAX_TOKENS))
  const [batch, length] = [ids.length, Math.max(...ids.map((x) => x.length))]
  const input = new BigInt64Array(batch * length).fill(BigInt(pad)), mask = new BigInt64Array(batch * length)
  ids.forEach((row, i) => row.forEach((id, j) => { input[i * length + j] = BigInt(id); mask[i * length + j] = 1n }))
  const tensor = (data: BigInt64Array): ort.Tensor => new ort.Tensor('int64', data, [batch, length])
  const out = await session.run({ input_ids: tensor(input), attention_mask: tensor(mask), token_type_ids: tensor(new BigInt64Array(batch * length)) })
  const hidden = out.last_hidden_state.data as Float32Array, size = out.last_hidden_state.dims[2]
  return ids.map((row, i) => {
    const vector = new Array<number>(size).fill(0)
    for (let j = 0; j < row.length; j++) for (let k = 0; k < size; k++) vector[k] += hidden[(i * length + j) * size + k]
    const norm = Math.hypot(...vector) || 1
    return vector.map((v) => v / norm)
  })
}
let queue = Promise.resolve()
parentPort?.on('message', (message: { id: number; type: 'download' | 'embed'; texts?: string[]; query?: boolean }) => {
  queue = queue.then(async () => {
    try {
      await load(message.type === 'download')
      const input = message.type === 'download' ? ['query: ready'] : (message.texts ?? []).map((t) => `${message.query ? 'query' : 'passage'}: ${t}`)
      parentPort?.postMessage({ id: message.id, vectors: input.length ? await embed(input) : [] })
    } catch (error) { parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }) }
  })
})
