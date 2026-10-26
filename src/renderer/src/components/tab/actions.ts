import type { AssistantMode } from '@shared/fileAssistant'
import type { Favorite, FileEntry, GroupBy, Listing, Place, RunTarget, ScreenshotMode, Settings, TerminalProfile, TerminalProfiles, TransferMode, ViewMode } from '@shared/types'
import type { RemoteMount } from '@shared/remote'
import type { MenuItem } from '../ContextMenu'
import type { Row } from '../FileList'
import type { History } from './useDirectoryNavigation'

// What a tab can do, in one object: its context menu, its palette commands and its keyboard shortcuts are
// built from this, so the three stay in step and the tab component only wires the state together.

export interface TabContext {
  path: string | null
  listing: Listing | null
  rows: Row[]
  selection: Set<string>
  selectedEntries: FileEntry[]
  focusIndex: number
  parentFocused: boolean
  hasParentRow: boolean
  searchMode: boolean
  /** Folders open in place (details view without search, groups or tiles). */
  treeOn: boolean
  expanded: Set<string>
  filter: string
  settings: Settings
  view: ViewMode
  groupBy: GroupBy
  preview: boolean
  virtual: { key: string; label: string } | null
  history: History
  canArchive: boolean
  /** Agent for AI actions (the first installed of Claude Code, Codex, OpenCode), null when none is. */
  aiAgent: TerminalProfile | null
  consoleProfiles: TerminalProfiles | null
  canInsertIntoConsole: boolean
  paneCount: number
  otherPath: string | null
  foldersShown: boolean
  places: Place[]
  remotes: RemoteMount[]
  /** Tiles per line in the list and icon views (1 in details), as the file list last laid them out. */
  columns(): number

  // navigation
  navigate(target: string, mode?: 'push' | 'back' | 'forward', selectPath?: string): void
  goBack(): void
  goForward(): void
  goUp(): void
  openEntry(entry: FileEntry): void
  openFavorite(fav: Favorite): void
  openInNewTab(path: string): void
  reload(): void

  // selection
  select(paths: string[], focus?: string | null): void
  selectAll(): void
  moveFocus(to: number, extend: boolean): void
  toggleExpand(dir: string, open?: boolean): void

  // files
  newFolder(): void
  newFile(): void
  startRename(): void
  renameOne(path: string): void
  openBatch(entries: FileEntry[]): void
  trashSelected(): void
  copySelection(cut: boolean): void
  paste(forceMove?: boolean): void
  pasteInto(dest: string): void
  duplicate(): void
  toOtherPane(mode: TransferMode): void
  openArchive(entries: FileEntry[] | null): void
  copyPath(): void
  revealSelected(): void
  reveal(path: string): void
  openExternal(path: string): void
  openWindow(path: string): void

  // views and tools
  setQuickLook(on: boolean): void
  slideshowOf(entry: FileEntry | null): { images: FileEntry[]; start: number } | null
  playSlideshow(show: { images: FileEntry[]; start: number }): void
  startTail(entry: FileEntry): void
  takeScreenshot(mode: ScreenshotMode): void
  togglePreview(): void
  toggleHidden(): void
  toggleRecursive(): void
  toggleFuzzy(): void
  setView(mode: ViewMode): void
  changeGroupBy(by: GroupBy): void
  toggleFolders(): void
  focusFilter(select: boolean): void
  setFilter(filter: string): void
  isFavorite(path: string): boolean
  toggleFavorite(fav: Favorite): void
  favoriteItem(fav: Favorite): MenuItem
  addTodo(link: { path: string; isDir: boolean }): void
  editNote(entry: FileEntry, x: number, y: number): void
  setAssistantMode(mode: AssistantMode): void

  // console and AI
  openTerminal(dir?: string): void
  openSystemTerminal(dir: string): void
  openConsole(profile: TerminalProfile, cwd: string): void
  runInConsole(path: string, target: RunTarget): void
  insertIntoConsole(paths: string[]): void
  aiCanUse(items: { path: string; isDir: boolean }[]): boolean
  askAi(items: { path: string; name: string; isDir: boolean }[]): void
  summarizeAi(items: { path: string; isDir: boolean }[]): void
  aiRename(entries: FileEntry[]): void
}
