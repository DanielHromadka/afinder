// Live view of a growing file (like `tail -F`) or of a byte stream (character device, FIFO, socket):
// bytes are pushed to the window that asked, in batches, until it stops the session or goes away.

import { createReadStream, type ReadStream } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import type { WebContents } from 'electron'
import { t } from '@shared/i18n'
import { IPC, type TailChunk, type TailInfo } from '@shared/types'
import { validatePath } from './fileSystem'
import * as vfs from './vfs'

/** How much of an existing file is shown when following starts. */
const INITIAL_BYTES = 64 * 1024
/** At most this much is read from a file per poll, and sent per flush of a stream. */
const MAX_CHUNK = 256 * 1024
const POLL_MS = 250
/** Blocking reads of streams hold a libuv worker each; more of them would stall all file access. */
const MAX_STREAMS = 2
const FLUSH_MS = 100

interface Session {
  owner: WebContents
  kind: TailInfo['kind']
  stop(): void
}

const sessions = new Map<string, Session>()
let seq = 0

function send(owner: WebContents, chunk: TailChunk): void {
  if (!owner.isDestroyed()) owner.send(IPC.tailData, chunk)
}

export async function start(owner: WebContents, p: unknown): Promise<TailInfo> {
  const file = validatePath(p)
  if ((await vfs.locate(file)).kind !== 'local') throw new Error(t('tail.localOnly'))
  const st = await stat(file)
  if (st.isDirectory()) throw new Error(t('tail.notFile'))
  const streams = [...sessions.values()].filter((s) => s.kind === 'stream').length
  if (!st.isFile() && streams >= MAX_STREAMS) throw new Error(t('tail.tooMany'))
  const id = `tail-${++seq}`
  const session = st.isFile() ? followFile(id, owner, file, st.ino) : readStream(id, owner, file)
  sessions.set(id, session)
  owner.once('destroyed', () => stop(owner, id))
  return { id, kind: st.isFile() ? 'file' : 'stream' }
}

export function stop(owner: WebContents, id: unknown): void {
  const session = typeof id === 'string' ? sessions.get(id) : undefined
  if (!session || session.owner !== owner) return
  sessions.delete(id as string)
  session.stop()
}

export function dispose(): void {
  for (const session of sessions.values()) session.stop()
  sessions.clear()
}

/** Regular file: the last bytes, then whatever is appended. A truncated or replaced file is read from its start. */
function followFile(id: string, owner: WebContents, file: string, ino: number): Session {
  let handle: FileHandle | null = null
  let pos = -1
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const poll = async (): Promise<void> => {
    try {
      const st = await stat(file).catch(() => null)
      if (!st) return // rotated away; wait for the new file
      let reset = false
      if (!handle || st.ino !== ino || st.size < pos) {
        if (handle && pos >= 0) reset = true
        await handle?.close().catch(() => {})
        handle = await open(file, 'r')
        ino = st.ino
        pos = pos < 0 ? Math.max(0, st.size - INITIAL_BYTES) : 0
      }
      if (st.size > pos || reset) {
        const length = Math.min(MAX_CHUNK, st.size - pos)
        const buf = Buffer.alloc(length)
        const { bytesRead } = length > 0 ? await handle.read(buf, 0, length, pos) : { bytesRead: 0 }
        pos += bytesRead
        if (!stopped) send(owner, { id, data: new Uint8Array(buf.subarray(0, bytesRead)), reset })
      }
    } catch (err) {
      if (!stopped) send(owner, { id, data: new Uint8Array(), error: (err as Error).message })
    } finally {
      if (!stopped) timer = setTimeout(() => void poll(), POLL_MS)
    }
  }
  void poll()
  return {
    owner,
    kind: 'file',
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      void handle?.close().catch(() => {})
    }
  }
}

/** Device, FIFO or socket: read from the start, batched; paused while the window has not taken the last batch. */
function readStream(id: string, owner: WebContents, file: string): Session {
  const stream: ReadStream = createReadStream(file, { highWaterMark: 64 * 1024 })
  let pending: Buffer[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    timer = null
    if (size === 0) return
    const data = Buffer.concat(pending, size)
    pending = []
    size = 0
    send(owner, { id, data: new Uint8Array(data) })
    if (stream.isPaused()) stream.resume()
  }
  stream.on('data', (chunk) => {
    const buf = chunk as Buffer
    pending.push(buf)
    size += buf.length
    // A firehose (/dev/urandom) must not flood the window: hold the stream until the next flush.
    if (size >= MAX_CHUNK) stream.pause()
    timer ??= setTimeout(flush, FLUSH_MS)
  })
  stream.on('error', (err) => send(owner, { id, data: new Uint8Array(), error: err.message }))
  stream.on('end', () => {
    if (timer) clearTimeout(timer)
    flush()
    send(owner, { id, data: new Uint8Array(), ended: true })
  })
  return {
    owner,
    kind: 'stream',
    stop: () => {
      if (timer) clearTimeout(timer)
      stream.destroy()
    }
  }
}
