import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isMas } from '../mas'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { t } from '@shared/i18n'
import type { FileEntry, Listing, Place } from '@shared/types'
import * as archives from './archives'
import { toEntry } from './entries'
import { identity, sameIdentity, takenByAnother, type Identity } from './fileIdentity'
import * as remote from './remote'
import * as vfs from './vfs'

const isWindows = process.platform === 'win32'

/** Accepts only absolute paths (with optional leading ~) and returns them normalized. */
export function validatePath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) throw new Error(t('error.invalidPath'))
  const expanded = p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p
  if (!path.isAbsolute(expanded)) throw new Error(t('error.notAbsolute', { path: p }))
  return path.resolve(expanded)
}

export function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new Error(t('error.invalidName'))
  // Windows silently drops trailing dots and spaces, so trim them too.
  const trimmed = isWindows ? name.trim().replace(/[. ]+$/, '') : name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') throw new Error(t('error.emptyName'))
  if (trimmed.includes('\0')) throw new Error(t('error.invalidName'))
  if (isWindows ? /[\\/:*?"<>|]/.test(trimmed) : trimmed.includes('/')) {
    throw new Error(t(isWindows ? 'error.badCharsInName' : 'error.slashInName'))
  }
  return trimmed.normalize('NFC')
}

export async function list(dirPath: string): Promise<Listing> {
  const dir = validatePath(dirPath)
  const loc = await vfs.locate(dir)
  if (loc.kind === 'mounts') return remote.list('mounts')
  if (loc.kind === 'remote') return remote.list(loc.at)
  if (loc.kind === 'archive') return archives.list(loc.at, dir)
  const names = await fs.readdir(dir)
  const entries = (await Promise.all(names.map((n) => toEntry(dir, n)))).filter((e): e is FileEntry => e !== null)
  const parent = path.dirname(dir)
  return { path: dir, parent: parent === dir ? null : parent, entries }
}

export async function createFolder(parentPath: string): Promise<string> {
  const parent = validatePath(parentPath)
  const loc = await vfs.locate(parent)
  if (loc.kind === 'remote') return remote.createFolder(loc.at, t('fs.newFolder'))
  if (loc.kind !== 'local') throw new Error(t('error.archiveReadOnly'))
  for (let n = 1; n < 10_000; n++) {
    const base = t('fs.newFolder')
    const full = path.join(parent, n === 1 ? base : `${base} ${n}`)
    try {
      await fs.mkdir(full)
      return full
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(t('error.noFreeFolderName'))
}

/** Creates an empty "Nový soubor.txt" (or "Nový soubor N.txt") in parent, returns its full path. */
export async function createFile(parentPath: string): Promise<string> {
  const parent = validatePath(parentPath)
  const loc = await vfs.locate(parent)
  if (loc.kind === 'remote') return remote.createFile(loc.at, t('fs.newFile'), '.txt')
  if (loc.kind !== 'local') throw new Error(t('error.archiveReadOnly'))
  for (let n = 1; n < 10_000; n++) {
    const base = t('fs.newFile')
    const full = path.join(parent, `${n === 1 ? base : `${base} ${n}`}.txt`)
    try {
      await fs.writeFile(full, '', { flag: 'wx' })
      return full
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(t('error.noFreeFileName'))
}

export async function rename(itemPath: string, newName: string): Promise<string> {
  const from = validatePath(itemPath)
  await vfs.assertWritable(from)
  const name = validateName(newName)
  const loc = await vfs.locate(from)
  if (loc.kind === 'remote') return remote.renameItem(loc.at, name)
  const to = path.join(path.dirname(from), name)
  if (to === from) return from
  // A case-only rename on a case-insensitive disk finds the item itself under the new name; anything else
  // there is another item, which a rename would replace.
  if (await takenByAnother(from, to)) throw new Error(t('error.nameExists', { name }))
  await fs.rename(from, to)
  return to
}

/**
 * Renames several items at once. Every item first gets a temporary name, then its final one, so
 * names can be swapped or shifted (a→b, b→c) within the batch. If a step fails, the items that
 * were already moved are put back under their original names.
 */
export async function renameMany(items: unknown): Promise<string[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 10_000) throw new Error(t('error.invalidList'))
  const plan = items.map((item) => {
    const { path: p, name } = (item ?? {}) as { path?: unknown; name?: unknown }
    const from = validatePath(p)
    return { from, to: path.join(path.dirname(from), validateName(name)) }
  })
  for (const { from } of plan) await vfs.assertWritable(from)
  const locs = await Promise.all(plan.map(({ from }) => vfs.locate(from)))
  if (locs.some((l) => l.kind === 'remote')) return renameManyRemote(locs, plan)
  // Two targets differing only in case would clash on a case-insensitive disk, so they are refused everywhere.
  const key = (p: string): string => p.normalize('NFC').toLowerCase()
  const sources = (await Promise.all(plan.map(({ from }) => identity(from)))).filter((i): i is Identity => i !== null)
  const targets = new Set<string>()
  for (const { to } of plan) {
    if (targets.has(key(to))) throw new Error(t('error.nameExists', { name: path.basename(to) }))
    targets.add(key(to))
    // A target may be taken only by an item of the batch (which moves away first), compared by identity:
    // on a case-sensitive disk "FOTO.txt" next to "foto.txt" is another file.
    const taken = await identity(to)
    if (taken && !sources.some((s) => sameIdentity(s, taken))) throw new Error(t('error.nameExists', { name: path.basename(to) }))
  }

  const tag = `.afinder-rename-${process.pid}-${Date.now()}`
  const staged: { from: string; temp: string; to: string }[] = []
  try {
    for (const [i, { from, to }] of plan.entries()) {
      const temp = path.join(path.dirname(from), `${tag}-${i}`)
      await fs.rename(from, temp)
      staged.push({ from, temp, to })
    }
  } catch (err) {
    for (const s of staged.reverse()) await fs.rename(s.temp, s.from).catch(() => {})
    throw err
  }
  const done: string[] = []
  for (const s of staged) {
    try {
      await fs.rename(s.temp, s.to)
      done.push(s.to)
    } catch (err) {
      // Put this one and every remaining one back where it was.
      for (const rest of staged.slice(staged.indexOf(s))) await fs.rename(rest.temp, rest.from).catch(() => {})
      throw err
    }
  }
  return done
}

/** Renames on a remote connection one after the other, through temporary names like on disk. */
async function renameManyRemote(locs: vfs.Location[], plan: { from: string; to: string }[]): Promise<string[]> {
  const ats = locs.map((l) => {
    if (l.kind !== 'remote') throw new Error(t('error.invalidList'))
    return l.at
  })
  const tag = `.afinder-rename-${Date.now()}`
  const temps: string[] = []
  for (const [i, at] of ats.entries()) temps.push(await remote.renameItem(at, `${tag}-${i}`))
  const done: string[] = []
  for (const [i, temp] of temps.entries()) {
    const at = remote.locate(temp)
    if (!at || at === 'mounts') throw new Error(t('error.invalidPath'))
    done.push(await remote.renameItem(at, path.basename(plan[i].to)))
  }
  return done
}

export async function trash(paths: string[], parent?: BrowserWindow | null): Promise<void> {
  if (!Array.isArray(paths)) throw new Error(t('error.invalidList'))
  const valid = paths.map(validatePath)
  for (const p of valid) await vfs.assertWritable(p)
  const locs = await Promise.all(valid.map((p) => vfs.locate(p)))
  const remoteItems = locs.flatMap((l) => (l.kind === 'remote' ? [l.at] : []))
  // SFTP and S3 have no Trash: ask before deleting for good. SharePoint / OneDrive have a recycle bin.
  if (remoteItems.length > 0) {
    const recycled = remoteItems.every((at) => at.connection.type === 'graph')
    const detail = t(recycled ? 'remote.recycleDetail' : 'remote.deleteDetail')
    const options: Electron.MessageBoxOptions = {
      type: recycled ? 'question' : 'warning',
      message: t(recycled ? 'remote.recycleTitle' : 'remote.deleteTitle', { n: remoteItems.length }),
      detail: remoteItems.length === 1 ? `${path.basename(valid[locs.findIndex((l) => l.kind === 'remote')])}\n\n${detail}` : detail,
      buttons: [t(recycled ? 'remote.recycleConfirm' : 'remote.deleteConfirm'), t('dialog.cancel')],
      defaultId: 1,
      cancelId: 1
    }
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (response !== 0) return
    for (const at of remoteItems) await remote.removeItem(at)
  }
  for (const [i, p] of valid.entries()) if (locs[i].kind === 'local') await shell.trashItem(p)
}

export async function open(itemPath: string): Promise<void> {
  // Members of an archive open from their extracted copy.
  // Remote files open from a downloaded copy; changes made in other apps are not uploaded.
  const error = await shell.openPath(await vfs.realPath(validatePath(itemPath)))
  if (error) throw new Error(error)
}

export async function reveal(itemPath: string): Promise<void> {
  const p = validatePath(itemPath)
  const loc = await vfs.locate(p)
  if (loc.kind === 'remote' || loc.kind === 'mounts') throw new Error(t('remote.error.noReveal'))
  const target = loc.kind === 'archive' ? loc.at.archive : p
  const { revealInFinder } = await import('./defaultApp')
  if (!(await revealInFinder(target).catch(() => false))) shell.showItemInFolder(target)
}

/** Starts the first program that launches; resolves once one is running. */
function launchFirst(candidates: [string, string[]][], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const next = (i: number): void => {
      if (i >= candidates.length) return reject(new Error(t('error.noTerminal')))
      const [cmd, args] = candidates[i]
      // Argument arrays only – the path is never interpreted by a shell.
      const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' })
      child.once('error', () => next(i + 1))
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    }
    next(0)
  })
}

export async function openTerminal(dirPath: string): Promise<void> {
  const dir = await vfs.outsideFolder(validatePath(dirPath))
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile('open', ['-a', 'Terminal', dir], (err) => (err ? reject(err) : resolve()))
    })
  }
  if (isWindows) {
    // Windows Terminal if installed, else a plain console (a detached console app gets its own window).
    return launchFirst(
      [
        ['wt.exe', ['-d', dir]],
        ['powershell.exe', ['-NoExit']],
        ['cmd.exe', ['/K']]
      ],
      dir
    )
  }
  return launchFirst(
    [
      ['x-terminal-emulator', []],
      ['gnome-terminal', [`--working-directory=${dir}`]],
      ['konsole', ['--workdir', dir]],
      ['xfce4-terminal', [`--working-directory=${dir}`]],
      ['kitty', ['--directory', dir]],
      ['alacritty', ['--working-directory', dir]],
      ['xterm', []]
    ],
    dir
  )
}

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

export async function places(): Promise<Place[]> {
  const home = os.homedir()
  // In the sandbox Electron's paths point into the app's container; the real folders sit in the home.
  const userDir = (name: 'desktop' | 'documents' | 'downloads', dir: string): string => (isMas ? path.join(home, dir) : app.getPath(name))
  const result: Place[] = [
    { name: t('place.desktop'), path: userDir('desktop', 'Desktop'), icon: 'desktop' },
    { name: t('place.documents'), path: userDir('documents', 'Documents'), icon: 'documents' },
    { name: t('place.downloads'), path: userDir('downloads', 'Downloads'), icon: 'downloads' },
    { name: path.basename(home) || os.userInfo().username, path: home, icon: 'home' }
  ]

  if (isWindows) {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    const drives = await Promise.all(letters.map(async (l) => ((await exists(`${l}:\\`)) ? `${l}:\\` : null)))
    for (const d of drives) if (d) result.push({ name: t('place.drive', { drive: d.slice(0, 2) }), path: d, icon: d.startsWith('C') ? 'disk' : 'volume' })
    return result
  }

  if (process.platform === 'darwin') {
    result.push({ name: t('place.applications'), path: '/Applications', icon: 'apps' })
    result.push({ name: 'Macintosh HD', path: '/', icon: 'disk' })
    try {
      // AFINDER_VOLUMES points the demo (store screenshots) at its own folder instead of this Mac's disks.
      const volumes = process.env.AFINDER_VOLUMES || '/Volumes'
      for (const name of await fs.readdir(volumes)) {
        const full = path.join(volumes, name)
        // The boot volume appears in /Volumes as a symlink to "/".
        if ((await fs.realpath(full).catch(() => '/')) === '/') continue
        result.push({ name, path: full, icon: 'volume' })
      }
    } catch {
      // no /Volumes access – ignore
    }
    return result
  }

  // Linux and other Unixes: the root plus removable media mounted by udisks or by hand.
  result.push({ name: t('root.linux'), path: '/', icon: 'disk' })
  const user = os.userInfo().username
  for (const base of [`/media/${user}`, `/run/media/${user}`, '/mnt']) {
    try {
      for (const name of await fs.readdir(base)) {
        const full = path.join(base, name)
        if ((await fs.stat(full).catch(() => null))?.isDirectory()) result.push({ name, path: full, icon: 'volume' })
      }
    } catch {
      // not present – ignore
    }
  }
  return result
}

/** `name`, or `name 2.ext`, `name 3.ext` … – the first that does not exist in dir. */
export async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let n = 1; n < 10_000; n++) {
    const full = path.join(dir, n === 1 ? name : `${base} ${n}${ext}`)
    if (!(await fs.lstat(full).then(() => true, () => false))) return full
  }
  throw new Error(t('error.noFreeFileName'))
}
