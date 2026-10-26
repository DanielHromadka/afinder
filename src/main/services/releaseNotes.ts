// "What's new": the notes of the last releases, bundled into the app by the release workflow
// (build/release-notes.json → resources/release-notes.json), so they show offline and without asking GitHub.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { sanitizeNotes, type ReleaseNote } from '@shared/releaseNotes'
import { loadState, updateState } from './settings'

const file = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'release-notes.json') : path.join(app.getAppPath(), 'build', 'release-notes.json'))

export async function list(): Promise<ReleaseNote[]> {
  try {
    return sanitizeNotes(JSON.parse(await readFile(file(), 'utf8')))
  } catch {
    return []
  }
}

/**
 * True once after an update, for the window that asks first: the notes of this version open by themselves.
 * Not on a fresh install; a user from before this feature (no version stored yet) has seen the tour.
 */
export async function pending(): Promise<boolean> {
  const state = loadState()
  const current = app.getVersion()
  if (state.lastSeenVersion === current) return false
  const updated = state.lastSeenVersion !== '' || state.tourOffered
  updateState({ lastSeenVersion: current })
  return updated && (await list()).some((n) => n.version === current)
}
