// Archives (.zip, .jar, .tar, .tar.gz, .tar.zst) browsed as read-only folders. The member list is read once
// per archive version and cached; members are extracted to a temporary folder only when they are
// needed as real files – to preview, open, copy out or drag out.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, utimes } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createZstdDecompress } from 'node:zlib'
import { app } from 'electron'
import * as tar from 'tar-stream'
import * as yauzl from 'yauzl'
import { archiveFormat, memberSegments, splitArchivePath, type ArchiveFormat } from '@shared/archive'
import { t } from '@shared/i18n'
import type { FileEntry, Listing } from '@shared/types'
import { isHiddenName, kindOf } from './entries'

const MAX_MEMBERS = 200_000

interface Node {
  name: string
  isDir: boolean
  size: number
  modified: number
  children: Map<string, Node> | null
  /** Member name in the archive (files only). */
  member: string | null
}

interface Index {
  root: Node
  key: string
}

/** A path inside an archive (or the archive's root), confirmed against the file system. */
export interface Located {
  archive: string
  format: ArchiveFormat
  inner: string[]
}

const indexes = new Map<string, Promise<Index>>()

const tempRoot = (): string => path.join(app.getPath('temp'), 'afinder-archives')

/** Null for ordinary paths – including real folders that happen to be named "x.zip". */
export async function locate(p: string): Promise<Located | null> {
  const split = splitArchivePath(p)
  if (!split) return null
  const format = archiveFormat(path.basename(split.archive))
  const st = await stat(split.archive).catch(() => null)
  if (!format || !st?.isFile()) return null
  return { archive: split.archive, format, inner: split.inner }
}

/** Throws for paths inside an archive: they cannot be created, renamed, trashed or written to. */
export async function assertWritable(p: string): Promise<void> {
  const at = await locate(p)
  if (at && at.inner.length > 0) throw new Error(t('error.archiveReadOnly'))
}

function newDir(name: string): Node {
  return { name, isDir: true, size: 0, modified: 0, children: new Map(), member: null }
}

function insert(root: Node, member: string, isDir: boolean, size: number, modified: number): void {
  const segments = memberSegments(member)
  // macOS metadata: the __MACOSX folder of zips and the AppleDouble "._name" files of tars.
  if (!segments || segments.length === 0 || segments[0] === '__MACOSX' || segments[segments.length - 1].startsWith('._')) return
  let dir = root
  for (const [i, name] of segments.entries()) {
    const last = i === segments.length - 1
    let child = dir.children!.get(name)
    if (!child) {
      child = last && !isDir ? { name, isDir: false, size, modified, children: null, member } : newDir(name)
      dir.children!.set(name, child)
    }
    if (last && isDir) child.modified = modified
    if (!child.isDir) return
    dir = child
  }
}

/** Folder sizes are the sum of their members; folders without a date take their newest member's. */
function finish(node: Node): void {
  if (!node.isDir) return
  let size = 0
  let newest = 0
  for (const child of node.children!.values()) {
    finish(child)
    size += child.size
    newest = Math.max(newest, child.modified)
  }
  node.size = size
  if (!node.modified) node.modified = newest
}

async function readZip(file: string, root: Node): Promise<void> {
  const zip = await yauzl.openPromise(file, { autoClose: true })
  let count = 0
  for await (const entry of zip.eachEntry()) {
    if (++count > MAX_MEMBERS) {
      zip.close()
      throw new Error(t('error.archiveTooLarge'))
    }
    const isDir = entry.fileName.endsWith('/')
    insert(root, entry.fileName, isDir, entry.uncompressedSize, entry.getLastModDate().getTime())
  }
}

function tarSource(file: string, format: ArchiveFormat): NodeJS.ReadableStream {
  const source = createReadStream(file)
  return format === 'tgz' ? source.pipe(createGunzip()) : format === 'tzst' ? source.pipe(createZstdDecompress()) : source
}

async function readTar(file: string, format: ArchiveFormat, root: Node): Promise<void> {
  const extract = tar.extract()
  const done = pipeline(tarSource(file, format), extract)
  let count = 0
  for await (const entry of extract) {
    const h = entry.header
    if (++count > MAX_MEMBERS) {
      extract.destroy()
      throw new Error(t('error.archiveTooLarge'))
    }
    if (h.type === 'directory' || h.type === 'file' || h.type === 'contiguous-file') {
      insert(root, h.name, h.type === 'directory', h.size ?? 0, (h.mtime ?? new Date(0)).getTime())
    }
    entry.resume() // skip the body
  }
  await done
}

/** The member tree, cached per archive path and invalidated when the archive changes. */
async function indexOf(at: Located): Promise<Index> {
  const st = await stat(at.archive)
  const key = `${st.size}:${st.mtimeMs}`
  const cached = indexes.get(at.archive)
  if (cached) {
    const index = await cached.catch(() => null)
    if (index?.key === key) return index
  }
  const loading = (async () => {
    const root = newDir(path.basename(at.archive))
    if (at.format === 'zip') await readZip(at.archive, root)
    else await readTar(at.archive, at.format, root)
    finish(root)
    root.modified = st.mtimeMs
    return { root, key }
  })()
  indexes.set(at.archive, loading)
  if (indexes.size > 8) indexes.delete(indexes.keys().next().value!)
  loading.catch(() => indexes.delete(at.archive))
  return loading
}

function nodeAt(root: Node, inner: string[]): Node | null {
  let node = root
  for (const name of inner) {
    const next = node.children?.get(name)
    if (!next) return null
    node = next
  }
  return node
}

/** Folder listing inside an archive. Folders come with their size, so nothing has to compute it. */
export async function list(at: Located, p: string): Promise<Listing> {
  const node = nodeAt((await indexOf(at)).root, at.inner)
  if (!node) throw Object.assign(new Error(t('error.notFound')), { code: 'ENOENT', path: p })
  if (!node.isDir) throw Object.assign(new Error(t('error.notDir')), { code: 'ENOTDIR', path: p })
  const entries: FileEntry[] = [...node.children!.values()].map((child) => ({
    name: child.name,
    path: path.join(p, child.name),
    isDir: child.isDir,
    isSymlink: false,
    hidden: isHiddenName(child.name),
    kind: kindOf(child.name, child.isDir),
    size: child.size,
    modified: child.modified
  }))
  return { path: p, parent: path.dirname(p), entries, readOnly: true }
}

/**
 * The member (file or folder) as a real path in the temporary folder, extracted if needed. Extracted
 * copies are reused until the archive changes.
 */
export async function materialize(at: Located): Promise<string> {
  const index = await indexOf(at)
  const node = nodeAt(index.root, at.inner)
  if (!node) throw Object.assign(new Error(t('error.notFound')), { code: 'ENOENT' })
  const base = path.join(tempRoot(), createHash('sha1').update(`${at.archive}\0${index.key}`).digest('hex').slice(0, 16))
  const target = path.join(base, path.basename(at.archive, path.extname(at.archive)), ...at.inner)
  const ready = await stat(target).then((s) => (node.isDir ? s.isDirectory() : s.isFile() && s.size === node.size), () => false)
  if (ready && !node.isDir) return target

  // Collect the members to extract: the file, or everything below the folder.
  const wanted = new Map<string, Node>()
  const collect = (n: Node, segments: string[]): void => {
    if (n.isDir) for (const child of n.children!.values()) collect(child, [...segments, child.name])
    else if (n.member) wanted.set(n.member, n)
  }
  collect(node, [])
  await mkdir(node.isDir ? target : path.dirname(target), { recursive: true })

  const write = async (member: string, input: NodeJS.ReadableStream, n: Node): Promise<void> => {
    const segments = memberSegments(member)!
    const dest = path.join(base, path.basename(at.archive, path.extname(at.archive)), ...segments)
    if (!dest.startsWith(base + path.sep)) throw new Error(t('error.invalidPath'))
    await mkdir(path.dirname(dest), { recursive: true })
    const partial = `${dest}.part`
    await pipeline(input, createWriteStream(partial))
    await rename(partial, dest)
    if (n.modified > 0) await utimes(dest, new Date(n.modified), new Date(n.modified)).catch(() => {})
  }

  if (at.format === 'zip') {
    const zip = await yauzl.openPromise(at.archive, { autoClose: true })
    for await (const entry of zip.eachEntry()) {
      const n = wanted.get(entry.fileName)
      if (n) await write(entry.fileName, await zip.openReadStreamPromise(entry), n)
    }
  } else {
    const extract = tar.extract()
    const done = pipeline(tarSource(at.archive, at.format), extract)
    for await (const entry of extract) {
      const n = wanted.get(entry.header.name)
      if (n && (entry.header.type === 'file' || entry.header.type === 'contiguous-file')) await write(entry.header.name, entry as unknown as NodeJS.ReadableStream, n) // a streamx Readable
      else entry.resume()
    }
    await done
  }
  return target
}

/** Ordinary paths unchanged; paths inside archives extracted first. */
export async function realPath(p: string): Promise<string> {
  const at = await locate(p)
  return at && at.inner.length > 0 ? materialize(at) : p
}

/** A folder that exists on disk for a path that may be inside an archive (the archive's folder). */
export async function outsideFolder(p: string): Promise<string> {
  const at = await locate(p)
  return at ? path.dirname(at.archive) : p
}

export async function cleanup(): Promise<void> {
  await rm(tempRoot(), { recursive: true, force: true }).catch(() => {})
}
