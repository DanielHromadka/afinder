// Writing a video made in the renderer: a cut from Quick Look or a format conversion from the context
// menu. The renderer decodes and encodes with WebCodecs and streams the container here in positioned
// chunks (MP4 patches its header at the end), so the file never sits whole in memory. It goes to a
// temporary file first and lands next to the source only when complete.

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdtemp, open, rm, stat, type FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { t } from '@shared/i18n'
import { extensionOf } from '@shared/preview'
import { convertedName, convertKind, isAudioTarget, isVideoTarget } from '@shared/convert'
import { canCutVideo } from '@shared/videoCut'
import * as remote from './remote'
import * as vfs from './vfs'
import { validatePath } from './fileSystem'
import { freeCopyPath, freePath } from './preview'

/** Upper bound for one chunk; the renderer sends 8 MiB ones. */
const MAX_CHUNK_BYTES = 64 * 1024 * 1024

interface Job {
  owner: number
  source: string
  /** Set for a conversion (`name.ext`) or a merge; a cut keeps the source's format (`name (cut).ext`). */
  convertTo: string | null
  /** Several videos joined, named after the first one: `name (joined).mp4`. */
  merged: boolean
  dir: string
  tmp: string
  handle: FileHandle
}

const jobs = new Map<string, Job>()

/**
 * Starts writing a video (or its sound) made from the one at p; the returned id takes the chunks. With
 * `merged`, p is the first of several videos joined into an MP4.
 */
export async function begin(sender: WebContents, p: unknown, convertTo: unknown, merged: unknown): Promise<string> {
  const source = validatePath(p)
  const name = path.basename(source)
  const isMerge = merged === true
  const target = typeof convertTo === 'string' && (isVideoTarget(convertTo) || (!isMerge && isAudioTarget(convertTo))) && convertKind(name) === 'video' ? convertTo : null
  if (convertTo !== undefined && convertTo !== null ? !target : isMerge || !canCutVideo(name)) throw new Error(t('error.invalidOption'))
  await vfs.assertWritable(path.dirname(source))
  const dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-video-'))
  const tmp = path.join(dir, `video.${target ?? extensionOf(source)}`)
  let handle: FileHandle
  try {
    handle = await open(tmp, 'w')
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
  const id = randomUUID()
  jobs.set(id, { owner: sender.id, source, convertTo: target, merged: isMerge, dir, tmp, handle })
  // A window that closes mid-cut leaves nothing behind.
  sender.once('destroyed', () => void drop(id))
  return id
}

function jobOf(sender: WebContents, id: unknown): Job {
  const job = typeof id === 'string' ? jobs.get(id) : undefined
  if (!job || job.owner !== sender.id) throw new Error(t('error.invalidOption'))
  return job
}

export async function write(sender: WebContents, id: unknown, position: unknown, data: unknown): Promise<void> {
  const job = jobOf(sender, id)
  if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) throw new Error(t('error.invalidOption'))
  if (!(data instanceof Uint8Array) || data.length > MAX_CHUNK_BYTES) throw new Error(t('error.invalidOption'))
  await job.handle.write(data, 0, data.length, position)
}

/** The source's folder, for the activity history. */
export function folderOf(id: unknown): string | null {
  const job = typeof id === 'string' ? jobs.get(id) : undefined
  return job ? path.dirname(job.source) : null
}

/** Moves the finished file next to the source, as `name (cut).ext` or `name.<new ext>`. */
export async function finish(sender: WebContents, id: unknown): Promise<{ path: string; modified: number }> {
  const job = jobOf(sender, id)
  jobs.delete(id as string)
  try {
    await job.handle.close()
    const convertTo = job.convertTo
    const target = job.merged && convertTo
      ? await freeCopyPath(job.source, convertTo, t('merge.suffix'))
      : convertTo
      ? await freePath(path.dirname(job.source), (taken) => convertedName(path.basename(job.source), convertTo, taken))
      : await freeCopyPath(job.source, extensionOf(job.source), t('videoEditor.copySuffix'))
    const loc = await vfs.locate(target)
    if (loc.kind === 'remote') {
      await remote.upload(job.tmp, loc.at)
      return { path: target, modified: Date.now() }
    }
    await copyFile(job.tmp, target, constants.COPYFILE_EXCL)
    return { path: target, modified: (await stat(target)).mtimeMs }
  } finally {
    await rm(job.dir, { recursive: true, force: true })
  }
}

export async function abort(sender: WebContents, id: unknown): Promise<void> {
  if (typeof id === 'string' && jobs.get(id)?.owner === sender.id) await drop(id)
}

async function drop(id: string): Promise<void> {
  const job = jobs.get(id)
  if (!job) return
  jobs.delete(id)
  await job.handle.close().catch(() => {})
  await rm(job.dir, { recursive: true, force: true })
}
