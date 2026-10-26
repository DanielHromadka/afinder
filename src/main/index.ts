import { isMas } from './mas'
import { FileAssistantService } from './services/fileAssistantService'
import { LocalDecisionModel } from './services/fileAssistantModel'
import { assistantApplications, openAssistantApplication } from './services/assistantApplications'
import { planTransfer, runTransfer } from './services/transfer'
import * as assistantVfs from './services/vfs'
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from 'electron'
import { t, tos } from '@shared/i18n'
import * as defaultApp from './services/defaultApp'
import { IPC, TERMINAL_PROFILES, THEMES, type McpView, type ThemeId, type WindowHandover } from '@shared/types'
import appIconPath from '../../build/icon.png?asset'
import { registerIpc } from './ipc'
import { applyLanguage } from './services/language'
import { cleanup as cleanupArchives } from './services/archives'
import { closeAll as closeRemotes } from './services/remote'
import { handlePreviewProtocol, registerPreviewScheme } from './services/preview'
import { loadState, sanitizeSettings, updateState } from './services/settings'
import { setClipboardHistory, stop as stopTools } from './services/tools'
import { SearchService } from './services/searchService'
import { SizeService } from './services/sizeService'
import { dispose as disposeTails } from './services/tail'
import { TerminalService } from './services/terminals'
import { startUpdateChecks } from './services/updater'
import { restoreDiskAccess } from './services/diskAccess'
import { AutomationService } from './services/automationService'
import { ActivityService, type ActivityToken } from './services/activityService'
import { EmbeddedEmbeddings } from './services/activityEmbeddings'
import { executeAutomationScript } from './services/automationExecutor'
import { McpHost, newMcpToken } from './services/mcpServer'
import type { CompanionHost } from './services/companion'

const sizeServices = new Map<number, SizeService>()
const search = new SearchService()
const terminals = new TerminalService()
let automations: AutomationService | undefined
let activity: ActivityService | undefined
let fileAssistant: FileAssistantService | undefined
let mcp: McpHost | undefined
/** Loaded on first use: while the phone companion is off its code and crypto stay out of the main process. */
let companion: Promise<CompanionHost> | null = null
/** What each window's focused tab shows, newest report last. */
const views = new Map<number, McpView>()
/** The app's own windows (not the remote desktop or capture windows): which one is the main window, and
 * whether it was opened with the native window buttons of Windows and Linux. */
const appWindows = new Map<BrowserWindow, { main: boolean; native: boolean }>()
/** Windows asked for their state before being replaced, and the state waiting for each replacement. */
const handoverAsks = new Map<number, (state: unknown) => void>()
const handovers = new Map<number, WindowHandover>()

function currentView(): McpView | null {
  const focused = BrowserWindow.getFocusedWindow()
  const view = focused ? views.get(focused.webContents.id) : undefined
  return view ?? [...views.values()].at(-1) ?? null
}

function frontWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/** Starts or stops the MCP server to match the settings; creates the token on first start. */
function applyMcp(): Promise<unknown> | undefined {
  const state = loadState()
  if (state.mcpEnabled && !state.mcpToken) updateState({ mcpToken: newMcpToken() })
  return mcp?.apply(state.mcpEnabled, state.mcpPort, loadState().mcpToken)
}

function companionHost(): Promise<CompanionHost> {
  return (companion ??= import('./services/companion').then(
    ({ CompanionHost }) =>
      new CompanionHost({
        activity: activity!,
        changed: (status) => {
          for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.companionChanged, status)
        }
      })
  ))
}

/** Connects to or leaves the relay to match the settings. */
async function applyCompanion(): Promise<void> {
  const { companionEnabled, computersEnabled, companionRelay } = loadState()
  if (!companionEnabled && !computersEnabled && !companion) return
  ;(await companionHost()).apply({ phone: companionEnabled, computer: computersEnabled }, companionRelay)
}

/**
 * The Apple theme uses the native window buttons: on macOS the traffic lights (in its own 38px title bar),
 * on Windows and Linux the system's minimize, maximize and close (titleBarOverlay). Every other theme draws
 * its own window buttons.
 */
const nativeButtons = (theme: ThemeId): boolean => process.platform !== 'darwin' && theme === 'apple'

/** The overlay matches the theme's title bar: light or dark like the system, 38px grown with the text size. */
function overlayStyle(): Electron.TitleBarOverlayOptions {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: dark ? '#2b2b2d' : '#ececec', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: Math.round((38 * loadState().uiScale) / 100) }
}

function applyWindowTheme(win: BrowserWindow, theme: ThemeId): void {
  win.setBackgroundColor(THEMES.find((t) => t.id === theme)?.background ?? THEMES[0].background)
  if (process.platform !== 'darwin') return
  const native = theme === 'apple'
  // Vertically centred in the theme's own 38px title bar above the toolbar.
  if (native) win.setWindowButtonPosition({ x: 14, y: 12 })
  win.setWindowButtonVisibility(native)
}

/**
 * Windows and Linux add or remove the native buttons only when a window opens, so a window that needs the
 * other kind is replaced: it hands over its tabs and console (the sessions keep running) to a new one.
 */
function applyThemeToWindows(theme: ThemeId): void {
  for (const [win, w] of appWindows) {
    if (win.isDestroyed()) continue
    if (w.native !== nativeButtons(theme)) void replaceWindow(win, w.main)
    else applyWindowTheme(win, theme)
  }
}

async function replaceWindow(win: BrowserWindow, main: boolean): Promise<void> {
  const old = win.webContents
  appWindows.delete(win) // replaced once, however many theme switches follow
  const state = await new Promise<unknown>((resolve) => {
    handoverAsks.set(old.id, resolve)
    old.send(IPC.winHandover)
    setTimeout(() => resolve(null), 3000) // a hung page still gets replaced, from the saved layout
  })
  handoverAsks.delete(old.id)
  if (win.isDestroyed()) return
  const next = createWindow(main ? undefined : (views.get(old.id)?.folder ?? os.homedir()), { win, main })
  const handover = handoverOf(state, terminals.handover(old, next.webContents))
  if (handover) handovers.set(next.webContents.id, handover)
  next.once('ready-to-show', () => !win.isDestroyed() && win.destroy())
}

/** The page's state, checked: only sessions this window really owned, a layout settings would accept. */
function handoverOf(state: unknown, output: Record<string, string>): WindowHandover | null {
  const s = (state ?? {}) as Partial<WindowHandover>
  const layout = sanitizeSettings({ layout: s.layout }).layout
  if (!layout) return null
  const str = (v: unknown, max = 4096): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const sessions = (Array.isArray(s.sessions) ? s.sessions : [])
    .filter((x) => typeof x?.id === 'string' && Object.hasOwn(output, x.id) && TERMINAL_PROFILES.includes(x.profile))
    .map((x) => ({ id: x.id, profile: x.profile, cwd: str(x.cwd), title: str(x.title, 200), exitCode: null, ...(x.agent && typeof x.agent === 'object' && { agent: x.agent }) }))
  const activeSession = typeof s.activeSession === 'string' && Object.hasOwn(output, s.activeSession) ? s.activeSession : null
  return { layout, sessions, activeSession, maximized: typeof s.maximized === 'string' ? s.maximized : null, output }
}

/** The text size setting zooms the whole UI, so icons, rows and paddings grow with the text. */
function applyScaleToWindows(scale: number): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.setZoomFactor(scale / 100)
  for (const [win, w] of appWindows) if (w.native && !win.isDestroyed()) win.setTitleBarOverlay(overlayStyle())
}

/**
 * The first window restores the saved bounds and layout. Further windows (⌘N) open the given
 * folder, cascaded from the focused window, and do not overwrite the saved bounds. `replacing`: the window
 * takes the place (and size) of one being replaced, see replaceWindow.
 */
function createWindow(openPath?: string, replacing?: { win: BrowserWindow; main: boolean }): BrowserWindow {
  const { bounds, maximized, theme } = loadState()
  const from = replacing ? null : openPath ? BrowserWindow.getFocusedWindow()?.getBounds() : null
  const at = replacing?.win.getNormalBounds()
  const isMain = replacing ? replacing.main : !openPath
  const native = nativeButtons(theme)
  const win = new BrowserWindow({
    width: at?.width ?? from?.width ?? bounds?.width ?? 1100,
    height: at?.height ?? from?.height ?? bounds?.height ?? 720,
    x: at?.x ?? (from ? from.x + 28 : bounds?.x),
    y: at?.y ?? (from ? from.y + 28 : bounds?.y),
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'aFinder',
    // The renderer draws the title bar; the window buttons are its own, or the system's in the Apple theme.
    titleBarStyle: 'hidden',
    ...(native && { titleBarOverlay: overlayStyle() }),
    ...(process.platform === 'darwin' ? {} : { icon: appIconPath }),
    backgroundColor: THEMES.find((t) => t.id === theme)?.background ?? THEMES[0].background,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--afinder-home=${os.homedir()}`, `--afinder-version=${app.getVersion()}`, ...(isMas ? ['--afinder-mas=1'] : []), ...(openPath ? [`--afinder-open=${openPath}`] : [])]
    }
  })
  applyWindowTheme(win, theme)
  appWindows.set(win, { main: isMain, native })
  if (replacing ? replacing.win.isMaximized() : maximized && isMain) win.maximize()
  if (replacing?.win.isFullScreen()) win.setFullScreen(true)

  const id = win.webContents.id
  sizeServices.set(id, new SizeService(win.webContents))

  // Chromium resets the zoom on every load.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(loadState().uiScale / 100))
  win.once('ready-to-show', () => win.show())
  win.on('enter-full-screen', () => win.webContents.send(IPC.winFullScreen, true))
  win.on('leave-full-screen', () => win.webContents.send(IPC.winFullScreen, false))
  win.on('close', () => {
    if (isMain || BrowserWindow.getAllWindows().length === 1) {
      updateState({ bounds: win.getNormalBounds(), maximized: win.isMaximized() })
    }
  })
  win.on('closed', () => {
    appWindows.delete(win)
    handovers.delete(id)
    sizeServices.get(id)?.dispose()
    sizeServices.delete(id)
    search.forget(id)
    terminals.forget(id)
    activity?.forgetWindow(id)
    fileAssistant?.cancel(id)
    views.delete(id)
  })

  // Never navigate the app window away or open new windows; external links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

if (process.platform === 'win32') app.setAppUserModelId('cz.attosoft.afinder')
registerPreviewScheme()

// `npm run dev` (renderer served by Vite) gets its own profile and no instance lock, so a fresh build can
// start next to the installed aFinder and next to other dev runs. Smoke tests set their own userData.
const devServer = !!process.env.ELECTRON_RENDERER_URL
if (devServer) app.setPath('userData', path.join(app.getPath('appData'), 'aFinder Dev'))

/** Shows a folder (a file: its folder) in a new tab of the front window, or in a new window when none is open. */
async function openFolder(p: string): Promise<void> {
  const target = (await stat(p).catch(() => null))?.isDirectory() === false ? path.dirname(p) : p
  const win = frontWindow()
  if (!win) return void createWindow(target)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(IPC.mcpOpen, target)
}

/**
 * A folder another app asked aFinder to open (aFinder as the default file manager): macOS sends open-file,
 * Windows and Linux start aFinder with the folder as an argument. Before the first window exists it opens
 * in a window of its own instead of the restored layout.
 */
let startFolder: string | null = defaultApp.folderFromArgs(process.argv)
app.on('open-file', (e, p) => {
  e.preventDefault()
  if (app.isReady() && BrowserWindow.getAllWindows().length > 0) void openFolder(p)
  else startFolder = p
})

/** Asks once (from the second start on, not next to the tour offer) whether aFinder should open folders. */
async function offerDefaultApp(): Promise<void> {
  const state = loadState()
  if (!defaultApp.supported() || state.defaultAppAsked || !state.tourOffered || (await defaultApp.isDefault())) return
  const win = frontWindow()
  if (!win) return
  updateState({ defaultAppAsked: true })
  const options = { type: 'question' as const, message: t('defaultApp.offer'), detail: tos('defaultApp.offerDetail'), buttons: [t('defaultApp.set'), t('defaultApp.notNow')], defaultId: 0, cancelId: 1 }
  if ((await dialog.showMessageBox(win, options)).response !== 0) return
  await defaultApp.setDefault(true).catch((err: Error) => dialog.showMessageBox(win, { type: 'warning', message: t('defaultApp.failed'), detail: err.message }))
}

// A second installed instance must not start a second scheduler; it opens another window here instead.
if (!devServer && !app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(() => {
  applyLanguage()
  restoreDiskAccess()
  // Windows and Linux show no menu bar (the title bar is our own). Without a menu its accelerators
  // (Ctrl+C, Ctrl+W, …) cannot steal keys from the integrated console; inputs still copy and paste.
  // macOS keeps the default menu: its Edit roles make ⌘C / ⌘V work in inputs and the console.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  // The packaged app gets its icon from the bundle; in development set it on the Dock.
  if (!app.isPackaged) app.dock?.setIcon(appIconPath)
  handlePreviewProtocol()
  activity = new ActivityService(path.join(app.getPath('userData'), 'activity', 'history.sqlite'), loadState(), () => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.activityChanged)
  }, new EmbeddedEmbeddings(path.join(app.getPath('userData'), 'embedding-model')))
  fileAssistant = new FileAssistantService(path.join(app.getPath('userData'), 'file-assistant', 'tags.json'), loadState(), new LocalDecisionModel(path.join(app.getPath('userData'), 'file-assistant', 'model')), {
    assertLocal: async (p) => { if (await assistantVfs.isVirtual(p)) throw new Error('The local assistant works with local files only') },
    applications: assistantApplications,
    openApplication: (file, application) => activity!.track({ action: 'open', folder: path.dirname(file), paths: [file] }, () => openAssistantApplication(file, application)),
    transfer: async (sources, dest, mode) => {
      const plan = await planTransfer({ sources, dest, mode })
      return activity!.track({ action: mode, folder: dest, paths: sources }, () => runTransfer(plan, 'keepBoth', { cancelled: false }, () => {}), (created) => ({ destinations: created, count: created.length }))
    },
    changed: () => { for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.assistantChanged) }
  })
  const trackedRuns = new Map<string, ActivityToken>()
  automations = new AutomationService(path.join(app.getPath('userData'), 'automations'), executeAutomationScript, () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(IPC.automationChanged)
    }
  }, {
    started: (_item, run) => { const token = activity!.begin(); if (token) trackedRuns.set(run.id, token) },
    finished: (item, run) => {
      const token = trackedRuns.get(run.id); trackedRuns.delete(run.id)
      if (token) activity!.record({ action: 'automation', label: item.name, outcome: run.status === 'success' ? 'success' : run.status === 'cancelled' ? 'cancelled' : 'failed' }, token)
    }
  })
  mcp = new McpHost({
    search,
    activity,
    view: currentView,
    open: openFolder,
    window: frontWindow,
    allowWrite: () => loadState().mcpAllowWrite,
    showHidden: () => loadState().showHidden
  })
  void applyMcp()
  void applyCompanion()
  setClipboardHistory(loadState().clipboardHistory)
  registerIpc({
    companion: { host: companionHost, apply: applyCompanion },
    mcp: {
      info: () => ({ ...mcp!.info(), token: loadState().mcpToken }),
      newToken: async () => {
        updateState({ mcpToken: newMcpToken() })
        await applyMcp()
        return { ...mcp!.info(), token: loadState().mcpToken }
      },
      apply: applyMcp,
      reportView: (sender, view) => {
        views.delete(sender.id)
        views.set(sender.id, view)
      }
    },
    sizeServiceFor: (sender) => sizeServices.get(sender.id),
    search,
    terminals,
    automations,
    activity,
    fileAssistant,
    openWindow: (p) => void createWindow(p),
    windows: {
      handoverState: (sender, state) => handoverAsks.get(sender.id)?.(state),
      takeHandover: (sender) => {
        const h = handovers.get(sender.id) ?? null
        handovers.delete(sender.id)
        return h
      }
    },
    applyTheme: applyThemeToWindows,
    applyScale: applyScaleToWindows
  })
  const folder = startFolder
  startFolder = null
  const first = createWindow(folder ?? undefined)
  first.once('ready-to-show', () => setTimeout(() => void offerDefaultApp(), 4000))
  // The system's buttons in the Apple theme follow its light or dark title bar.
  nativeTheme.on('updated', () => {
    for (const [win, w] of appWindows) if (w.native && !win.isDestroyed()) win.setTitleBarOverlay(overlayStyle())
  })
  startUpdateChecks()
  automations.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', (_e, argv) => {
  if (!app.isReady()) return
  const folder = defaultApp.folderFromArgs(argv)
  if (folder) void openFolder(folder)
  else createWindow(loadState().lastPath ?? os.homedir())
})

let stoppingAutomations = false
app.on('before-quit', (event) => {
  if (!automations || stoppingAutomations) return
  event.preventDefault()
  stoppingAutomations = true
  fileAssistant?.dispose()
  void automations.dispose().then(() => activity?.dispose()).finally(() => app.quit())
})

app.on('will-quit', () => {
  void cleanupArchives()
  void closeRemotes()
  search.dispose()
  terminals.dispose()
  disposeTails()
  void mcp?.stop()
  void companion?.then((c) => c.stop())
  stopTools()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
