// Creates .zip, .tar, .tar.gz and .tar.zst archives from local files and folders. Everything streams:
// files are read one at a time and compressed by zlib off the JS thread, so large folders do not
// block the main process. No Electron imports, so the round trip is unit-tested.

import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { lstat, readdir, readlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { constants as zlib, createGzip, createZstdCompress } from 'node:zlib'
import * as tar from 'tar-stream'
import * as yazl from 'yazl'
import { compressionLevel, type ArchiveFormat, type CompressionLevel } from '@shared/archive'
import { samePath } from '@shared/paths'
import type { TransferProgress } from '@shared/types'

interface Item {
  abs: string
  /** Member name: forward slashes, no leading slash. */
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  mode: number
  mtime: Date
  link?: string
}

export interface ArchiveControl {
  cancelled: boolean
}

export interface ArchiveJob {
  sources: string[]
  /** The archive file; must not exist yet. */
  target: string
  format: ArchiveFormat
  level: CompressionLevel
}

/** Every item below the sources, parents before children. Symlinks are stored, never followed. */
async function collect(sources: string[], target: string, control: ArchiveControl): Promise<Item[]> {
  const items: Item[] = []
  const taken = new Set<string>()
  const walk = async (abs: string, name: string): Promise<void> => {
    if (control.cancelled || samePath(abs, target)) return
    const st = await lstat(abs)
    const base = { abs, name, size: 0, mode: st.mode, mtime: st.mtime }
    if (st.isSymbolicLink()) items.push({ ...base, type: 'symlink', link: await readlink(abs) })
    else if (st.isFile()) items.push({ ...base, type: 'file', size: st.size })
    else if (st.isDirectory()) {
      items.push({ ...base, type: 'directory' })
      const children = (await readdir(abs)).sort()
      for (const child of children) await walk(path.join(abs, child), `${name}/${child}`)
    }
    // Sockets, FIFOs and devices have no content to archive.
  }
  for (const src of sources) {
    // Items picked from search results may share a name: "a", "a 2", …
    const original = path.basename(src)
    let top = original
    for (let n = 2; taken.has(top); n++) top = `${original} ${n}`
    taken.add(top)
    await walk(src, top)
  }
  return items
}

/** Reports the file about to be packed; false once the user cancelled. */
type Step = (item: Item) => boolean

/** Internal only: a cancelled archive resolves false, this message never reaches the user. */
const cancelled = (): Error => new Error('cancelled')

async function writeZip(items: Item[], level: number, out: WriteStream, step: Step): Promise<void> {
  const zip = new yazl.ZipFile()
  const failed = new Promise<never>((_, reject) => zip.on('error', reject))
  failed.catch(() => {})
  for (const item of items) {
    if (item.type === 'directory') zip.addEmptyDirectory(item.name, { mtime: item.mtime, mode: item.mode })
    else if (item.type === 'symlink') zip.addBuffer(Buffer.from(item.link!), item.name, { mtime: item.mtime, mode: item.mode, compress: false })
    else {
      zip.addReadStreamLazy(item.name, { mtime: item.mtime, mode: item.mode, compressionLevel: level, size: item.size }, (cb) => {
        if (step(item)) cb(null, createReadStream(item.abs))
        else cb(cancelled(), null as unknown as NodeJS.ReadableStream)
      })
    }
  }
  zip.end()
  await Promise.race([pipeline(zip.outputStream, out), failed])
}

async function writeTar(items: Item[], format: ArchiveFormat, level: number, out: WriteStream, step: Step): Promise<void> {
  const pack = tar.pack()
  const compressor = format === 'tgz' ? createGzip({ level }) : format === 'tzst' ? createZstdCompress({ params: { [zlib.ZSTD_c_compressionLevel]: level } }) : null
  const done = compressor ? pipeline(pack, compressor, out) : pipeline(pack, out)
  try {
    for (const item of items) {
      const header = { name: item.name, mode: item.mode & 0o7777, mtime: item.mtime }
      if (item.type === 'directory') pack.entry({ ...header, type: 'directory' })
      else if (item.type === 'symlink') pack.entry({ ...header, type: 'symlink', linkname: item.link })
      else {
        if (!step(item)) throw cancelled()
        await new Promise<void>((resolve, reject) => {
          const entry = pack.entry({ ...header, type: 'file', size: item.size }, (err) => (err ? reject(err) : resolve()))
          createReadStream(item.abs).on('error', reject).pipe(entry as unknown as NodeJS.WritableStream)
        })
      }
    }
    pack.finalize()
  } catch (err) {
    // Through the file stream: pipeline then tears down the pack without an unhandled streamx error.
    out.destroy(err as Error)
  }
  await done
}

/**
 * Writes the archive. Cancelling stops at the next file and removes the partial archive, as does any
 * error. Resolves false when cancelled.
 */
export async function writeArchive(job: ArchiveJob, control: ArchiveControl, onProgress: (p: TransferProgress) => void): Promise<boolean> {
  onProgress({ mode: 'archive', done: 0, total: 0, current: '' })
  const items = await collect(job.sources, job.target, control)
  if (control.cancelled) return false
  const total = items.filter((i) => i.type === 'file').length
  let done = 0
  const step: Step = (item) => {
    if (control.cancelled) return false
    onProgress({ mode: 'archive', done: done++, total, current: item.name })
    return true
  }
  const out = createWriteStream(job.target, { flags: 'wx' })
  // Only a file this call created may be removed – 'wx' fails rather than touch an existing one.
  let created = false
  out.once('open', () => (created = true))
  // A large file keeps streaming between steps; check for a cancel in the meantime too.
  const watch = setInterval(() => control.cancelled && out.destroy(cancelled()), 200)
  try {
    const level = compressionLevel(job.format, job.level)
    if (job.format === 'zip') await writeZip(items, level, out, step)
    else await writeTar(items, job.format, level, out, step)
  } catch (err) {
    out.destroy()
    if (created) await rm(job.target, { force: true })
    if (control.cancelled) return false
    throw err
  } finally {
    clearInterval(watch)
  }
  onProgress({ mode: 'archive', done: total, total, current: '' })
  return true
}
