// Building FileEntry objects. No Electron imports – also used by the search worker.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileEntry, FileKind } from '@shared/types'

const EXT_KIND: Record<string, FileKind> = {}
const kinds: [FileKind, string][] = [
  ['image', 'png jpg jpeg gif bmp tif tiff webp heic heif svg ico icns raw cr2 nef psd'],
  ['audio', 'mp3 wav aac m4a flac ogg aiff aif opus'],
  ['video', 'mp4 mov avi mkv webm m4v wmv flv mpg mpeg'],
  ['pdf', 'pdf'],
  ['text', 'txt md markdown rtf log csv tsv ini cfg conf'],
  ['code', 'ts tsx js jsx mjs cjs json html htm css scss less cs csproj sln java kt py rb go rs c h cpp hpp swift m sh zsh bash xml yml yaml toml sql php vue svelte lua'],
  ['archive', 'zip rar 7z tar gz tgz bz2 xz zst dmg iso pkg jar'],
  ['document', 'doc docx xls xlsx ppt pptx odt ods odp pages numbers key epub']
]
for (const [kind, exts] of kinds) for (const ext of exts.split(' ')) EXT_KIND[ext] = kind

/**
 * Dot files are hidden everywhere. Windows marks hidden items with a file attribute that Node does not
 * expose, so the well-known hidden system items are listed by name.
 */
const WINDOWS_HIDDEN = new Set([
  'desktop.ini',
  'thumbs.db',
  '$recycle.bin',
  'system volume information',
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'dumpstack.log',
  'dumpstack.log.tmp',
  '$windows.~bt',
  '$windows.~ws',
  '$winreagent',
  'recovery',
  'config.msi',
  'documents and settings',
  'programdata',
  'ntuser.dat',
  'ntuser.ini',
  'appdata'
])

export function isHiddenName(name: string, platform: string = process.platform): boolean {
  if (name.startsWith('.')) return true
  if (platform !== 'win32') return false
  const lower = name.toLowerCase()
  return WINDOWS_HIDDEN.has(lower) || lower.startsWith('ntuser.dat')
}

export function kindOf(name: string, isDir: boolean): FileKind {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (isDir) return ext === 'app' ? 'app' : 'folder'
  return EXT_KIND[ext] ?? 'other'
}

export async function toEntry(dir: string, name: string): Promise<FileEntry | null> {
  const full = path.join(dir, name)
  let st
  try {
    st = await fs.lstat(full)
  } catch {
    return null // vanished between readdir and lstat
  }
  const isSymlink = st.isSymbolicLink()
  let isDir = st.isDirectory()
  if (isSymlink) {
    try {
      isDir = (await fs.stat(full)).isDirectory()
    } catch {
      isDir = false // broken link
    }
  }
  const displayName = name.normalize('NFC')
  const kind = kindOf(displayName, isDir)
  return {
    name: displayName,
    path: full,
    isDir: isDir && kind !== 'app',
    isSymlink,
    hidden: isHiddenName(name),
    kind,
    size: isDir ? null : st.size,
    modified: st.mtimeMs
  }
}

