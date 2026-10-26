// The Doom add-on download: pinned files from the release in DOOM_BASE, only after the user clicks Download,
// checked by size and SHA-256 while streaming and moved into place only when whole. Nothing is bundled.

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, BrowserWindow, net } from 'electron'
import { DOOM_BASE, DOOM_BYTES, DOOM_FILES, DOOM_RELEASE, type DoomStatus } from '@shared/doom'
import { t } from '@shared/i18n'
import { IPC } from '@shared/types'

const dir = (): string => path.join(app.getPath('userData'), 'Games', 'doom')
// AFINDER_DOOM_URL lets the smoke test serve the files locally.
const base = (): string => process.env.AFINDER_DOOM_URL || DOOM_BASE

let job: { abort: AbortController; progress: number } | null = null
let failure: string | null = null

async function installed(): Promise<boolean> {
  try {
    if (JSON.parse(await readFile(path.join(dir(), 'ready.json'), 'utf8')).release !== DOOM_RELEASE) return false
    for (const f of DOOM_FILES) if ((await stat(path.join(dir(), f.file))).size !== f.size) return false
    return true
  } catch {
    return false
  }
}

export async function status(): Promise<DoomStatus> {
  if (job) return { state: 'downloading', progress: job.progress }
  if (await installed()) return { state: 'ready', dir: dir() }
  return failure ? { state: 'failed', error: failure } : { state: 'missing' }
}

async function broadcast(): Promise<void> {
  const s = await status()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.doomChanged, s)
}

async function fetchFile(f: (typeof DOOM_FILES)[number], signal: AbortSignal, done: number): Promise<void> {
  const target = path.join(dir(), f.file)
  const part = `${target}.part`
  try {
    const res = await net.fetch(`${base()}/${f.file}`, { signal })
    if (!res.ok || !res.body) throw new Error(t('games.doom.httpError', { status: res.status }))
    const hash = createHash('sha256')
    let loaded = 0, shown = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, next) {
        loaded += chunk.length
        if (loaded > f.size) return next(new Error(t('games.doom.checksum')))
        hash.update(chunk)
        const progress = Math.floor(((done + loaded) / DOOM_BYTES) * 100)
        if (job && progress !== shown) {
          shown = job.progress = progress
          void broadcast()
        }
        next(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(part, { mode: 0o600 }), { signal })
    if (loaded !== f.size || hash.digest('hex') !== f.sha256) throw new Error(t('games.doom.checksum'))
    await rename(part, target)
  } catch (e) {
    await rm(part, { force: true })
    throw e
  }
}

export async function download(): Promise<DoomStatus> {
  if (job) return status()
  job = { abort: new AbortController(), progress: 0 }
  failure = null
  void broadcast()
  try {
    await rm(dir(), { recursive: true, force: true })
    await mkdir(dir(), { recursive: true, mode: 0o700 })
    let done = 0
    for (const f of DOOM_FILES) {
      await fetchFile(f, job.abort.signal, done)
      done += f.size
    }
    await writeFile(path.join(dir(), 'ready.json'), JSON.stringify({ release: DOOM_RELEASE }), { mode: 0o600 })
  } catch (e) {
    const aborted = job.abort.signal.aborted
    await rm(dir(), { recursive: true, force: true })
    failure = aborted ? null : e instanceof Error ? e.message : String(e)
  } finally {
    job = null
    void broadcast()
  }
  return status()
}

export function cancel(): void {
  job?.abort.abort()
}

export async function remove(): Promise<DoomStatus> {
  cancel()
  failure = null
  await rm(dir(), { recursive: true, force: true })
  void broadcast()
  return status()
}
