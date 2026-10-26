import { execFileSync } from 'node:child_process'
import { appendFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TailChunk } from '@shared/types'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, BrowserWindow: {}, dialog: {}, shell: {} }))

const tail = await import('./tail')

/** A stand-in for the window: collects what the service sends it. */
function fakeOwner(): { owner: Electron.WebContents; chunks: TailChunk[]; text(): string } {
  const chunks: TailChunk[] = []
  const owner = {
    isDestroyed: () => false,
    send: (_channel: string, chunk: TailChunk) => chunks.push(chunk),
    once: () => {}
  } as unknown as Electron.WebContents
  return { owner, chunks, text: () => chunks.map((c) => Buffer.from(c.data).toString('utf8')).join('') }
}

const until = async (check: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-tail-'))
})
afterEach(async () => {
  tail.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('tail', () => {
  it('shows the end of a file, then what is appended, and starts over after truncation', async () => {
    const file = path.join(dir, 'app.log')
    await writeFile(file, 'x'.repeat(100 * 1024) + 'LAST\n')
    const { owner, chunks, text } = fakeOwner()
    const info = await tail.start(owner, file)
    expect(info.kind).toBe('file')
    await until(() => text().endsWith('LAST\n'))
    expect(text().length).toBe(64 * 1024)

    await appendFile(file, 'next line\n')
    await until(() => text().endsWith('next line\n'))

    await writeFile(file, 'fresh\n')
    const sinceReset = (): string => {
      const i = chunks.findIndex((c) => c.reset)
      return i < 0 ? '' : Buffer.concat(chunks.slice(i).map((c) => Buffer.from(c.data))).toString()
    }
    await until(() => sinceReset() === 'fresh\n')
  })

  it('stops sending after stop()', async () => {
    const file = path.join(dir, 'a.log')
    await writeFile(file, 'a\n')
    const { owner, text } = fakeOwner()
    const { id } = await tail.start(owner, file)
    await until(() => text() === 'a\n')
    tail.stop(owner, id)
    await appendFile(file, 'b\n')
    await new Promise((r) => setTimeout(r, 400))
    expect(text()).toBe('a\n')
  })

  it('refuses folders', async () => {
    await expect(tail.start(fakeOwner().owner, dir)).rejects.toThrow()
  })

  it.skipIf(process.platform === 'win32')('reads a FIFO as a stream until the writer closes it', async () => {
    const fifo = path.join(dir, 'pipe')
    execFileSync('mkfifo', [fifo])
    const { owner, chunks, text } = fakeOwner()
    const started = tail.start(owner, fifo)
    const writer = await open(fifo, 'w')
    expect((await started).kind).toBe('stream')
    await writer.write('hello\n')
    await writer.close()
    await until(() => chunks.some((c) => c.ended))
    expect(text()).toBe('hello\n')
  })
})
