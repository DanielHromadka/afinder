// JSON files aFinder keeps in its data folder (settings, automations). Writes go to a temporary file that
// replaces the old one in one rename, so a crash or a full disk never leaves half a file behind. A file
// that no longer parses is moved aside instead of being overwritten, so it can still be recovered.

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

export type JsonRead<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  /** Not valid JSON; the file was moved to `backup` (null when even that failed). */
  | { status: 'corrupt'; backup: string | null; error: unknown }
  /** Exists but cannot be read (permissions, I/O); left untouched. */
  | { status: 'unreadable'; error: unknown }

export function readJsonFile<T>(file: string): JsonRead<T> {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { status: 'missing' } : { status: 'unreadable', error }
  }
  try {
    return { status: 'ok', value: JSON.parse(text) as T }
  } catch (error) {
    const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(file, backup)
      return { status: 'corrupt', backup, error }
    } catch {
      return { status: 'corrupt', backup: null, error }
    }
  }
}

/** Replaces the file with `value` as JSON, readable by the user only; throws when it cannot. */
export function writeJsonFile(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
