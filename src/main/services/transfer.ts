import { promises as fs } from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { ARCHIVE_EXTENSION, COMPRESSION_LEVELS, CREATE_FORMATS, levelsFor, withArchiveExtension } from '@shared/archive'
import { t } from '@shared/i18n'
import { isInside, samePath } from '@shared/paths'
import type { ArchiveRequest, ConflictPolicy, TransferMode, TransferPlan, TransferProgress, TransferRequest } from '@shared/types'
import type { ArchiveJob } from './archiveWriter'
import * as archives from './archives'
import { validateName, validatePath } from './fileSystem'
import * as remote from './remote'
import { autoMode, batchMode, type TransferEnd } from './transferMode'
import * as vfs from './vfs'

// Sources and destination may be local, members of an archive (read-only sources, extracted first)
// or on a remote connection. Between remote and local the item goes through the download cache;
// within one connection a move is a rename on the server.

const remoteAt = (p: string): remote.Located | null => {
  const at = remote.locate(p)
  return at && at !== 'mounts' ? at : null
}

/** Exists on disk or on its connection. */
async function exists(p: string): Promise<boolean> {
  const at = remoteAt(p)
  if (at) return remote.exists(at)
  return fs.lstat(p).then(() => true, () => false)
}

/** Is a folder (null when missing). */
async function isDirectory(p: string): Promise<boolean | null> {
  const at = remoteAt(p)
  if (at) {
    const st = await remote.statOf(at)
    return st ? st.isDir : null
  }
  const st = await fs.lstat(p).catch(() => null)
  return st ? st.isDirectory() : null
}

export async function planTransfer(req: TransferRequest): Promise<TransferPlan> {
  if (!req || !Array.isArray(req.sources) || req.sources.length === 0) throw new Error(t('error.nothingSelected'))
  const dest = validatePath(req.dest)
  const destLoc = await vfs.locate(dest)
  if (destLoc.kind === 'archive' || destLoc.kind === 'mounts') throw new Error(t('error.archiveReadOnly'))
  if (!(await isDirectory(dest))) throw new Error(t('error.destNotDir'))
  const destDev = destLoc.kind === 'local' ? (await fs.stat(dest)).dev : null

  // Members of an archive are copied out from their extracted copy; remote sources stay as they are.
  const sources = [
    ...new Set(
      await Promise.all(
        req.sources.map(async (s) => {
          const p = validatePath(s)
          return (await vfs.locate(p)).kind === 'archive' ? archives.realPath(p) : p
        })
      )
    )
  ]
  if (!['copy', 'move', 'auto'].includes(req.mode)) throw new Error(t('error.invalidMode'))
  const destEnd: TransferEnd = { connection: destLoc.kind === 'remote' ? destLoc.at.connection.id : null, dev: destDev }
  const modes: TransferMode[] = []
  for (const src of sources) {
    const srcAt = remoteAt(src)
    const isDir = await isDirectory(src)
    if (isDir === null) throw Object.assign(new Error(t('error.notFound')), { code: 'ENOENT', path: src })
    const mode = req.mode !== 'auto' ? req.mode : autoMode({ connection: srcAt ? srcAt.connection.id : null, dev: srcAt ? null : (await fs.lstat(src)).dev }, destEnd)
    if (isDir && isInside(dest, src)) {
      throw new Error(t(mode === 'copy' ? 'error.copyIntoItself' : 'error.moveIntoItself', { name: path.basename(src) }))
    }
    modes.push(mode)
  }

  const conflicts: string[] = []
  for (const src of sources) {
    if (samePath(path.dirname(src), dest)) continue // copy → duplicate, move → no-op
    const name = path.basename(src)
    if (await exists(path.join(dest, name))) conflicts.push(name)
  }
  return { sources, dest, requested: req.mode, mode: batchMode(modes), modes, conflicts }
}

/** "foto.jpg" → "foto kopie.jpg", "foto kopie 2.jpg", … (the suffix is localized) */
async function uniqueName(dir: string, name: string, isFile: boolean): Promise<string> {
  const ext = isFile ? path.extname(name) : ''
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let n = 1; n < 10_000; n++) {
    const candidate = path.join(dir, `${stem} ${t('fs.copySuffix')}${n === 1 ? '' : ` ${n}`}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(t('error.noFreeName', { name }))
}

async function copyLocal(src: string, target: string): Promise<void> {
  await fs.cp(src, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    verbatimSymlinks: true
  })
}

async function moveLocal(src: string, target: string): Promise<void> {
  try {
    await fs.rename(src, target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    // Different volume: copy, then remove the original only after the copy succeeded.
    await copyLocal(src, target)
    await fs.rm(src, { recursive: true, force: true })
  }
}

/** Copies or moves one item to `target` (which does not exist) wherever both of them are. */
async function transferOne(src: string, target: string, mode: 'copy' | 'move'): Promise<void> {
  const srcAt = remoteAt(src)
  const targetAt = remoteAt(target)
  if (!srcAt && !targetAt) return mode === 'copy' ? copyLocal(src, target) : moveLocal(src, target)
  if (mode === 'move' && srcAt && targetAt && srcAt.connection.id === targetAt.connection.id) return remote.moveWithin(srcAt, targetAt)

  const local = srcAt ? await remote.materialize(srcAt) : src
  if (targetAt) await remote.upload(local, targetAt)
  else await copyLocal(local, target)
  // The original goes away only after the copy succeeded.
  if (mode === 'move') {
    if (srcAt) await remote.removeItem(srcAt)
    else await fs.rm(src, { recursive: true, force: true })
  }
}

/** Replaced local items go to the Trash; remote ones are deleted (there is no Trash). */
async function removeReplaced(target: string): Promise<void> {
  const at = remoteAt(target)
  if (at) await remote.removeItem(at)
  else await shell.trashItem(target)
}

export interface TransferControl {
  cancelled: boolean
}

export async function runTransfer(
  plan: TransferPlan,
  policy: ConflictPolicy,
  control: TransferControl,
  onProgress: (p: TransferProgress) => void
): Promise<string[]> {
  if (!['replace', 'keepBoth', 'skip'].includes(policy)) throw new Error(t('error.invalidOption'))
  // Re-validate: the plan came back from the renderer, so it is planned again from what was asked.
  const checked = await planTransfer({ sources: plan?.sources, dest: plan?.dest, mode: plan?.requested } as TransferRequest)
  const { dest, mode, modes, sources } = checked
  const created: string[] = []

  for (const [i, src] of sources.entries()) {
    if (control.cancelled) break
    const name = path.basename(src)
    onProgress({ mode, done: i, total: sources.length, current: name })

    const isFile = !(await isDirectory(src))
    let target = path.join(dest, name)

    if (samePath(path.dirname(src), dest)) {
      if (modes[i] === 'move') continue
      target = await uniqueName(dest, name, isFile)
    } else if (await exists(target)) {
      if (policy === 'skip') continue
      if (policy === 'keepBoth') target = await uniqueName(dest, name, isFile)
      else {
        if (isInside(src, target)) throw new Error(t('error.replaceWithChild', { name }))
        await removeReplaced(target)
      }
    }

    await transferOne(src, target, modes[i])
    created.push(target)
  }
  onProgress({ mode, done: sources.length, total: sources.length, current: '' })
  return created
}

/** Checks an archive request from the renderer: local sources, a local folder to write to, a free file name. */
export async function planArchive(req: ArchiveRequest): Promise<ArchiveJob> {
  if (!req || !Array.isArray(req.sources) || req.sources.length === 0) throw new Error(t('error.nothingSelected'))
  if (!CREATE_FORMATS.includes(req.format as (typeof CREATE_FORMATS)[number]) || !COMPRESSION_LEVELS.includes(req.level)) throw new Error(t('error.invalidOption'))
  // Archive members and remote items would first have to be extracted or downloaded; not supported (yet).
  const local = async (p: unknown): Promise<string> => {
    const valid = validatePath(p)
    if ((await vfs.locate(valid)).kind !== 'local') throw new Error(t('error.archiveLocalOnly'))
    return valid
  }
  const sources = [...new Set(await Promise.all(req.sources.map(local)))]
  for (const src of sources) await fs.lstat(src)
  const dest = await local(req.dest)
  if (!(await fs.stat(dest)).isDirectory()) throw new Error(t('error.destNotDir'))
  const name = withArchiveExtension(validateName(req.name), req.format)
  // "photos.zip" → "photos 2.zip", keeping a double extension like .tar.gz whole.
  const ext = ARCHIVE_EXTENSION[req.format]
  const stem = name.slice(0, -ext.length)
  let target = path.join(dest, name)
  for (let n = 2; await exists(target); n++) {
    if (n > 9999) throw new Error(t('error.noFreeName', { name }))
    target = path.join(dest, `${stem} ${n}${ext}`)
  }
  const level = levelsFor(req.format).includes(req.level) ? req.level : 'normal'
  return { sources, target, format: req.format, level }
}
