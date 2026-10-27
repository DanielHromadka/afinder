// Checks for a newer release at startup and then once a day, and installs it when the user agrees.
//
// Releases live in this public repository, DanielHromadka/afinder (the release workflow).
// electron-updater reads latest.yml / latest-mac.yml there on every platform: Windows runs the NSIS
// installer silently, the AppImage replaces itself, and macOS installs the signed .zip through
// Squirrel.Mac. Nothing downloads before the user says "Install".

import { app, BrowserWindow, dialog, shell } from 'electron'
import { t } from '@shared/i18n'
import { bodyLines } from '@shared/releaseNotes'
import { loadState } from './settings'
import { isMas } from '../mas'

const REPO = 'DanielHromadka/afinder'
const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000

/** Each version is offered once per run, so a daily check does not nag about one the user postponed. */
let offered: string | null = null
/** A download is running; a second check must not start another one. */
let installing = false

async function show(options: Electron.MessageBoxOptions): Promise<number> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response
}

async function ask(message: string, detail: string, action: string): Promise<boolean> {
  return (await show({ type: 'info', message, detail, buttons: [action, t('update.later')], defaultId: 0, cancelId: 1 })) === 0
}

const tell = (message: string, detail = ''): Promise<number> => show({ type: 'info', message, detail, buttons: ['OK'] })

/** Download progress on the Dock icon / taskbar button of every window; -1 removes it. */
const progress = (fraction: number): void => BrowserWindow.getAllWindows().forEach((w) => w.setProgressBar(fraction))

/** The installer for this Mac: the fallback when Squirrel.Mac cannot replace the app. */
const dmgUrl = (): string => `https://github.com/${REPO}/releases/latest/download/aFinder-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg`

let ready = false

/** A message box shows plain text: the release body from GitHub's feed is HTML, and a long list is cut short. */
const MAX_PROMPT_NOTES = 12
function notesText(notes: string | { note: string | null }[] | null | undefined): string {
  const lines = typeof notes === 'string' ? bodyLines(notes) : (notes ?? []).flatMap((n) => bodyLines(n.note))
  if (!lines.length) return ''
  const shown = lines.slice(0, MAX_PROMPT_NOTES).map((l) => `• ${l}`)
  if (lines.length > MAX_PROMPT_NOTES) shown.push(t('update.moreNotes', { count: lines.length - MAX_PROMPT_NOTES }))
  return `\n\n${t('update.whatsNew')}\n${shown.join('\n')}`
}

/** electron-updater is loaded only when a check runs. */
async function updater(): Promise<typeof import('electron-updater').autoUpdater> {
  // electron-updater is CommonJS and defines autoUpdater as a getter, which Node's ESM import cannot see as a
  // named export: it is only on `default`.
  const mod = await import('electron-updater')
  const autoUpdater = mod.autoUpdater ?? (mod as unknown as { default: typeof mod }).default.autoUpdater
  if (ready) return autoUpdater
  autoUpdater.autoDownload = false
  // Downloaded but not restarted yet (e.g. the restart failed): install when the user quits.
  autoUpdater.autoInstallOnAppQuit = true
  // Without a listener an 'error' event would throw; failures are reported where they are awaited.
  autoUpdater.on('error', (err) => console.error('Update failed', err))
  autoUpdater.on('download-progress', (p) => progress(Math.max(0, Math.min(1, p.percent / 100))))
  ready = true
  return autoUpdater
}

/** Downloads the update and restarts into it; the user already agreed, so no second question. */
async function install(autoUpdater: Awaited<ReturnType<typeof updater>>): Promise<void> {
  installing = true
  try {
    progress(0)
    await autoUpdater.downloadUpdate()
    progress(-1)
    // Windows: silent NSIS run and start the new version; macOS and AppImage ignore the arguments.
    autoUpdater.quitAndInstall(true, true)
  } catch (err) {
    progress(-1)
    console.error('Update install failed', err)
    const detail = err instanceof Error ? err.message : String(err)
    if (process.platform !== 'darwin') return void show({ type: 'warning', message: t('update.installFailed'), detail, buttons: ['OK'] })
    // macOS: never leave the user stuck on the old version; the installer still works.
    const open = await show({ type: 'warning', message: t('update.installFailed'), detail, buttons: [t('update.installer'), t('update.later')], defaultId: 0, cancelId: 1 })
    if (open === 0) void shell.openExternal(dmgUrl())
  } finally {
    installing = false
  }
}

/**
 * Squirrel.Mac replaces the app bundle in place, which fails when it runs from the mounted .dmg or a
 * translocated copy. Offers to move it to Applications first (macOS relaunches it from there).
 */
async function movedToApplications(): Promise<boolean> {
  if (process.platform !== 'darwin' || app.isInApplicationsFolder()) return true
  if (!(await ask(t('update.moveFirst'), t('update.moveDetail'), t('update.move')))) return false
  try {
    app.moveToApplicationsFolder()
  } catch (err) {
    console.error('Move to Applications failed', err)
    void shell.openExternal(dmgUrl())
  }
  return false
}

/** Only the packaged app updates (on Linux only as an AppImage); the App Store updates its own build. */
const canUpdate = (): boolean => app.isPackaged && !isMas && (process.platform !== 'linux' || Boolean(process.env.APPIMAGE))

/**
 * The automatic checks stay silent unless there is something new. A manual check (the button in the
 * settings) also says "you are up to date" and reports errors.
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!manual && !loadState().autoUpdate) return
  if (!canUpdate()) {
    if (manual) await tell(t(isMas ? 'update.appStore' : 'update.notInstalled'))
    return
  }
  if (installing) {
    if (manual) await tell(t('update.installing'))
    return
  }
  try {
    const autoUpdater = await updater()
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      if (manual) await tell(t('update.upToDate', { version: app.getVersion() }))
      return
    }
    const version = result.updateInfo.version
    if (offered === version && !manual) return
    offered = version
    const detail = t('update.availableDetail', { current: app.getVersion() }) + notesText(result.updateInfo.releaseNotes)
    if (!(await ask(t('update.available', { version }), detail, t('update.install')))) return
    if (!(await movedToApplications())) return
    // Not awaited: the settings button returns right away while the download runs in the background.
    void install(autoUpdater)
  } catch (err) {
    // Offline or GitHub unreachable: the automatic check tries again tomorrow.
    console.error('Update check failed', err)
    if (manual) await show({ type: 'warning', message: t('update.failed'), detail: err instanceof Error ? err.message : String(err), buttons: ['OK'] })
  }
}

/** Starts the checks at startup and then once a day. */
export function startUpdateChecks(): void {
  if (!canUpdate()) return
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
