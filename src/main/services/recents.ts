// Recently touched files, kept in <userData>/recents.json and shown in every window's task pane.
// Only local files are remembered: archive members and remote copies would point at temp folders.

import { readFileSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { addRecent, sanitizeRecents, type RecentAction, type RecentFile } from '@shared/recents'
import { IPC, type FileKind } from '@shared/types'
import { kindOf } from './entries'
import { loadState } from './settings'
import * as vfs from './vfs'

let list: RecentFile[] | null = null
let saving: ReturnType<typeof setTimeout> | null = null

const file = (): string => path.join(app.getPath('userData'), 'recents.json')

function load(): RecentFile[] {
  if (list) return list
  try {
    list = sanitizeRecents(JSON.parse(readFileSync(file(), 'utf8')))
  } catch {
    list = []
  }
  return list
}

/** Writes soon (a batch of edits is one write) and tells every window. */
function changed(): void {
  if (!saving) {
    saving = setTimeout(() => {
      saving = null
      writeFile(file(), JSON.stringify(list ?? [])).catch((err) => console.error('Cannot save recent files', err))
    }, 500)
  }
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.recentsChanged)
}

/** Remembers a file the user worked with; folders, virtual paths and a turned-off setting are ignored. */
export async function touch(p: string, action: RecentAction): Promise<void> {
  try {
    if (!loadState().recentFiles || (await vfs.locate(p)).kind !== 'local' || !(await stat(p)).isFile()) return
    list = addRecent(load(), { path: p, at: Date.now(), action })
    changed()
  } catch {
    // Remembering is a convenience; it must never fail the operation that triggered it.
  }
}

/** The list without files that are gone (deleted or moved outside aFinder). */
export async function recent(): Promise<(RecentFile & { kind: FileKind })[]> {
  if (!loadState().recentFiles) return []
  const all = load()
  const alive = await Promise.all(all.map((r) => stat(r.path).then((s) => s.isFile(), () => false)))
  return all.filter((_, i) => alive[i]).map((r) => ({ ...r, kind: kindOf(path.basename(r.path), false) }))
}

export function forget(p: unknown): void {
  if (typeof p !== 'string') return
  list = load().filter((r) => r.path !== p)
  changed()
}

export function clear(): void {
  list = []
  changed()
}
