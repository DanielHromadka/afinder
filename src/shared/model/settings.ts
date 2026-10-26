// Settings, themes, views and the saved window layout.

import type { LanguageSetting } from '../i18n'
import type { ShortcutOverrides } from '../shortcuts'
import type { Workspace } from '../workspace'
import type { FileKind } from './files'
import type { AgentInfo, TerminalProfile } from './terminal'

export const THEMES = [
  { id: 'xp', name: 'Windows XP', background: '#ece9d8' },
  { id: 'apple', name: 'Moderní (macOS)', background: '#f5f5f7' },
  { id: 'classic', name: 'Klasický (Windows 98)', background: '#c0c0c0' },
  { id: 'cyberpunk', name: 'Cyberpunk', background: '#0b0b14' },
  { id: 'fbi', name: 'FBI', background: '#e9e6dc' },
  { id: 'jarvis', name: 'J.A.R.V.I.S.', background: '#020b16' },
  { id: 'barbie', name: 'Barbie', background: '#ffd6ea' },
  { id: 'batman', name: 'Batman', background: '#16171b' },
  { id: 'bitcoin', name: 'Bitcoin', background: '#0d0d0f' },
  { id: 'matrix', name: 'Matrix', background: '#000400' },
  { id: 'dos', name: 'DOS', background: '#0000aa' }
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Built-in icon sets: Luna (colourful XP), Flat (modern colour), Line (monochrome outline in the theme's text colour). */
export const ICON_SETS = ['luna', 'flat', 'line'] as const
export type IconSetId = (typeof ICON_SETS)[number]
/** File and place icons can follow the UI set ('match') or use their own. */
export type FileIconSetting = IconSetId | 'match'

export const GROUP_BY = ['none', 'year', 'month', 'week', 'day', 'kind', 'extension', 'size'] as const
export type GroupBy = (typeof GROUP_BY)[number]

/** How a tab lays out its files: the detail columns, names flowing in columns, or big icons. */
export const VIEW_MODES = ['details', 'list', 'icons'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/** Text and UI size, in percent of the default. */
export const UI_SCALES = [90, 100, 110, 125, 150] as const

export interface TabLayout {
  path: string
  groupBy: GroupBy
  /** The tab shows the preview pane. */
  preview: boolean
  /** Missing in layouts saved before views existed. */
  view?: ViewMode
}

export interface PaneLayout {
  tabs: TabLayout[]
  active: number
  /** Relative width (flex-grow) of the pane. */
  weight: number
}

/** Panes side by side, each with its own tabs. */
export interface Layout {
  panes: PaneLayout[]
  activePane: number
}

/**
 * What a window hands to the new window replacing it. Windows and Linux can switch the native window buttons
 * (macOS theme) only when a window opens, so the switch reopens it; its tabs, console sessions (still
 * running) and maximized area carry over.
 */
export interface WindowHandover {
  layout: Layout
  sessions: { id: string; profile: TerminalProfile; cwd: string; title: string; exitCode: number | null; agent?: AgentInfo }[]
  activeSession: string | null
  maximized: string | null
  /** Recent output of each running session (filled in by main), replayed into its new view. */
  output: Record<string, string>
}

/** A file or folder the user pinned to the side pane. */
export interface Favorite {
  path: string
  isDir: boolean
  /** Picks the icon. */
  kind: FileKind
}

export const MAX_FAVORITES = 100
export const MAX_PANES = 4
export const MAX_TABS = 30

export interface Settings {
  lastPath: string | null
  showHidden: boolean
  fuzzy: boolean
  /** The filter searches the whole subtree, not just the current folder. */
  recursive: boolean
  theme: ThemeId
  columnWidths: Record<string, number>
  layout: Layout | null
  language: LanguageSetting
  /** The user's workspaces (area layouts), shared by all windows. */
  workspaces: Workspace[]
  /** Workspace the window shows; each window keeps its own, the main window's is remembered. */
  activeWorkspace: string
  /** The console shows the list of its sessions and agents on the left. */
  consoleSidebar: boolean
  /** The console shows the conversation history of the session on the right. */
  consoleHistory: boolean
  /** Files and folders pinned to the Favorites section of the side pane. */
  favorites: Favorite[]
  /** Width of the preview pane in pixels. */
  previewWidth: number
  /** Keyboard shortcuts the user changed; the rest keep the platform defaults. */
  shortcuts: ShortcutOverrides
  /** The status bar shows an extra field specific to the theme (system stats, BTC price, …). */
  themeInfo: boolean
  /** The macOS theme's clean look: one light background, no separator lines, rounded cards. */
  cleanLook: boolean
  /** The bar with the workspace tabs and the Areas button above the areas. */
  workspaceBar: boolean
  /** The file list shows a row number column on the left. */
  lineNumbers: boolean
  /** Folders in the details view open in place (a chevron before the name) without navigating. */
  expandFolders: boolean
  /** Look for a new version at startup and once a day. */
  autoUpdate: boolean
  /** Opt-in local history and local-only semantic index; both default to false. */
  fileAssistantEnabled: boolean
  fileAssistantReadContent: boolean
  activityEnabled: boolean
  semanticEnabled: boolean
  activityRetentionDays: number
  /** Text and UI size in percent (one of UI_SCALES). */
  uiScale: number
  /** Icons of the toolbar, menus and the rest of the UI. */
  iconSet: IconSetId
  /** Icons of files, folders and places. */
  fileIconSet: FileIconSetting
  /** Short sounds matching the theme when navigating, creating, deleting …; off by default. */
  sounds: boolean
  /** 0–100. */
  soundVolume: number
  /** Generated hacker-style background music (main window only); off by default. */
  music: boolean
  /** 0–100. */
  musicVolume: number
  /** Local MCP server for AI agents; off by default. */
  mcpEnabled: boolean
  /** Agents may create, write, rename, copy, move and trash files (otherwise read-only tools only). */
  mcpAllowWrite: boolean
  /** Remember files opened, created and edited in aFinder for the Recent section; on by default. */
  recentFiles: boolean
  /** Paired phones can browse this computer through the relay; off by default. */
  companionEnabled: boolean
  /** Other computers with aFinder may connect (files, screen, control): Settings → Remote access. */
  computersEnabled: boolean
  /** wss:// address of the relay (mobile/relay); empty means the built-in one. */
  companionRelay: string
  /** Yahoo symbols in the Stocks area's favourites list. */
  stocks: string[]
  /** The Tools area keeps the last 50 copied texts (in memory only); off by default. */
  clipboardHistory: boolean
  /** The guided tour was offered once (after the first start); it stays in the Help menu and on F1. */
  tourOffered: boolean
}
