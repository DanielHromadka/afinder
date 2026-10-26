// File preview: the afinder-file:// protocol (bytes with HTTP ranges, for <img>, <video>, the PDF
// viewer and text), Word → HTML, the first rows of a spreadsheet, and OS thumbnails for the rest.

import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { nativeImage, protocol } from 'electron'
import { t } from '@shared/i18n'
import { editedCopyName, imageOutput } from '@shared/imageEdit'
import { mimeType, parseRange, pathFromPreviewUrl, PREVIEW_SCHEME } from '@shared/preview'
import type { SheetPreview } from '@shared/types'
import * as remote from './remote'
import * as vfs from './vfs'
import { validatePath } from './fileSystem'

/** Word and Excel files are parsed whole – refuse the ones that would stall the main process. */
const MAX_OFFICE_BYTES = 40 * 1024 * 1024
const MAX_ROWS = 500
/** Remote files are downloaded whole before they can be previewed. */
const MAX_REMOTE_PREVIEW_BYTES = 200 * 1024 * 1024
const MAX_COLUMNS = 50

/**
 * Only this app's own pages can reach the scheme (it is registered on the app session), so any
 * origin may read it – the packaged page's origin is the opaque "null" of file://.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length'
}

/** Must run before the app is ready. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // stream: media elements can seek; supportFetchAPI + corsEnabled: the text viewer fetches ranges
    // from the app page (file:// when packaged, http://localhost in development).
    { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ])
}

export function handlePreviewProtocol(): void {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const raw = pathFromPreviewUrl(request.url)
    let file: string
    try {
      file = await vfs.realPath(validatePath(raw), MAX_REMOTE_PREVIEW_BYTES)
    } catch {
      return new Response(null, { status: 400 })
    }
    let size: number
    try {
      const s = await stat(file)
      if (!s.isFile()) return new Response(null, { status: 404 })
      size = s.size
    } catch {
      return new Response(null, { status: 404 })
    }

    const headers = new Headers({
      ...CORS,
      'Content-Type': mimeType(path.basename(file)),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      // The preview never runs what it shows: SVGs and PDFs opened as documents get no scripts.
      'Content-Security-Policy': "script-src 'none'"
    })
    const range = parseRange(request.headers.get('Range'), size)
    if (range === 'invalid') {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    const { start, end } = range ?? { start: 0, end: size - 1 }
    headers.set('Content-Length', String(Math.max(0, end - start + 1)))
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    const body =
      request.method === 'HEAD' || size === 0
        ? null
        : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>)
    return new Response(body, { status: range ? 206 : 200, headers })
  })
}

async function checkOfficeSize(file: string): Promise<void> {
  const s = await stat(file)
  if (s.size > MAX_OFFICE_BYTES) throw new Error(t('preview.tooLarge'))
}

/** Word document as HTML (images inlined as data URIs). Rendered by the renderer in a sandboxed frame. */
export async function docxHtml(p: unknown): Promise<string> {
  const file = await vfs.realPath(validatePath(p), MAX_OFFICE_BYTES)
  await checkOfficeSize(file)
  // Loaded on first use: the Office parsers cost ~15 MB each in the main process.
  const { default: mammoth } = await import('mammoth')
  const result = await mammoth.convertToHtml({ path: file })
  return result.value
}

/** The first rows and columns of one sheet, as display strings. */
export async function sheet(p: unknown, index: unknown): Promise<SheetPreview> {
  const file = await vfs.realPath(validatePath(p), MAX_OFFICE_BYTES)
  await checkOfficeSize(file)
  const { default: readXlsxFile } = await import('read-excel-file/node')
  const sheets = await readXlsxFile(file)
  const i = typeof index === 'number' && index >= 0 && index < sheets.length ? Math.floor(index) : 0
  const data = sheets[i]?.data ?? []
  const width = Math.min(MAX_COLUMNS, data.reduce((w, row) => Math.max(w, row.length), 0))
  const cell = (v: unknown): string =>
    v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().replace(/T00:00:00\.000Z$/, '').replace('.000Z', 'Z') : String(v)
  return {
    sheets: sheets.map((s) => s.sheet),
    index: i,
    rows: data.slice(0, MAX_ROWS).map((row) => Array.from({ length: width }, (_, c) => cell(row[c]))),
    truncated: data.length > MAX_ROWS || data.some((row) => row.length > MAX_COLUMNS)
  }
}

/**
 * Saves text edited in the preview. Refuses when the file changed on disk since it was loaded
 * (expectedModified, ms) unless force is set. Returns the new modification time.
 */
export async function saveText(p: unknown, text: unknown, expectedModified: unknown, bom: unknown, force: unknown): Promise<number> {
  const file = validatePath(p)
  await vfs.assertWritable(file)
  if (typeof text !== 'string') throw new Error(t('error.invalidOption'))
  const loc = await vfs.locate(file)
  if (loc.kind === 'remote') {
    return remote.writeText(loc.at, (bom === true ? '\uFEFF' : '') + text, force !== true && typeof expectedModified === 'number' ? expectedModified : null)
  }
  const before = await stat(file)
  if (!before.isFile()) throw new Error(t('error.invalidPath'))
  if (force !== true && typeof expectedModified === 'number' && Math.abs(before.mtimeMs - expectedModified) > 1) {
    throw new Error(t('preview.changedOnDisk'))
  }
  await writeFile(file, (bom === true ? '\uFEFF' : '') + text, 'utf8')
  return (await stat(file)).mtimeMs
}

/** Upper bound for an encoded image coming from the editor. */
const MAX_IMAGE_BYTES = 512 * 1024 * 1024

/**
 * Writes an image edited in Quick Look. In place it refuses when the file changed since it was loaded
 * (unless force) and when the format cannot be encoded; as a copy it picks a free `name (edited).ext`.
 */
export async function saveImage(p: unknown, data: unknown, expectedModified: unknown, force: unknown, copy: unknown): Promise<{ path: string; modified: number }> {
  const file = validatePath(p)
  if (!(data instanceof Uint8Array) || data.length === 0 || data.length > MAX_IMAGE_BYTES) throw new Error(t('error.invalidOption'))
  const out = imageOutput(path.basename(file))
  if (copy !== true) {
    if (!out.overwrite) throw new Error(t('error.invalidOption'))
    const modified = await saveBytes(file, data, force !== true && typeof expectedModified === 'number' ? expectedModified : null)
    return { path: file, modified }
  }
  const dir = path.dirname(file)
  await vfs.assertWritable(dir)
  const dirLoc = await vfs.locate(dir)
  const taken = new Set<string>()
  // Remote folders cannot be probed synchronously, so each candidate is checked in turn.
  for (let n = 0; n < 100; n++) {
    const target = path.join(dir, editedCopyName(path.basename(file), out.ext, t('imageEditor.copySuffix'), (c) => taken.has(c)))
    const exists = dirLoc.kind === 'remote' ? await remote.exists(remote.locate(target) as remote.Located) : await stat(target).then(() => true, () => false)
    if (!exists) return { path: target, modified: await createBytes(target, data) }
    taken.add(path.basename(target))
  }
  throw new Error(t('error.invalidOption'))
}

async function saveBytes(file: string, data: Uint8Array, expectedModified: number | null): Promise<number> {
  await vfs.assertWritable(file)
  const loc = await vfs.locate(file)
  if (loc.kind === 'remote') return remote.writeText(loc.at, data, expectedModified)
  const before = await stat(file)
  if (!before.isFile()) throw new Error(t('error.invalidPath'))
  if (expectedModified !== null && Math.abs(before.mtimeMs - expectedModified) > 1) throw new Error(t('preview.changedOnDisk'))
  await writeFile(file, data)
  return (await stat(file)).mtimeMs
}

async function createBytes(target: string, data: Uint8Array): Promise<number> {
  const loc = await vfs.locate(target)
  if (loc.kind !== 'remote') {
    await writeFile(target, data, { flag: 'wx' })
    return (await stat(target)).mtimeMs
  }
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'afinder-image-'))
  try {
    const local = path.join(tmp, path.basename(target))
    await writeFile(local, data)
    await remote.upload(local, loc.at)
    return Date.now()
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** Quick Look (macOS) or the Explorer thumbnail (Windows) as a PNG data URL; null where there is none. */
export async function thumbnail(p: unknown, size: unknown): Promise<string | null> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null
  const file = await vfs.realPath(validatePath(p), MAX_REMOTE_PREVIEW_BYTES)
  const px = typeof size === 'number' && size >= 64 && size <= 2048 ? Math.round(size) : 512
  try {
    const image = await nativeImage.createThumbnailFromPath(file, { width: px, height: px })
    return image.isEmpty() ? null : image.toDataURL()
  } catch {
    return null // no thumbnail provider for this type
  }
}
