import path from 'node:path'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-node'
import { LAYA_FILES, LAYA_ID, LAYA_MODEL, LAYA_REVISION, type DecisionInput, type DecisionOutput } from '@shared/fileAssistant'
import { decisionProbabilities, layaSequence } from './layaSequence'

const directory = workerData.directory as string
let session: ort.InferenceSession | null = null, tokenizer: Tokenizer | null = null
async function digest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function download(): Promise<void> {
  const total = LAYA_FILES.reduce((n, item) => n + item.size, 0)
  let finished = 0
  for (const asset of LAYA_FILES) {
    const target = path.join(directory, asset.file)
    if (!existsSync(target) || (await stat(target)).size !== asset.size || await digest(target) !== asset.sha256) {
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      const temporary = `${target}.part`
      try {
        const response = await fetch(`https://huggingface.co/${LAYA_MODEL}/resolve/${LAYA_REVISION}/${asset.file}`)
        if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`)
        let loaded = 0
        const stream = Readable.fromWeb(response.body)
        stream.on('data', (chunk: Buffer) => { loaded += chunk.length; parentPort?.postMessage({ progress: Math.min(99, (finished + loaded) / total * 100) }) })
        await pipeline(stream, createWriteStream(temporary, { mode: 0o600 }))
        if ((await stat(temporary)).size !== asset.size || await digest(temporary) !== asset.sha256) throw new Error('Model checksum verification failed')
        await rename(temporary, target)
      } catch (error) { await rm(temporary, { force: true }); throw error }
    }
    finished += asset.size
    parentPort?.postMessage({ progress: finished / total * 100 })
  }
  await load()
  await writeFile(path.join(directory, 'ready.json'), JSON.stringify({ model: LAYA_ID }), { mode: 0o600 })
}
async function load(): Promise<void> {
  if (session && tokenizer) return
  // ONNX and the tokenizer read only these local assets; they have no Hub/network loader.
  tokenizer = new Tokenizer(JSON.parse(await readFile(path.join(directory, 'tokenizer.json'), 'utf8')), JSON.parse(await readFile(path.join(directory, 'tokenizer_config.json'), 'utf8')))
  session = await ort.InferenceSession.create(path.join(directory, 'onnx/model.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1 })
}
async function decide(input: DecisionInput): Promise<DecisionOutput> {
  await load()
  const raw = (s: string): number[] => tokenizer!.encode(s, { add_special_tokens: false }).ids
  const space = raw(' ')[0]
  // mmBERT Metaspace parity with Rust tokenizers (preserves repeated spaces).
  const encode = (s: string): number[] => {
    if (!s) return []
    const words = (s.startsWith(' ') ? s : ` ${s}`).split(/(?= )/)
    return words.flatMap((p) => p.slice(1) ? raw(p.slice(1)) : [space])
  }
  const special = { cls: tokenizer!.token_to_id('<bos>')!, sep: tokenizer!.token_to_id('<eos>')!, mask: tokenizer!.token_to_id('<mask>')! }
  const sequence = layaSequence(input, encode, special)
  const { ids, markers } = sequence
  const int64 = (values: number[], dims: number[]): ort.Tensor => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), dims)
  const out = await session!.run({
    input_ids: int64(ids, [1, ids.length]), attention_mask: int64(ids.map(() => 1), [1, ids.length]),
    marker_pos: int64(markers, [1, markers.length]), marker_mask: new ort.Tensor('bool', new Uint8Array(markers.length).fill(1), [1, markers.length]), qtype: int64([0], [1])
  })
  const probabilities = decisionProbabilities(Array.from(out.logits.data as Float32Array).slice(0, markers.length))
  let best = 0
  probabilities.forEach((p, i) => { if (p > probabilities[best]) best = i })
  return { choice: input.choices[best].id, score: probabilities[best], probabilities, truncated: sequence.truncated, collapsed: sequence.collapsed }
}
let queue = Promise.resolve()
parentPort?.on('message', (message: { id: number; type: 'download' | 'decide'; input?: DecisionInput }) => {
  queue = queue.then(async () => {
    try {
      const result = message.type === 'download' ? await download() : await decide(message.input!)
      parentPort?.postMessage({ id: message.id, result })
    } catch (error) { parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }) }
  })
})
