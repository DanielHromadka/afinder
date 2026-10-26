import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { clipboard, ClipboardItem } from 'electron'
import type { FileClipboard } from '@shared/types'
import { validatePath } from './fileSystem'

// 'text/uri-list' maps to the native "copied files" clipboard format – NSFilenamesPboardType on
// macOS, CF_HDROP on Windows, text/uri-list on Linux – so files copied here paste in Finder /
// Explorer / the file manager and files copied there paste here.
const URI_LIST = 'text/uri-list'

/** Paths cut with ⌘X / Ctrl+X. The clipboard format has no "cut" flag, so we remember them ourselves. */
let cutPaths: string[] = []

// File URLs on the pasteboard come back decomposed (NFD), so compare paths in one normal form.
const same = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

export async function writeFiles(paths: string[], cut: boolean): Promise<void> {
  if (!Array.isArray(paths) || paths.length === 0) return
  const valid = paths.map(validatePath)
  await clipboard.write([new ClipboardItem({ [URI_LIST]: valid.map((p) => pathToFileURL(p).href).join('\r\n') })])
  cutPaths = cut ? valid : []
}

export async function readFiles(): Promise<FileClipboard> {
  const items = await clipboard.read()
  const item = items.find((i) => i.types.includes(URI_LIST))
  if (!item) return { paths: [], cut: false }
  const text = await (await item.getType(URI_LIST)).text()
  const paths = text
    .split(/\r?\n/)
    .filter((u) => u.startsWith('file:'))
    .map((u) => path.resolve(fileURLToPath(u))) // resolve() drops a trailing separator
  // The cut flag only applies while the clipboard still holds exactly the cut files.
  const cut = cutPaths.length === paths.length && cutPaths.every((p, i) => same(p, paths[i]))
  return { paths, cut }
}

/** Called after a move so moved files are no longer marked as cut. */
export function forgetCut(moved: string[]): void {
  cutPaths = cutPaths.filter((p) => !moved.some((m) => same(m, p)))
}
