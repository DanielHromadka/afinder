// aFinder as the system's file manager: what opens folders from other apps (double-click in Explorer, `open`,
// `xdg-open`, the Dock, Spotlight). macOS: LaunchServices' handler for public.folder plus NSFileViewer ("Show in
// Finder" in other apps). Windows: the folder and drive verb in HKCU. Linux: the xdg default for
// inode/directory. Each is per user and undone by setDefault(false). Only the installed app (not `npm run dev`,
// not the sandboxed Mac App Store build) can take this over.

import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { isMas } from '../mas'
import { loadState, updateState } from './settings'

const BUNDLE_ID = 'cz.attosoft.afinder'
/** The Windows verb aFinder adds to folders and drives, made their default. */
const VERB = 'afinder'
/** Linux: a hidden desktop entry of our own, so AppImage, deb and rpm all point at the running binary. */
const DESKTOP = 'afinder-folders.desktop'

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())))
  )
}

export const supported = (): boolean => app.isPackaged && !isMas && ['darwin', 'win32', 'linux'].includes(process.platform)

/** JXA reaches LaunchServices without native code of our own. */
const jxa = (script: string): Promise<string> => run('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreServices'); ${script}`])

// ── macOS ──────────────────────────────────────────────────────────────────────────────────────

const macHandler = (): Promise<string> =>
  jxa(`ObjC.castRefToObject($.LSCopyDefaultRoleHandlerForContentType($('public.folder'), 0xFFFFFFFF)).js`)

async function macSet(on: boolean): Promise<void> {
  const id = on ? BUNDLE_ID : 'com.apple.finder'
  const status = await jxa(`$.LSSetDefaultRoleHandlerForContentType($('public.folder'), 0xFFFFFFFF, $('${id}'))`)
  if (status && status !== '0') throw new Error(`LaunchServices: ${status}`)
  // "Show in Finder" in other apps (NSWorkspace) goes to the file viewer named here.
  if (on) await run('defaults', ['write', '-g', 'NSFileViewer', '-string', BUNDLE_ID])
  else await run('defaults', ['delete', '-g', 'NSFileViewer']).catch(() => {})
}

// ── Windows ────────────────────────────────────────────────────────────────────────────────────

const KEYS = ['HKCU\\Software\\Classes\\Directory\\shell', 'HKCU\\Software\\Classes\\Drive\\shell']

async function winIsDefault(): Promise<boolean> {
  const out = await run('reg', ['query', KEYS[0], '/ve']).catch(() => '')
  return new RegExp(`REG_SZ\\s+${VERB}\\s*$`, 'm').test(out)
}

async function winSet(on: boolean): Promise<void> {
  for (const key of KEYS) {
    if (on) {
      await run('reg', ['add', `${key}\\${VERB}`, '/ve', '/d', 'aFinder', '/f'])
      await run('reg', ['add', `${key}\\${VERB}\\command`, '/ve', '/d', `"${process.execPath}" "%1"`, '/f'])
      await run('reg', ['add', key, '/ve', '/d', VERB, '/f'])
    } else {
      // Without the default value Explorer's own "open" is the default again.
      await run('reg', ['delete', key, '/ve', '/f']).catch(() => {})
      await run('reg', ['delete', `${key}\\${VERB}`, '/f']).catch(() => {})
    }
  }
}

// ── Linux ──────────────────────────────────────────────────────────────────────────────────────

const applications = (): string => path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'applications')
const mimeApps = (): string => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mimeapps.list')
const linuxHandler = (): Promise<string> => run('xdg-mime', ['query', 'default', 'inode/directory']).catch(() => '')

async function linuxSet(on: boolean): Promise<void> {
  const entry = path.join(applications(), DESKTOP)
  if (on) {
    const previous = await linuxHandler()
    if (previous && previous !== DESKTOP) updateState({ previousFolderHandler: previous })
    // The AppImage runs from a mounted copy; $APPIMAGE is the file the user keeps.
    const exe = process.env.APPIMAGE || process.execPath
    await mkdir(applications(), { recursive: true })
    await writeFile(entry, `[Desktop Entry]\nType=Application\nName=aFinder\nExec="${exe.replace(/"/g, '\\"')}" %U\nIcon=afinder\nNoDisplay=true\nMimeType=inode/directory;\n`)
    await run('xdg-mime', ['default', DESKTOP, 'inode/directory'])
    return
  }
  const previous = loadState().previousFolderHandler
  if (previous) await run('xdg-mime', ['default', previous, 'inode/directory']).catch(() => {})
  else {
    // Nothing to go back to: take our line out, the desktop's own default applies again.
    const list = await readFile(mimeApps(), 'utf8').catch(() => null)
    if (list !== null) await writeFile(mimeApps(), list.replace(new RegExp(`^inode/directory=${DESKTOP.replace('.', '\\.')};?\\n?`, 'm'), ''))
  }
  await rm(entry, { force: true })
}

// ── All ────────────────────────────────────────────────────────────────────────────────────────

/** The last answer, for reveal() – which must not ask the system on every click. */
let known: boolean | null = null

export async function isDefault(): Promise<boolean> {
  if (!supported()) return (known = false)
  if (process.platform === 'darwin') known = (await macHandler().catch(() => '')).toLowerCase() === BUNDLE_ID
  else if (process.platform === 'win32') known = await winIsDefault()
  else known = (await linuxHandler()) === DESKTOP
  return known
}

export async function setDefault(on: boolean): Promise<boolean> {
  if (!supported()) throw new Error('unsupported')
  if (process.platform === 'darwin') await macSet(on)
  else if (process.platform === 'win32') await winSet(on)
  else await linuxSet(on)
  return isDefault()
}

/**
 * "Show in Finder" from aFinder itself. While aFinder is the Mac's file viewer, NSWorkspace would send it
 * back here, so it asks Finder directly (macOS asks once whether aFinder may control Finder). Elsewhere, and
 * while Finder is the viewer, false: the caller uses the system's own reveal.
 */
export async function revealInFinder(p: string): Promise<boolean> {
  if (process.platform !== 'darwin' || !(known ?? (await isDefault()))) return false
  await run('osascript', ['-l', 'JavaScript', '-e', `const f = Application('Finder'); f.reveal(Path(${JSON.stringify(p)})); f.activate()`])
  return true
}

/**
 * A folder (or file: its folder) another app asked aFinder to open – on the command line (Windows, Linux:
 * the registered verb and desktop entry pass it) or a second start. Flags and the app's own path are skipped.
 */
export function folderFromArgs(argv: string[]): string | null {
  for (const raw of argv.slice(1).reverse()) {
    // Explorer passes a drive as `"C:\"`, which arrives as C:" (the backslash escapes the quote).
    const arg = raw.replace(/:"$/, ':\\')
    if (arg.startsWith('-') || !path.isAbsolute(arg) || arg === app.getAppPath()) continue
    try {
      return statSync(arg).isDirectory() ? arg : path.dirname(arg)
    } catch {
      continue
    }
  }
  return null
}
