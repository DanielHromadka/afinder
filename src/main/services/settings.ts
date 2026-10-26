import path from 'node:path'
import { app, type Rectangle } from 'electron'
import { ACTIVITY_RETENTION } from '@shared/activity'
import { isLanguageSetting } from '@shared/i18n'
import { sanitizeShortcuts } from '@shared/shortcuts'
import { sanitizeStocks } from '@shared/stocks'
import { defaultWorkspaces, sanitizeWorkspaces } from '@shared/workspace'
import { readJsonFile, writeJsonFile } from './jsonStore'
import { FILE_KINDS, GROUP_BY, ICON_SETS, MAX_FAVORITES, MAX_PANES, MAX_TABS, THEMES, type DiskGrant, type Favorite, type FileIconSetting, type GroupBy, type IconSetId, type Layout, type Settings, UI_SCALES, VIEW_MODES, type ViewMode } from '@shared/types'

interface StoredState extends Settings {
  bounds: Rectangle | null
  maximized: boolean
  /** Bearer token for the MCP server; created on first start. Never sent to the renderer with the settings. */
  mcpToken: string
  mcpPort: number
  /** Mac App Store build only: folders granted through the open panel (services/diskAccess.ts). */
  diskGrants: DiskGrant[]
  /** The offer to make aFinder the system's file manager was shown (once, services/defaultApp.ts). */
  defaultAppAsked: boolean
  /** Linux: the folder handler before aFinder took over, given back when it lets go. */
  previousFolderHandler: string
  /** The version whose "What's new" was last shown; empty until the first start (services/releaseNotes.ts). */
  lastSeenVersion: string
}

const DEFAULTS: StoredState = {
  lastPath: null,
  showHidden: false,
  fuzzy: false,
  recursive: false,
  theme: 'apple',
  columnWidths: {},
  layout: null,
  language: 'auto',
  workspaces: defaultWorkspaces(),
  activeWorkspace: 'files',
  consoleSidebar: true,
  consoleHistory: false,
  favorites: [],
  previewWidth: 360,
  shortcuts: {},
  themeInfo: false,
  cleanLook: true,
  workspaceBar: false,
  lineNumbers: true,
  expandFolders: true,
  autoUpdate: true,
  fileAssistantEnabled: false,
  fileAssistantReadContent: false,
  activityEnabled: false,
  semanticEnabled: false,
  activityRetentionDays: 90,
  uiScale: 100,
  iconSet: 'flat',
  fileIconSet: 'match',
  sounds: false,
  soundVolume: 50,
  music: false,
  musicVolume: 35,
  mcpEnabled: false,
  mcpAllowWrite: false,
  recentFiles: true,
  companionEnabled: false,
  computersEnabled: false,
  companionRelay: '',
  clipboardHistory: false,
  tourOffered: false,
  stocks: ['AAPL', 'MSFT', 'NVDA', '^GSPC'],
  mcpToken: '',
  mcpPort: 47321,
  diskGrants: [],
  defaultAppAsked: false,
  lastSeenVersion: '',
  previousFolderHandler: '',
  bounds: null,
  maximized: false
}

const file = (): string => path.join(app.getPath('userData'), 'settings.json')

let state: StoredState | null = null

export function loadState(): StoredState {
  if (state) return state
  const read = readJsonFile<Partial<StoredState>>(file())
  // A broken file was moved aside (settings.json.corrupt-…) rather than overwritten by the defaults.
  if (read.status === 'corrupt') console.error(`Settings were unreadable and are reset; the old file is ${read.backup ?? 'lost'}`, read.error)
  if (read.status === 'unreadable') console.error('Cannot read settings', read.error)
  state = { ...DEFAULTS, ...(read.status === 'ok' && read.value && typeof read.value === 'object' ? read.value : {}) }
  state!.fileAssistantEnabled = state!.fileAssistantEnabled === true
  state!.fileAssistantReadContent = state!.fileAssistantReadContent === true
  state!.activityEnabled = state!.activityEnabled === true
  state!.sounds = state!.sounds === true
  state!.music = state!.music === true
  state!.mcpEnabled = state!.mcpEnabled === true
  state!.mcpAllowWrite = state!.mcpAllowWrite === true
  state!.recentFiles = state!.recentFiles !== false
  state!.companionEnabled = state!.companionEnabled === true
  state!.computersEnabled = state!.computersEnabled === true
  if (typeof state!.companionRelay !== 'string') state!.companionRelay = ''
  state!.clipboardHistory = state!.clipboardHistory === true
  state!.tourOffered = state!.tourOffered === true
  state!.defaultAppAsked = state!.defaultAppAsked === true
  if (typeof state!.previousFolderHandler !== 'string') state!.previousFolderHandler = ''
  if (typeof state!.lastSeenVersion !== 'string') state!.lastSeenVersion = ''
  state!.stocks = Array.isArray(state!.stocks) ? sanitizeStocks(state!.stocks) : DEFAULTS.stocks
  if (!Number.isInteger(state!.mcpPort) || state!.mcpPort < 1024 || state!.mcpPort > 65535) state!.mcpPort = DEFAULTS.mcpPort
  state!.semanticEnabled = state!.semanticEnabled === true
  state!.diskGrants = Array.isArray(state!.diskGrants) ? state!.diskGrants.filter((g) => typeof g?.path === 'string' && typeof g.bookmark === 'string') : []
  if (!(ACTIVITY_RETENTION as readonly number[]).includes(state!.activityRetentionDays)) state!.activityRetentionDays = 90
  // Before workspaces the side pane was one switch (folders or tasks) and the console a fixed bottom panel.
  const legacy = state as Partial<StoredState> & { leftPane?: string; consoleHeight?: number }
  state!.workspaces = sanitizeWorkspaces(state!.workspaces) ?? defaultWorkspaces(legacy.leftPane === 'folders' ? 'folders' : 'tasks')
  if (!state!.workspaces.some((w) => w.id === state!.activeWorkspace)) state!.activeWorkspace = state!.workspaces[0].id
  delete legacy.leftPane
  delete legacy.consoleHeight
  // Before the preview pane became per tab it was one window-wide switch.
  delete (state as Partial<StoredState> & { previewPane?: boolean }).previewPane
  // A theme that was removed since (CIA, Steampunk) falls back to the default.
  if (!THEMES.some((t) => t.id === state!.theme)) state!.theme = DEFAULTS.theme
  if (!(ICON_SETS as readonly unknown[]).includes(state!.iconSet)) state!.iconSet = DEFAULTS.iconSet
  if (state!.fileIconSet !== 'match' && !(ICON_SETS as readonly unknown[]).includes(state!.fileIconSet)) state!.fileIconSet = DEFAULTS.fileIconSet
  return state!
}

/**
 * Applies the patch and saves. The app goes on with the new values either way; the returned error (null when
 * saved) is for callers that tell the user, since the change would be gone after a restart.
 */
export function updateState(patch: Partial<StoredState>): Error | null {
  state = { ...loadState(), ...patch }
  try {
    writeJsonFile(file(), state)
    return null
  } catch (err) {
    console.error('Cannot save settings', err)
    return err instanceof Error ? err : new Error(String(err))
  }
}

export function publicSettings(): Settings {
  const { lastPath, showHidden, fuzzy, recursive, theme, columnWidths, layout, language, workspaces, activeWorkspace, consoleSidebar, consoleHistory, favorites, previewWidth, shortcuts, themeInfo, cleanLook, workspaceBar, lineNumbers, expandFolders, autoUpdate, uiScale, iconSet, fileIconSet, activityEnabled, semanticEnabled, activityRetentionDays, fileAssistantEnabled, fileAssistantReadContent, sounds, soundVolume, music, musicVolume, mcpEnabled, mcpAllowWrite, recentFiles, companionEnabled, computersEnabled, companionRelay, stocks, clipboardHistory, tourOffered } =
    loadState()
  return { lastPath, showHidden, fuzzy, recursive, theme, columnWidths, layout, language, workspaces, activeWorkspace, consoleSidebar, consoleHistory, favorites, previewWidth, shortcuts, themeInfo, cleanLook, workspaceBar, lineNumbers, expandFolders, autoUpdate, uiScale, iconSet, fileIconSet, activityEnabled, semanticEnabled, activityRetentionDays, fileAssistantEnabled, fileAssistantReadContent, sounds, soundVolume, music, musicVolume, mcpEnabled, mcpAllowWrite, recentFiles, companionEnabled, computersEnabled, companionRelay, stocks, clipboardHistory, tourOffered }
}

/** Only known keys with the right types may come from the renderer. */
export function sanitizeSettings(patch: unknown): Partial<Settings> {
  if (typeof patch !== 'object' || patch === null) return {}
  const p = patch as Record<string, unknown>
  const out: Partial<Settings> = {}
  if (typeof p.lastPath === 'string') out.lastPath = p.lastPath
  if (typeof p.showHidden === 'boolean') out.showHidden = p.showHidden
  if (typeof p.fuzzy === 'boolean') out.fuzzy = p.fuzzy
  if (typeof p.recursive === 'boolean') out.recursive = p.recursive
  if (typeof p.themeInfo === 'boolean') out.themeInfo = p.themeInfo
  if (typeof p.cleanLook === 'boolean') out.cleanLook = p.cleanLook
  if (typeof p.workspaceBar === 'boolean') out.workspaceBar = p.workspaceBar
  if (typeof p.lineNumbers === 'boolean') out.lineNumbers = p.lineNumbers
  if (typeof p.expandFolders === 'boolean') out.expandFolders = p.expandFolders
  if (typeof p.fileAssistantEnabled === 'boolean') out.fileAssistantEnabled = p.fileAssistantEnabled
  if (typeof p.fileAssistantReadContent === 'boolean') out.fileAssistantReadContent = p.fileAssistantReadContent
  if (typeof p.activityEnabled === 'boolean') out.activityEnabled = p.activityEnabled
  if (typeof p.semanticEnabled === 'boolean') out.semanticEnabled = p.semanticEnabled
  if ((ACTIVITY_RETENTION as readonly unknown[]).includes(p.activityRetentionDays)) out.activityRetentionDays = p.activityRetentionDays as number
  if (typeof p.autoUpdate === 'boolean') out.autoUpdate = p.autoUpdate
  if (typeof p.sounds === 'boolean') out.sounds = p.sounds
  if (typeof p.music === 'boolean') out.music = p.music
  const volume = (v: unknown): number | undefined => (typeof v === 'number' && v >= 0 && v <= 100 ? Math.round(v) : undefined)
  if (volume(p.soundVolume) !== undefined) out.soundVolume = volume(p.soundVolume)
  if (volume(p.musicVolume) !== undefined) out.musicVolume = volume(p.musicVolume)
  if (typeof p.mcpEnabled === 'boolean') out.mcpEnabled = p.mcpEnabled
  if (typeof p.mcpAllowWrite === 'boolean') out.mcpAllowWrite = p.mcpAllowWrite
  if (typeof p.recentFiles === 'boolean') out.recentFiles = p.recentFiles
  if (typeof p.companionEnabled === 'boolean') out.companionEnabled = p.companionEnabled
  if (typeof p.computersEnabled === 'boolean') out.computersEnabled = p.computersEnabled
  if (typeof p.companionRelay === 'string' && (p.companionRelay === '' || /^wss?:\/\/[^\s/]+(\/[^\s]*)?$/.test(p.companionRelay)) && p.companionRelay.length < 300) out.companionRelay = p.companionRelay
  if (Array.isArray(p.stocks)) out.stocks = sanitizeStocks(p.stocks)
  if (typeof p.clipboardHistory === 'boolean') out.clipboardHistory = p.clipboardHistory
  if (typeof p.tourOffered === 'boolean') out.tourOffered = p.tourOffered
  if ((UI_SCALES as readonly unknown[]).includes(p.uiScale)) out.uiScale = p.uiScale as number
  if ((ICON_SETS as readonly unknown[]).includes(p.iconSet)) out.iconSet = p.iconSet as IconSetId
  if (p.fileIconSet === 'match' || (ICON_SETS as readonly unknown[]).includes(p.fileIconSet)) out.fileIconSet = p.fileIconSet as FileIconSetting
  if (isLanguageSetting(p.language)) out.language = p.language
  if (Array.isArray(p.favorites)) out.favorites = sanitizeFavorites(p.favorites)
  if (p.shortcuts !== undefined) out.shortcuts = sanitizeShortcuts(p.shortcuts)
  if (typeof p.previewWidth === 'number' && p.previewWidth >= 160 && p.previewWidth <= 2000) out.previewWidth = Math.round(p.previewWidth)
  if (typeof p.consoleSidebar === 'boolean') out.consoleSidebar = p.consoleSidebar
  if (typeof p.consoleHistory === 'boolean') out.consoleHistory = p.consoleHistory
  const workspaces = sanitizeWorkspaces(p.workspaces)
  if (workspaces) out.workspaces = workspaces
  if (typeof p.activeWorkspace === 'string' && p.activeWorkspace.length <= 40) out.activeWorkspace = p.activeWorkspace
  if (p.layout === null) out.layout = null
  else if (p.layout !== undefined) {
    const layout = sanitizeLayout(p.layout)
    if (layout) out.layout = layout
  }
  const theme = THEMES.find((t) => t.id === p.theme)
  if (theme) out.theme = theme.id
  if (typeof p.columnWidths === 'object' && p.columnWidths !== null) {
    out.columnWidths = Object.fromEntries(
      Object.entries(p.columnWidths).filter(([, v]) => typeof v === 'number' && v > 20 && v < 2000)
    ) as Record<string, number>
  }
  return out
}

function sanitizeLayout(value: unknown): Layout | null {
  const l = value as Layout
  if (typeof l !== 'object' || l === null || !Array.isArray(l.panes)) return null
  const panes = l.panes
    .slice(0, MAX_PANES)
    .map((pane) => {
      if (typeof pane !== 'object' || pane === null || !Array.isArray(pane.tabs)) return null
      const tabs = pane.tabs
        .slice(0, MAX_TABS)
        .filter((t) => typeof t === 'object' && t !== null && typeof t.path === 'string' && path.isAbsolute(t.path))
        .map((t) => ({
          path: t.path,
          groupBy: (GROUP_BY as readonly string[]).includes(t.groupBy) ? t.groupBy : ('none' as GroupBy),
          preview: t.preview === true,
          view: (VIEW_MODES as readonly unknown[]).includes(t.view) ? (t.view as ViewMode) : 'details'
        }))
      if (tabs.length === 0) return null
      const active = Number.isInteger(pane.active) ? Math.min(Math.max(pane.active, 0), tabs.length - 1) : 0
      const weight = typeof pane.weight === 'number' && pane.weight > 0.05 && pane.weight < 20 ? pane.weight : 1
      return { tabs, active, weight }
    })
    .filter((pane) => pane !== null)
  if (panes.length === 0) return null
  const activePane = Number.isInteger(l.activePane) ? Math.min(Math.max(l.activePane, 0), panes.length - 1) : 0
  return { panes, activePane }
}

function sanitizeFavorites(list: unknown[]): Favorite[] {
  const seen = new Set<string>()
  const out: Favorite[] = []
  for (const f of list) {
    const fav = f as Favorite
    if (typeof fav !== 'object' || fav === null || typeof fav.path !== 'string' || !path.isAbsolute(fav.path)) continue
    if (seen.has(fav.path)) continue
    seen.add(fav.path)
    const kind = FILE_KINDS.includes(fav.kind) ? fav.kind : fav.isDir ? 'folder' : 'other'
    out.push({ path: fav.path, isDir: fav.isDir === true, kind })
    if (out.length === MAX_FAVORITES) break
  }
  return out
}
