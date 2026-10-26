import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AssistantMode } from '@shared/fileAssistant'
import { getLanguage, t, tos } from '@shared/i18n'
import { isBrowsableArchive } from '@shared/archive'
import { previewKind } from '@shared/preview'
import { baseName, dirOf, isInside, parentOf, samePath } from '@shared/paths'
import type { RemoteMount } from '@shared/remote'
import { AGENT_KINDS, AGENT_NAMES, type AgentKind } from '@shared/agentSessions'
import {
  GROUP_BY,
  MAX_FAVORITES,
  VIEW_MODES,
  type ArchiveRequest,
  type Favorite,
  type FileEntry,
  type GroupBy,
  type Listing,
  type ScreenshotMode,
  type ScreenshotResult,
  type TerminalProfile,
  type ViewMode
} from '@shared/types'
import { dragging } from '@renderer/lib/dnd'
import { formatCount, formatSize } from '@renderer/lib/format'
import { buildRows } from '@renderer/lib/fileRows'
import { groupByLabel } from '@renderer/lib/grouping'
import { keys } from '@renderer/lib/keys'
import { folderLabel } from '@renderer/lib/places'
import { remoteMountOf } from '@renderer/lib/remotes'
import { playSound } from '@renderer/lib/sound'
import { useThemeInfo } from '@renderer/lib/useThemeInfo'
import { AddressBar } from './AddressBar'
import { AskAiDialog } from './AskAiDialog'
import { BatchRenameDialog, type AiSuggestions } from './BatchRenameDialog'
import type { MenuItem } from './ContextMenu'
import { CreateArchiveDialog } from './CreateArchiveDialog'
import { FileAssistantDialog } from './FileAssistantDialog'
import { FileList, type Sort } from './FileList'
import { MemoPopover, memoOf, useFileMemos } from './FileMemo'
import { FolderTree } from './FolderTree'
import { Preview } from './Preview'
import { QuickLook } from './QuickLook'
import { ScreenshotDialog } from './ScreenshotDialog'
import { Slideshow } from './Slideshow'
import { StatusBar } from './StatusBar'
import { TailView } from './TailView'
import { TaskPane } from './TaskPane'
import { Toolbar } from './Toolbar'
import type { TabContext } from './tab/actions'
import { buildContextMenu } from './tab/contextMenu'
import { SCREENSHOT_MODES, tabPaletteCommands, VIEW_COMMAND } from './tab/paletteCommands'
import { useDirectoryNavigation } from './tab/useDirectoryNavigation'
import { PARENT_FOCUS, useFileSelection } from './tab/useFileSelection'
import { useFolderSizes } from './tab/useFolderSizes'
import { useGitStatus } from './tab/useGitStatus'
import { useRecursiveSearch } from './tab/useRecursiveSearch'
import { useTabKeyboard } from './tab/useTabKeyboard'
import { useTransferFlow } from './tab/useTransferFlow'
import type { PaletteCommand } from '@renderer/lib/palette'
import type { Place, RunTarget, Settings, TerminalProfiles } from '@shared/types'
import type { MenuState } from './ContextMenu'
import type { RemoteConnection, RemoteType } from '@shared/remote'

// One tab: a folder with its own history, filter, sort, grouping, view and selection. The focused tab also
// renders the window's shared chrome (toolbar, address bar, side areas, status bar) into the slots it gets.
// Navigation, selection, transfers, search, folder sizes and git live in hooks under ./tab; the context
// menu, the palette commands and the keyboard are built there from one TabContext.

const api = window.api

/** Places in the window where the focused tab renders the shared chrome. */
export interface Slots {
  toolbar: HTMLElement
  address: HTMLElement
  status: HTMLElement
  /** Areas of the workspace; null while the workspace does not show them. */
  folders: HTMLElement | null
  tasks: HTMLElement | null
  preview: HTMLElement | null
}

/** What a tab tells the window about itself (tab title, layout persistence, F5/F6 target). */
export interface TabReport {
  path: string
  title: string
  groupBy: GroupBy
  preview: boolean
  view: ViewMode
}

interface Props {
  id: string
  initialPath: string
  initialGroupBy: GroupBy
  initialPreview: boolean
  initialView: ViewMode
  /** Shown in its pane. */
  visible: boolean
  /** Active tab of the active pane: owns the toolbar, address bar, side pane, status bar and keyboard. */
  focused: boolean
  settings: Settings
  updateSettings(patch: Partial<Settings>): void
  places: Place[]
  /** Top-level folders for the folder tree ("/" or the drives). */
  roots: string[]
  slots: Slots | null
  paneCount: number
  /** Folder shown in the neighbouring pane – target of F5 / F6. */
  otherPath: string | null
  onReport(id: string, report: TabReport): void
  showMenu(menu: MenuState): void
  showError(err: unknown): void
  onAutomations(): void
  onSettings(): void
  onHelp(e: React.MouseEvent): void
  onPanesMenu(e: React.MouseEvent): void
  onOpenInNewTab(path: string): void
  /** Shows the Todo area with a new to-do about `path`. */
  onAddTodo(link: { path: string; isDir: boolean }): void
  /** Installed console profiles (null until known). */
  consoleProfiles: TerminalProfiles | null
  consoleOpen: boolean
  /** The workspace shows the folder tree (the toolbar's Folders button). */
  foldersShown: boolean
  onToggleFolders(): void
  /** `prompt` starts an agent with that first message. */
  onOpenConsole(profile: TerminalProfile, cwd: string, prompt?: string): void
  /** Runs a project command for `path` (a folder, or the Python file itself). */
  onRunInConsole(path: string, target: RunTarget): void
  /** The focused tab puts the builder of its palette commands here (⌘K). */
  paletteRef: React.MutableRefObject<(() => PaletteCommand[]) | null>
  onConsoleMenu(e: React.MouseEvent): void
  /** A console session is running that paths can be typed into. */
  canInsertIntoConsole: boolean
  onInsertIntoConsole(paths: string[]): void
  remotes: RemoteMount[]
  /** Opens the connection dialog (null = a new connection; `type`: a new one of this type). */
  onEditRemote(connection: RemoteConnection | null, type?: RemoteType): void
}

export function TabView(props: Props): React.JSX.Element | null {
  const { id, settings, updateSettings, showError, visible, focused } = props

  // ---- state ----------------------------------------------------------------------------------

  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'name', asc: true })
  const memos = useFileMemos(showError)
  /** The file whose to-dos and note are open in the popover. */
  const [memoAt, setMemoAt] = useState<{ path: string; isDir: boolean; x: number; y: number; focusNote: boolean } | null>(null)
  const closeMemo = useCallback(() => setMemoAt(null), [])
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>(props.initialGroupBy)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** Folders opened in place in the details view, and what they contain (loaded on first open). */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [subLists, setSubLists] = useState<Map<string, FileEntry[]>>(new Map())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const subListsRef = useRef(subLists)
  subListsRef.current = subLists
  /** Group opened as a virtual folder (key + label), or null. */
  const [virtual, setVirtual] = useState<{ key: string; label: string } | null>(null)
  const [searchNonce, setSearchNonce] = useState(0)
  const [quickLook, setQuickLook] = useState(false)
  /** The image editor in Quick Look; 'crop' starts with the crop tool. */
  const [imageEdit, setImageEdit] = useState<false | 'draw' | 'crop'>(false)
  const [shot, setShot] = useState<ScreenshotResult | null>(null)
  const [slideshow, setSlideshow] = useState<{ images: FileEntry[]; start: number } | null>(null)
  useEffect(() => {
    if (!quickLook) setImageEdit(false)
  }, [quickLook])
  /** Items in the batch rename dialog, or null. */
  const [batch, setBatch] = useState<FileEntry[] | null>(null)
  /** Items in the create archive dialog with the suggested name and folder, or null. */
  const [archive, setArchive] = useState<{ sources: string[]; name: string; dest: string } | null>(null)
  /** AI rename suggestions for the batch dialog (null = the dialog was opened without AI). */
  const [aiNames, setAiNames] = useState<AiSuggestions | null>(null)
  const aiRequest = useRef(0)
  /** Items of the "Ask AI…" dialog. */
  const [askAi, setAskAi] = useState<{ path: string; name: string; isDir: boolean }[] | null>(null)
  /** This tab shows the preview pane (each tab decides on its own). */
  const [preview, setPreview] = useState(props.initialPreview)
  const [view, setView] = useState<ViewMode>(props.initialView)
  /** Tiles per line in the list and icon views, as laid out by the file list (1 in details). */
  const columnsRef = useRef(1)
  const togglePreview = (): void => setPreview((on) => !on)
  /** File or device shown live in the preview pane instead of the selection's preview. */
  const [tail, setTail] = useState<{ path: string; name: string } | null>(null)
  /** Preview pane width while its divider is being dragged (saved on release). */
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [assistantMode, setAssistantMode] = useState<AssistantMode | null>(null)

  // ---- the folder -----------------------------------------------------------------------------

  const nav = useDirectoryNavigation({
    initialPath: props.initialPath,
    onError: showError,
    // Entering a folder starts it fresh: nothing of the old one's filter, groups or opened folders stays.
    onEnter: (_next: Listing, selectPath: string | undefined) => {
      resetSizes()
      setFilter('')
      setRenamingPath(null)
      setVirtual(null)
      setCollapsed(new Set())
      setExpanded(new Set())
      setSubLists(new Map())
      selection.select(selectPath ? [selectPath] : [])
    }
  })
  const { listing, history, navigate } = nav
  const path = listing?.path ?? null
  const searchMode = settings.recursive && filter.trim() !== ''
  /** Folders open in place only in the plain details view (not in search results, groups or tiles). */
  const treeOn = settings.expandFolders && !searchMode && groupBy === 'none' && !virtual && view === 'details'

  const openedEntries = useMemo(() => [...expanded].flatMap((d) => subLists.get(d) ?? []), [expanded, subLists])
  const [sizes, resetSizes] = useFolderSizes({ id, listing, visible, showHidden: settings.showHidden, opened: openedEntries, showError })
  const search = useRecursiveSearch({
    id,
    root: searchMode ? path : null,
    query: filter,
    fuzzy: settings.fuzzy,
    showHidden: settings.showHidden,
    nonce: searchNonce,
    showError
  })

  // ---- folders opened in place ------------------------------------------------------------------

  const loadSub = useCallback(async (dir: string): Promise<boolean> => {
    try {
      const entries = (await api.list(dir)).entries
      setSubLists((m) => new Map(m).set(dir, entries))
      return true
    } catch {
      return false
    }
  }, [])

  /** Re-reads every opened folder; one that is gone closes. */
  const refreshOpened = useCallback(async (): Promise<void> => {
    const gone: string[] = []
    await Promise.all([...expandedRef.current].map(async (dir) => (await loadSub(dir)) || gone.push(dir)))
    if (gone.length) setExpanded((s) => new Set([...s].filter((d) => !gone.includes(d))))
  }, [loadSub])

  const toggleExpand = useCallback(
    (dir: string, open?: boolean): void => {
      const isOpen = expandedRef.current.has(dir)
      if (open === isOpen) return
      setExpanded((s) => {
        const next = new Set(s)
        if (isOpen) next.delete(dir)
        else next.add(dir)
        return next
      })
      if (!isOpen)
        void loadSub(dir).then((ok) => {
          if (!ok) setExpanded((s) => new Set([...s].filter((d) => d !== dir)))
        })
    },
    [loadSub]
  )

  // ---- rows (filter + sort + groups) and selection ---------------------------------------------

  const visibleEntries = useMemo(() => (listing?.entries ?? []).filter((e) => settings.showHidden || !e.hidden), [listing, settings.showHidden])
  const { rows, groups } = useMemo(
    () =>
      buildRows({
        entries: searchMode ? (search?.entries ?? []) : visibleEntries,
        filter,
        fuzzy: settings.fuzzy,
        showHidden: settings.showHidden,
        sort,
        sizes,
        groupBy,
        virtual,
        collapsed,
        path,
        searchMode,
        tree: treeOn,
        expanded,
        subLists,
        now: Date.now()
      }),
    // The language changes group labels, date buckets and the collation.
    [searchMode, search, visibleEntries, filter, settings.fuzzy, settings.showHidden, sort, sizes, groupBy, virtual, collapsed, path, treeOn, expanded, subLists, getLanguage()]
  )
  const hasParentRow = !searchMode && !!(listing?.parent || virtual)
  const selection = useFileSelection(rows, hasParentRow)
  const { select, focusIndex, selectedEntries, keepExisting } = selection
  const { refresh } = nav
  /** The file the preview shows: the focused row, as long as something is selected. */
  const previewEntry = focusIndex >= 0 && selection.selection.size > 0 ? rows[focusIndex].entry : null

  /** Re-reads the folder (and re-runs a recursive search), keeping the selection where possible. */
  const reload = useCallback(
    async (selectPaths?: string[]): Promise<void> => {
      if (!path) return
      setSearchNonce((n) => n + 1)
      const next = await refresh()
      if (!next) return
      void refreshOpened()
      if (selectPaths) return select(selectPaths)
      if (searchMode) return
      // Items inside opened folders stay selectable across a reload too.
      const opened = [...expandedRef.current].flatMap((d) => subListsRef.current.get(d) ?? [])
      keepExisting(new Set([...next.entries, ...opened].map((e) => e.path)))
    },
    [path, refresh, select, searchMode, refreshOpened, keepExisting]
  )
  const flow = useTransferFlow({ reload, currentPath: path, showError })

  // ---- subscriptions ----------------------------------------------------------------------------

  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => api.onDirChanged((dir) => visible && !searchMode && dir === path && void reloadRef.current()), [path, visible, searchMode])

  // A hidden tab may be out of date when it is shown again.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current) void reloadRef.current()
    wasVisible.current = visible
  }, [visible])

  useEffect(() => {
    if (listing && visible && focused && settings.activityEnabled) void api.activity.visit(listing.path).catch(() => {})
  }, [listing?.path, visible, focused, settings.activityEnabled])

  // AI agents ask over MCP what the user is looking at.
  useEffect(() => {
    if (listing && visible && focused && settings.mcpEnabled) api.mcp.reportView({ folder: listing.path, selection: [...selection.selection] })
  }, [listing?.path, visible, focused, selection.selection, settings.mcpEnabled])

  // ---- actions ------------------------------------------------------------------------------------

  const goUp = (): void => {
    if (virtual) return setVirtual(null)
    if (listing?.parent) void navigate(listing.parent, 'push', listing.path)
  }

  const openEntry = (entry: FileEntry): void => {
    // Archives open as read-only folders; "Open with System App" in the menu extracts them instead.
    // Archives on remote storage are opened as files (browsing them would download them whole).
    if (entry.isDir || (isBrowsableArchive(entry.name) && !remoteMountOf(entry.path))) void navigate(entry.path)
    else {
      playSound('open')
      api.open(entry.path).catch(showError)
    }
  }

  /** The pane shows the focused row, so Quick Look opens on the same image, straight in the editor. */
  const editImage = (crop = false): void => {
    setImageEdit(crop ? 'crop' : 'draw')
    setQuickLook(true)
  }

  /** Screenshot into this folder (or Pictures), then select it and offer editing. */
  const takeScreenshot = async (mode: ScreenshotMode): Promise<void> => {
    try {
      const taken = await api.screenshot(path && !listing?.readOnly ? path : null, mode)
      if (!taken) return
      playSound('create')
      if (path && samePath(dirOf(taken.path), path)) await reload([taken.path])
      else await navigate(dirOf(taken.path), 'push', taken.path)
      setShot(taken)
    } catch (err) {
      showError(err)
    }
  }

  const screenshotItems = (): MenuItem[] =>
    SCREENSHOT_MODES.map((mode) => ({ label: t(`screenshot.mode.${mode}`), shortcut: mode === 'region' ? keys.label('screenshot') : undefined, onClick: () => void takeScreenshot(mode) }))

  /**
   * Images for a slideshow from `entry`: the selected images when there are several, otherwise every image
   * in the folder starting at this one. Null when there is nothing to show.
   */
  const slideshowOf = (entry: FileEntry | null): { images: FileEntry[]; start: number } | null => {
    const isImage = (e: FileEntry): boolean => !e.isDir && previewKind(e.name) === 'image'
    const picked = selectedEntries.filter(isImage)
    const all = rows.map((r) => r.entry).filter(isImage)
    const images = picked.length > 1 ? picked : all
    if (images.length < 2) return null
    const start = entry ? images.findIndex((e) => e.path === entry.path) : -1
    return { images, start: Math.max(0, start) }
  }

  const openRecent = (file: string): void => void navigate(dirOf(file), 'push', file)

  const showRecentMenu = (file: string, e: React.MouseEvent): void => {
    e.preventDefault()
    props.showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('action.open'), icon: 'open', onClick: () => api.open(file).catch(showError) },
        { label: t('recent.showInFolder'), onClick: () => openRecent(file) },
        'separator',
        { label: t('recent.forget'), onClick: () => void api.recents.forget(file) },
        { label: t('recent.clear'), onClick: () => void api.recents.clear() }
      ]
    })
  }

  const isFavorite = (p: string): boolean => settings.favorites.some((f) => samePath(f.path, p))

  /** Pins a file or folder to the Favorites section, or unpins it. */
  const toggleFavorite = (fav: Favorite): void => {
    const rest = settings.favorites.filter((f) => !samePath(f.path, fav.path))
    if (rest.length < settings.favorites.length) return updateSettings({ favorites: rest })
    updateSettings({ favorites: [...settings.favorites, fav].slice(-MAX_FAVORITES) })
  }

  /** A favorite folder opens in this tab; a favorite file is selected in its folder. */
  const openFavorite = (fav: Favorite): void => {
    if (fav.isDir) void navigate(fav.path)
    else void navigate(dirOf(fav.path), 'push', fav.path)
  }

  const favoriteItem = (fav: Favorite): MenuItem => ({
    label: t(isFavorite(fav.path) ? 'action.removeFavorite' : 'action.addFavorite'),
    icon: 'star',
    shortcut: keys.label('favorite'),
    onClick: () => toggleFavorite(fav)
  })

  const moveFavorite = (fav: Favorite, delta: number): void => {
    const list = [...settings.favorites]
    const i = list.findIndex((f) => samePath(f.path, fav.path))
    const j = i + delta
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    updateSettings({ favorites: list })
  }

  const showFavoriteMenu = (fav: Favorite, e: React.MouseEvent): void => {
    e.preventDefault()
    props.showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('action.open'), icon: 'open', bold: true, onClick: () => openFavorite(fav) },
        ...(fav.isDir
          ? [
              { label: t('action.openInNewTab'), onClick: () => props.onOpenInNewTab(fav.path) },
              { label: t('action.openInNewWindow'), onClick: () => api.window.open(fav.path) }
            ]
          : [{ label: t('action.openExternal'), onClick: () => api.open(fav.path).catch(showError) }]),
        { label: tos('action.reveal'), icon: 'reveal', onClick: () => api.reveal(fav.path).catch(showError) },
        'separator',
        { label: t('action.moveFavoriteUp'), disabled: samePath(settings.favorites[0]?.path ?? '', fav.path), onClick: () => moveFavorite(fav, -1) },
        { label: t('action.moveFavoriteDown'), disabled: samePath(settings.favorites.at(-1)?.path ?? '', fav.path), onClick: () => moveFavorite(fav, 1) },
        'separator',
        { label: t('action.removeFavorite'), icon: 'star', onClick: () => toggleFavorite(fav) }
      ]
    })
  }

  const showRemoteMenu = (mount: RemoteMount, e: React.MouseEvent): void => {
    e.preventDefault()
    const remoteId = mount.connection.id
    props.showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('action.open'), icon: 'open', bold: true, onClick: () => void navigate(mount.path) },
        { label: t('action.openInNewTab'), onClick: () => props.onOpenInNewTab(mount.path) },
        { label: t('action.openInNewWindow'), onClick: () => api.window.open(mount.path) },
        ...(mount.connection.type === 'afinder' ? [{ label: t('remoteDesktop.open'), icon: 'remote' as const, onClick: () => void api.remote.openDesktop(remoteId).catch(showError) }] : []),
        'separator',
        { label: t('remote.edit'), onClick: () => props.onEditRemote(mount.connection) },
        { label: t('remote.disconnect'), disabled: !mount.connected, onClick: () => void api.remote.disconnect(remoteId).catch(showError) },
        { label: t('action.copyPath'), onClick: () => void api.copyText(mount.url).catch(showError) },
        'separator',
        { label: t('remote.remove'), icon: 'trash', onClick: () => void api.remote.remove(remoteId).catch(showError) }
      ]
    })
  }

  /** A new folder or file, selected with its name ready to edit. */
  const createItem = async (make: (parent: string) => Promise<string>): Promise<void> => {
    if (!path) return
    try {
      const created = await make(path)
      playSound('create')
      setFilter('')
      setVirtual(null)
      await reload([created])
      setRenamingPath(created)
    } catch (err) {
      showError(err)
    }
  }
  const newFolder = (): void => void createItem(api.mkdir)
  const newFile = (): void => void createItem(api.mkfile)

  /** The Terminal button, ⇧⌘T and "Open in Terminal" all start a shell in the integrated console. */
  const openTerminal = (dir = path): void => {
    if (dir) props.onOpenConsole('shell', dir)
  }

  const openSystemTerminal = (dir: string): void => {
    api.openTerminal(dir).catch(showError)
  }

  /** Dragging the divider left widens the pane; the list keeps at least 240 px. */
  const startPreviewResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = settings.previewWidth
    const width = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().width
    const widthAt = (x: number): number => Math.round(Math.max(160, Math.min(width - 240, startWidth - (x - startX))))
    const move = (ev: MouseEvent): void => setDragWidth(widthAt(ev.clientX))
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing-col')
      setDragWidth(null)
      updateSettings({ previewWidth: widthAt(ev.clientX) })
    }
    document.body.classList.add('resizing-col')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const openBatch = (entries: FileEntry[]): void => {
    aiRequest.current++
    setAiNames(null)
    setBatch(entries)
  }

  const startRename = (): void => {
    if (selectedEntries.length > 1) return openBatch(selectedEntries)
    const target = selection.focusPath && selection.selection.has(selection.focusPath) ? selection.focusPath : selectedEntries[0]?.path
    if (target) setRenamingPath(target)
  }

  const finishRename = async (entry: FileEntry, newName: string | null): Promise<void> => {
    setRenamingPath(null)
    if (newName === null || newName.trim() === '' || newName.trim() === entry.name) return
    try {
      const renamed = await api.rename(entry.path, newName)
      playSound('rename')
      await reload([renamed])
    } catch (err) {
      showError(err)
    }
  }

  const closeBatch = (): void => {
    aiRequest.current++
    setBatch(null)
    setAiNames(null)
  }

  const renameBatch = async (items: { path: string; name: string }[]): Promise<void> => {
    closeBatch()
    try {
      const renamed = await api.renameMany(items)
      playSound('rename')
      await reload(renamed)
    } catch (err) {
      showError(err)
      void reload()
    }
  }

  const trashSelected = async (): Promise<void> => {
    if (selectedEntries.length === 0) return
    const nextFocus = rows.slice(focusIndex + 1).find((r) => !selection.selection.has(r.entry.path))?.entry.path
    try {
      await api.trash(selectedEntries.map((e) => e.path))
      playSound('trash')
      await reload(nextFocus ? [nextFocus] : [])
    } catch (err) {
      showError(err)
      void reload()
    }
  }

  const copyPath = (): void => {
    const text = selectedEntries.length ? selectedEntries.map((e) => e.path).join('\n') : path
    if (text) api.copyText(text).catch(showError)
  }

  const revealSelected = (): void => {
    const target = selectedEntries[0]?.path ?? path
    if (target) api.reveal(target).catch(showError)
  }

  // ---- archives -------------------------------------------------------------------------------

  /** Archives are packed from local items only. */
  const canArchive = !!path && !listing?.readOnly && !remoteMountOf(path)

  /** The items go into an archive in this folder; the folder itself (null) into one next to it. */
  const openArchive = (entries: FileEntry[] | null): void => {
    if (!path || !canArchive) return
    if (entries === null) return setArchive({ sources: [path], name: baseName(path) || t('archive.defaultName'), dest: parentOf(path) ?? path })
    if (entries.length) setArchive({ sources: entries.map((e) => e.path), name: entries.length === 1 ? entries[0].name : t('archive.defaultName'), dest: path })
  }

  const createArchive = (request: ArchiveRequest): void => {
    setArchive(null)
    void flow.createArchive(request, (created) => reload(created && path && samePath(dirOf(created), path) ? [created] : undefined))
  }

  // ---- drag and drop -----------------------------------------------------------------------------

  /** F5 / F6: copy or move the selection into the folder of the neighbouring pane. */
  const toOtherPane = (mode: 'copy' | 'move'): void => {
    if (props.otherPath && props.paneCount > 1) void flow.transfer(selectedEntries.map((e) => e.path), props.otherPath, mode)
  }

  const startDrag = (entry: FileEntry): void => {
    const paths = selection.selection.has(entry.path) ? selectedEntries.map((e) => e.path) : [entry.path]
    if (!selection.selection.has(entry.path)) select([entry.path])
    dragging.paths = paths
    api.startDrag(paths)
  }

  const canDropOn = (dest: string): boolean =>
    !dragging.paths.some((p) => isInside(dest, p)) &&
    // Dropping our own files back into the folder they came from would be a no-op.
    !(dragging.paths.length > 0 && dragging.paths.every((p) => samePath(dirOf(p), dest)))

  const dropFiles = (dropped: File[], dest: string, copy: boolean): void => {
    const paths = dropped.map((f) => api.pathForFile(f)).filter(Boolean)
    dragging.paths = []
    if (paths.length) void flow.transfer(paths, dest, copy ? 'copy' : 'auto')
  }

  // ---- AI on files --------------------------------------------------------------------------------

  /** The agent for conversations about files: the first installed of Claude Code, Codex and OpenCode. */
  const aiAgent: AgentKind | null = AGENT_KINDS.find((a) => props.consoleProfiles?.[a]) ?? null
  const aiAgentName = AGENT_NAMES[aiAgent ?? 'claude']

  /**
   * Starts the agent in the console with a first message about the items. Archive members and remote
   * files are handed over as local copies, the agent's folder is theirs.
   */
  const runAgent = async (items: { path: string; isDir: boolean }[], prompt: (files: string) => string): Promise<void> => {
    if (!aiAgent || items.length === 0) return
    try {
      const local = await api.localCopies(items.map((i) => i.path))
      const cwd = items.length === 1 && items[0].isDir ? local[0] : dirOf(local[0])
      props.onOpenConsole(aiAgent, cwd, prompt(local.join(', ')))
    } catch (err) {
      showError(err)
    }
  }

  const summarizeAi = (items: { path: string; isDir: boolean }[]): void =>
    void runAgent(items, (files) => t(items.length === 1 && items[0].isDir ? 'ai.prompt.describeFolder' : 'ai.prompt.summarize', { files }))

  const askAiAbout = (question: string): void => {
    const items = askAi
    setAskAi(null)
    if (items) void runAgent(items, (files) => t('ai.prompt.ask', { question, files }))
  }

  /** Opens the batch rename dialog and fills it with names suggested by Claude Code. */
  const aiRename = (entries: FileEntry[], hint = ''): void => {
    const request = ++aiRequest.current
    setBatch(entries)
    setAiNames({ state: 'loading' })
    api.ai.suggestNames(entries.map((e) => ({ name: e.name, isDir: e.isDir })), hint, getLanguage()).then(
      (names) => request === aiRequest.current && setAiNames({ state: 'done', names }),
      (err) => request === aiRequest.current && setAiNames({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    )
  }

  /** Remote folders would have to be downloaded whole for the agent – only their files qualify. */
  const aiCanUse = (items: { path: string; isDir: boolean }[]): boolean => items.every((i) => !(i.isDir && remoteMountOf(i.path)))

  // ---- view -----------------------------------------------------------------------------------

  const changeGroupBy = (by: GroupBy): void => {
    setGroupBy(by)
    setCollapsed(new Set())
    setVirtual(null)
  }

  const menuBelow = (e: React.MouseEvent, items: MenuItem[]): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    props.showMenu({ x: r.left, y: r.bottom + 2, items })
  }

  const showGroupMenu = (e: React.MouseEvent): void =>
    menuBelow(
      e,
      GROUP_BY.flatMap((by): MenuItem[] => [...(by === 'year' || by === 'kind' ? (['separator'] as const) : []), { label: groupByLabel(by), checked: groupBy === by, onClick: () => changeGroupBy(by) }])
    )

  const showViewMenu = (e: React.MouseEvent): void =>
    menuBelow(e, [
      ...VIEW_MODES.map((mode): MenuItem => ({ label: t(`view.${mode}`), shortcut: keys.label(VIEW_COMMAND[mode]), checked: view === mode, onClick: () => setView(mode) })),
      'separator',
      { label: t('settings.expandFolders'), checked: settings.expandFolders, onClick: () => updateSettings({ expandFolders: !settings.expandFolders }) }
    ])

  const toggleGroup = (key: string): void =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const openGroup = (key: string): void => {
    const g = groups?.find((x) => x.key === key)
    if (!g) return
    setVirtual({ key, label: g.label })
    select([])
  }

  const onRowMouseDown = (index: number, e: React.MouseEvent): void => {
    const entry = rows[index].entry
    if (document.activeElement instanceof HTMLElement && !document.activeElement.classList.contains('rename-input')) document.activeElement.blur()
    if (e.button === 1) {
      e.preventDefault()
      if (entry.isDir) props.onOpenInNewTab(entry.path)
      return
    }
    if (e.button === 2) {
      if (!selection.selection.has(entry.path)) select([entry.path])
      return
    }
    if (keys.mod(e)) selection.toggle(entry.path)
    else if (e.shiftKey && selection.anchorPath) selection.selectRange(selection.anchorPath, index)
    else select([entry.path])
  }

  // ---- what the tab can do (context menu, palette, keyboard) -------------------------------------

  const ctx: TabContext = {
    path,
    listing,
    rows,
    selection: selection.selection,
    selectedEntries,
    focusIndex,
    parentFocused: selection.parentFocused,
    hasParentRow,
    searchMode,
    treeOn,
    expanded,
    filter,
    settings,
    view,
    groupBy,
    preview,
    virtual,
    history,
    canArchive,
    aiAgent,
    consoleProfiles: props.consoleProfiles,
    canInsertIntoConsole: props.canInsertIntoConsole,
    paneCount: props.paneCount,
    otherPath: props.otherPath,
    foldersShown: props.foldersShown,
    places: props.places,
    remotes: props.remotes,
    columns: () => columnsRef.current,
    navigate: (target, mode, selectPath) => void navigate(target, mode, selectPath),
    goBack: nav.goBack,
    goForward: nav.goForward,
    goUp,
    openEntry,
    openFavorite,
    openInNewTab: props.onOpenInNewTab,
    reload: () => void reload(),
    select,
    selectAll: selection.selectAll,
    moveFocus: selection.moveFocus,
    toggleExpand,
    newFolder,
    newFile,
    startRename,
    renameOne: setRenamingPath,
    openBatch,
    trashSelected: () => void trashSelected(),
    copySelection: (cut) => void flow.copyToClipboard(selectedEntries, cut),
    paste: (forceMove) => path && void flow.paste(path, forceMove),
    pasteInto: (dest) => void flow.paste(dest),
    duplicate: () => path && void flow.transfer(selectedEntries.map((e) => e.path), path, 'copy'),
    toOtherPane,
    openArchive,
    copyPath,
    revealSelected,
    reveal: (p) => api.reveal(p).catch(showError),
    openExternal: (p) => api.open(p).catch(showError),
    openWindow: (p) => api.window.open(p),
    setQuickLook,
    slideshowOf,
    playSlideshow: setSlideshow,
    startTail: (entry) => {
      setTail({ path: entry.path, name: entry.name })
      setPreview(true)
    },
    takeScreenshot: (mode) => void takeScreenshot(mode),
    togglePreview,
    toggleHidden: () => updateSettings({ showHidden: !settings.showHidden }),
    toggleRecursive: () => updateSettings({ recursive: !settings.recursive }),
    toggleFuzzy: () => updateSettings({ fuzzy: !settings.fuzzy }),
    setView,
    changeGroupBy,
    toggleFolders: props.onToggleFolders,
    focusFilter: (all) => (all ? filterRef.current?.select() : filterRef.current?.focus()),
    setFilter,
    isFavorite,
    toggleFavorite,
    favoriteItem,
    addTodo: props.onAddTodo,
    editNote: (entry, x, y) => setMemoAt({ path: entry.path, isDir: entry.isDir, x, y, focusNote: true }),
    setAssistantMode,
    openTerminal,
    openSystemTerminal,
    openConsole: (profile, cwd) => props.onOpenConsole(profile, cwd),
    runInConsole: props.onRunInConsole,
    insertIntoConsole: props.onInsertIntoConsole,
    aiCanUse,
    askAi: setAskAi,
    summarizeAi,
    aiRename
  }

  const showContextMenu = async (entry: FileEntry | null, e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const { clientX, clientY } = e
    if (!entry) select([])
    const runPath = entry ? entry.path : path
    const [clip, runTargets] = await Promise.all([
      api.readFileClipboard().catch(() => ({ paths: [], cut: false })),
      runPath && !remoteMountOf(runPath) ? api.terminal.targets(runPath).catch(() => []) : Promise.resolve([])
    ])
    props.showMenu({ x: clientX, y: clientY, items: buildContextMenu(ctx, entry, { clip, runTargets, x: clientX, y: clientY }) })
  }

  useTabKeyboard({ focused, blocked: renamingPath !== null || flow.busy, filterInput: filterRef.current, ctx })
  if (focused) props.paletteRef.current = () => tabPaletteCommands(ctx)

  // ---- status bar -------------------------------------------------------------------------------

  const status = useMemo(() => {
    const sumSizes = (entries: FileEntry[]): { bytes: number; pending: boolean } => {
      let bytes = 0
      let pending = false
      for (const e of entries) {
        if (e.size !== null) bytes += e.size
        else if (!e.isSymlink && !searchMode) {
          const s = sizes.get(e.path)
          if (s) bytes += s.size
          if (!s || s.state === 'partial') pending = true
        }
      }
      return { bytes, pending }
    }
    const shown = groups ? groups.reduce((n, g) => n + g.count, 0) : rows.length
    const total = sumSizes(rows.map((r) => r.entry))
    const sel = sumSizes(selectedEntries)
    const count = searchMode
      ? `${t('status.found', { count: formatCount(shown) })}${search?.running ? t('status.searching') : ''}${search?.truncated ? t('status.truncated') : ''}`
      : filter || virtual
        ? t('status.shown', { shown, total: visibleEntries.length })
        : formatCount(shown)
    return {
      left: selectedEntries.length ? t('status.selected', { count, n: selectedEntries.length }) : count,
      middle: `${total.pending ? '≥ ' : ''}${formatSize(total.bytes)}${total.pending ? t('status.computing') : ''}`,
      right: selectedEntries.length ? t('status.selection', { size: `${sel.pending ? '≥ ' : ''}${formatSize(sel.bytes)}` }) : tos('status.thisComputer')
    }
  }, [rows, groups, selectedEntries, sizes, filter, virtual, visibleEntries.length, searchMode, search, getLanguage()])

  const { git, states: gitStates } = useGitStatus(path, listing, visible, rows)
  const themeField = useThemeInfo(settings.theme, settings.themeInfo && visible, path ?? api.homeDir, visibleEntries)
  const branch = git?.branch ? `⎇ ${git.branch}${git.ahead ? ` ↑${git.ahead}` : ''}${git.behind ? ` ↓${git.behind}` : ''}` : null

  // ---- report to the window -------------------------------------------------------------------

  const folderName = path ? folderLabel(path) : t('app.name')
  const title = virtual ? `${folderName} ⟩ ${virtual.label}` : folderName
  const { onReport } = props
  useEffect(() => {
    if (path) onReport(id, { path, title, groupBy, preview, view })
  }, [id, path, title, groupBy, preview, view, onReport])

  // ---- render -------------------------------------------------------------------------------

  const previewPane = (readOnly: boolean): React.ReactNode =>
    tail ? (
      <TailView key={tail.path} path={tail.path} name={tail.name} onClose={() => setTail(null)} />
    ) : (
      <Preview entry={previewEntry} size={previewEntry ? sizes.get(previewEntry.path) : undefined} theme={settings.theme} mode="pane" readOnly={readOnly} onError={showError} onEditImage={() => editImage()} />
    )

  // The chrome renders while the first listing loads too: a tab that mounts focused (a new pane, a tab moved
  // to another pane, a slow remote or network folder) otherwise left the window without a toolbar.
  const shownPath = path ?? props.initialPath
  const chrome = focused && props.slots && (
    <>
      {createPortal(
        <Toolbar
          ref={filterRef}
          canBack={history.back.length > 0}
          canForward={history.forward.length > 0}
          canUp={(listing?.parent ?? null) !== null || virtual !== null}
          foldersShown={props.foldersShown}
          filter={filter}
          fuzzy={settings.fuzzy}
          recursive={settings.recursive}
          grouped={groupBy !== 'none'}
          paneCount={props.paneCount}
          consoleOpen={props.consoleOpen}
          previewPane={preview}
          onTogglePreview={togglePreview}
          onBack={nav.goBack}
          onForward={nav.goForward}
          onUp={goUp}
          onNewFolder={newFolder}
          onTerminal={() => openTerminal()}
          onToggleFolders={props.onToggleFolders}
          onFilter={setFilter}
          onToggleFuzzy={ctx.toggleFuzzy}
          onToggleRecursive={ctx.toggleRecursive}
          onGroupMenu={showGroupMenu}
          onViewMenu={showViewMenu}
          onPanesMenu={props.onPanesMenu}
          onConsoleMenu={props.onConsoleMenu}
          onAutomations={props.onAutomations}
          onSettings={props.onSettings}
          onHelp={props.onHelp}
        />,
        props.slots.toolbar
      )}
      {createPortal(<AddressBar path={shownPath} virtualFolder={virtual?.label ?? null} onNavigate={(p) => void navigate(p)} onLeaveVirtual={() => setVirtual(null)} />, props.slots.address)}
      {props.slots.folders &&
        createPortal(
          <FolderTree
            currentPath={shownPath}
            homeDir={api.homeDir}
            roots={props.roots}
            showHidden={settings.showHidden}
            onNavigate={(p) => void navigate(p)}
            dropTarget={dropTarget}
            canDropOn={canDropOn}
            onDropTarget={setDropTarget}
            onDropFiles={dropFiles}
          />,
          props.slots.folders
        )}
      {props.slots.tasks &&
        createPortal(
          <TaskPane
            currentPath={shownPath}
            selected={selectedEntries}
            places={props.places}
            favorites={settings.favorites}
            onOpenFavorite={openFavorite}
            onFavoriteMenu={showFavoriteMenu}
            remotes={props.remotes}
            onOpenRemote={(m) => void navigate(m.path)}
            onRemoteMenu={showRemoteMenu}
            onAddRemote={() => props.onEditRemote(null)}
            onAddComputer={() => props.onEditRemote(null, 'afinder')}
            sizes={sizes}
            onNavigate={(p) => void navigate(p)}
            onNewFolder={newFolder}
            onTerminal={() => openTerminal()}
            onRename={startRename}
            onTrash={ctx.trashSelected}
            onReveal={revealSelected}
            onCopyPath={copyPath}
            onCopy={() => ctx.copySelection(false)}
            onPaste={() => ctx.paste()}
            recentEnabled={settings.recentFiles}
            onOpenRecent={openRecent}
            onLaunchRecent={(file) => api.open(file).catch(showError)}
            onRecentMenu={showRecentMenu}
            onScreenshot={(e) => props.showMenu({ x: e.clientX, y: e.clientY, items: screenshotItems() })}
          />,
          props.slots.tasks
        )}
      {props.slots.preview && createPortal(<div className="preview-pane area-preview">{previewPane(listing?.readOnly === true)}</div>, props.slots.preview)}
      {createPortal(<StatusBar {...status} branch={branch} info={themeField} />, props.slots.status)}
    </>
  )

  if (!listing || !path) return <div className={`tab-view${visible ? '' : ' hidden'}`}>{chrome}</div>

  const emptyText = searchMode ? (search?.running ? t('empty.searching') : t('empty.search', { filter })) : filter ? t('empty.filter', { filter }) : virtual ? t('empty.virtual') : t('empty.folder')

  return (
    <div className={`tab-view${visible ? '' : ' hidden'}`}>
      {chrome}
      <FileList
        rows={rows}
        groups={groups}
        showLocation={searchMode}
        sizes={sizes}
        selection={selection.selection}
        focusIndex={focusIndex}
        renamingPath={renamingPath}
        sort={sort}
        columnWidths={settings.columnWidths}
        lineNumbers={settings.lineNumbers}
        view={view}
        onColumns={(n) => (columnsRef.current = n)}
        up={hasParentRow ? { path: virtual ? null : listing.parent, onOpen: goUp, focused: selection.parentFocused, onSelect: () => select([], PARENT_FOCUS) } : null}
        emptyText={emptyText}
        onRowMouseDown={onRowMouseDown}
        onOpen={openEntry}
        onContextMenu={(entry, e) => void showContextMenu(entry, e)}
        currentPath={path}
        cutPaths={flow.cutPaths}
        dropTarget={dropTarget}
        canDropOn={canDropOn}
        onDropTarget={setDropTarget}
        onDropFiles={dropFiles}
        onDragStart={startDrag}
        onRenameDone={(entry, name) => void finishRename(entry, name)}
        onSort={(key) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key !== 'size' && key !== 'modified' }))}
        onColumnResize={(key, width) => updateSettings({ columnWidths: { ...settings.columnWidths, [key]: width } })}
        onBackgroundClick={() => select([])}
        onGroupToggle={toggleGroup}
        onGroupOpen={openGroup}
        git={gitStates}
        memos={memos}
        expandable={treeOn}
        expanded={expanded}
        onToggleExpand={(entry) => toggleExpand(entry.path)}
        onMemo={(entry, r) => setMemoAt({ path: entry.path, isDir: entry.isDir, x: r.left, y: r.bottom + 2, focusNote: false })}
      />
      {memoAt && visible && (
        <MemoPopover
          key={memoAt.path}
          path={memoAt.path}
          isDir={memoAt.isDir}
          memo={memoOf(memos, memoAt.path)}
          anchor={{ x: memoAt.x, y: memoAt.y }}
          focusNote={memoAt.focusNote}
          showError={showError}
          onClose={closeMemo}
        />
      )}
      {preview && visible && (
        <>
          <div className="preview-divider" onMouseDown={startPreviewResize} />
          <aside className="preview-pane" style={{ width: dragWidth ?? settings.previewWidth }}>
            {previewPane(listing.readOnly === true)}
          </aside>
        </>
      )}
      {assistantMode &&
        focused &&
        createPortal(
          <FileAssistantDialog
            folder={path}
            paths={selectedEntries.filter((e) => !e.isDir).map((e) => e.path)}
            initialMode={assistantMode}
            onClose={() => setAssistantMode(null)}
            onSelect={(paths) => select(paths)}
            onApplied={() => void reload()}
          />,
          document.body
        )}
      {quickLook &&
        focused &&
        focusIndex >= 0 &&
        createPortal(
          <QuickLook
            entry={rows[focusIndex].entry}
            size={sizes.get(rows[focusIndex].entry.path)}
            theme={settings.theme}
            position={{ index: focusIndex, count: rows.length }}
            onStep={(delta) => selection.moveFocus(focusIndex + delta, false)}
            onOpen={() => {
              setQuickLook(false)
              openEntry(rows[focusIndex].entry)
            }}
            onClose={() => setQuickLook(false)}
            onError={showError}
            readOnly={listing.readOnly === true}
            editing={imageEdit !== false}
            editCrop={imageEdit === 'crop'}
            onEditingChange={(on) => setImageEdit(on ? 'draw' : false)}
          />,
          document.body
        )}
      {slideshow && createPortal(<Slideshow images={slideshow.images} start={slideshow.start} onClose={() => setSlideshow(null)} />, document.body)}
      {shot &&
        createPortal(
          <ScreenshotDialog
            shot={shot}
            onEdit={() => {
              const crop = shot.crop
              setShot(null)
              editImage(crop)
            }}
            onClose={() => setShot(null)}
          />,
          document.body
        )}
      {batch &&
        createPortal(
          <BatchRenameDialog
            entries={batch}
            otherNames={searchMode ? [] : listing.entries.filter((e) => !batch.some((b) => b.path === e.path)).map((e) => e.name)}
            platform={api.platform}
            onRename={(items) => void renameBatch(items)}
            onCancel={closeBatch}
            ai={aiNames ?? undefined}
            onAiRequest={(hint) => aiRename(batch, hint)}
          />,
          document.body
        )}
      {archive && createPortal(<CreateArchiveDialog {...archive} onCreate={createArchive} onCancel={() => setArchive(null)} />, document.body)}
      {askAi && createPortal(<AskAiDialog names={askAi.map((i) => i.name)} agent={aiAgentName} onAsk={askAiAbout} onCancel={() => setAskAi(null)} />, document.body)}
      {flow.dialogs}
    </div>
  )
}
