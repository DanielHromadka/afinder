// Mac App Store build: the sandbox only lets aFinder into folders the user picked in an open panel. A
// security-scoped bookmark keeps each one across restarts; picking the whole disk ("/") once makes the
// sandboxed build browse like the web one.
import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { t } from '@shared/i18n'
import type { DiskGrant } from '@shared/types'
import { isMas } from '../mas'
import { loadState, updateState } from './settings'

/** Access stays open for the whole run: the stop functions are only called when a grant is removed. */
const open = new Map<string, () => void>()

function start(grant: DiskGrant): void {
  if (open.has(grant.path)) return
  try {
    open.set(grant.path, app.startAccessingSecurityScopedResource(grant.bookmark) as () => void)
  } catch (err) {
    console.error('Disk access bookmark failed', grant.path, err)
  }
}

/** At startup, before any service touches the user's files. */
export function restoreDiskAccess(): void {
  if (isMas) for (const g of loadState().diskGrants) start(g)
}

export const diskGrants = (): string[] => (isMas ? loadState().diskGrants.map((g) => g.path) : [])

/** Asks for a folder (the whole disk by default); returns the granted path, or null when cancelled. */
export async function grantDiskAccess(win: BrowserWindow | null, suggested = '/'): Promise<string | null> {
  if (!isMas) return null
  const options: Electron.OpenDialogOptions = {
    title: t('diskAccess.title'),
    message: t('diskAccess.panel'),
    buttonLabel: t('diskAccess.allow'),
    defaultPath: suggested,
    properties: ['openDirectory', 'showHiddenFiles', 'treatPackageAsDirectory'],
    securityScopedBookmarks: true
  }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const p = r.filePaths[0]
  const bookmark = r.bookmarks?.[0]
  if (r.canceled || !p || !bookmark) return null
  const grant = { path: path.resolve(p), bookmark }
  start(grant)
  updateState({ diskGrants: [...loadState().diskGrants.filter((g) => g.path !== grant.path), grant] })
  return grant.path
}

export function revokeDiskAccess(p: string): void {
  open.get(p)?.()
  open.delete(p)
  updateState({ diskGrants: loadState().diskGrants.filter((g) => g.path !== p) })
}
