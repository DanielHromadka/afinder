import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { resolveLanguage, setLanguage, setOs, t, type LanguageSetting, type MessageKey } from '@shared/i18n'
import { AGENT_KINDS } from '@shared/agentSessions'
import { dirOf, samePath } from '@shared/paths'
import type { RemoteConnection, RemoteMount, RemoteType } from '@shared/remote'
import { MAX_PANES, type Place, type TerminalProfile, type WindowHandover } from '@shared/types'
import { EDITORS, type Editor } from '@shared/workspace'
import {
  activateTab,
  addTab as addTabTo,
  closeOtherTabs as closeOtherTabsIn,
  closeTab as closeTabIn,
  fitPanes,
  focusPane as focusPaneIn,
  fromLayout,
  layoutOf,
  moveTab as moveTabIn,
  newTab,
  resizePanes,
  selectTab as selectTabIn,
  setPaneCount as setPaneCountIn,
  singlePane,
  type Model,
  type TabDrag,
  type TabModel
} from './app/paneModel'
import { useAppKeyboard } from './app/useAppKeyboard'
import { PROFILE_NAMES, useConsoleSessions } from './app/useConsoleSessions'
import { useSettingsSync } from './app/useSettingsSync'
import { useWorkspaceLayout } from './app/useWorkspaceLayout'
import { PANE_LABELS, windowCommands } from './app/windowCommands'
import { ActivityDialog } from './components/ActivityDialog'
import { AgentSessionsDialog } from './components/AgentSessionsDialog'
import { AutomationsDialog } from './components/AutomationsDialog'
import { BtcTicker } from './components/BtcTicker'
import { CommandPalette } from './components/CommandPalette'
import { ConsolePanel, PROFILE_BADGE } from './components/ConsolePanel'
import { ContextMenu, type MenuItem, type MenuState } from './components/ContextMenu'
import { DiskAccessOffer, useDiskGrants } from './components/DiskAccess'
import { ErrorDialog } from './components/ErrorDialog'
import { FeedbackDialog } from './components/FeedbackDialog'
import { GamesPanel } from './components/games/GamesPanel'
import { GitPanel } from './components/GitPanel'
import { IconSetContext } from './components/Icon'
import { MatrixRain } from './components/MatrixRain'
import { ReleaseNotesDialog } from './components/ReleaseNotesDialog'
import { RemoteDialog } from './components/RemoteDialog'
import { ScreenShareBanner } from './components/ScreenShareBanner'
import { SettingsDialog, type Section as SettingsSection } from './components/SettingsDialog'
import { StocksPanel } from './components/StocksPanel'
import { TabStrip } from './components/TabStrip'
import { TabView, type Slots, type TabReport } from './components/TabView'
import { TitleBar } from './components/TitleBar'
import { TodoPanel, type TodoLink } from './components/TodoPanel'
import { ToolsPanel } from './components/tools/ToolsPanel'
import { Tour, TourOffer } from './components/Tour'
import { AreaHeader, AreaTree, DockOverlay, EditorButton, WorkspaceBar } from './components/Workspace'
import { dragging } from './lib/dnd'
import { applyShortcuts, keys } from './lib/keys'
import type { PaletteCommand } from './lib/palette'
import { setRemoteMounts } from './lib/remotes'
import { configureSound, playSound } from './lib/sound'
import { useBtcQuote } from './lib/useThemeInfo'

/** The Task Manager as an area of its own; the same component as the tool, loaded the first time it is shown. */
const SystemMonitor = lazy(() => import('./components/tools/SystemMonitor'))
const DockerPanel = lazy(() => import('./components/docker/DockerPanel'))

const api = window.api

// The window body is the active workspace's area tree (see @shared/workspace). Every editor renders once
// into its own stable host element, which is moved into whichever area shows it, so switching
// workspaces or moving areas never remounts tabs or terminals. The Files area holds panes; each pane
// holds tabs; each tab is a TabView with its own folder, history, filter, grouping and selection. The
// active tab of the active pane renders the toolbar, address bar, folder tree, tasks, preview and status
// bar into the slots below. The parts live in ./app: the pane model, settings sync, workspace layout,
// console sessions, window commands and keyboard.

setOs(api.platform)

export function App(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const showError = useCallback((err: unknown) => {
    playSound('error')
    setError(err instanceof Error ? err.message : String(err))
  }, [])
  const [places, setPlaces] = useState<Place[]>([])
  const reloadPlaces = (): void => void api.places().then(setPlaces, () => {})
  const { settings, setSettings, updateSettings, saveNow, persist } = useSettingsSync(showError, reloadPlaces)
  // Before anything below renders, so labels and handlers use the user's shortcuts (also from other windows).
  applyShortcuts(settings?.shortcuts)
  // The active language is module state read by t(); set it before the tree renders.
  const language = resolveLanguage(settings?.language, navigator.languages)
  setLanguage(language)
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  /** Place names come localized from the main process – fetch them again once the language is saved. */
  const changeLanguage = (lang: LanguageSetting): void =>
    void saveNow({ language: lang })
      .then(() => api.places())
      .then(setPlaces)
      .catch(showError)

  const [activityOpen, setActivityOpen] = useState(false)
  const [automationsOpen, setAutomationsOpen] = useState(false)
  const [model, setModel] = useState<Model | null>(null)
  const [reports, setReports] = useState<Record<string, TabReport>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [chrome, setChrome] = useState<Pick<Slots, 'toolbar' | 'address' | 'status'> | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>()
  const [tourOpen, setTourOpen] = useState(false)
  const [diskGrants] = useDiskGrants()
  const [diskOfferClosed, setDiskOfferClosed] = useState(false)
  // Folders opened before the grant failed in the sandbox: start over with the access in place.
  const grantedDisk = (): void => window.location.reload()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)
  // Once after an update: what changed in the version that just started.
  useEffect(() => void api.releaseNotes.pending().then((p) => p && setReleaseNotesOpen(true), () => undefined), [])
  const openFeedback = useCallback((): void => setFeedbackOpen(true), [])
  const [remotes, setRemotes] = useState<RemoteMount[]>([])
  /** Commands shown by the open palette (a snapshot taken when it opened), or null. */
  const [palette, setPalette] = useState<PaletteCommand[] | null>(null)
  /** The focused tab's palette commands. */
  const tabCommands = useRef<(() => PaletteCommand[]) | null>(null)
  const [pastSessions, setPastSessions] = useState(false)
  /** The connection dialog: { connection: null } adds a new one; `type`/`link` a new one of this type, e.g. another computer with its pairing link already pasted. */
  const [remoteDialog, setRemoteDialog] = useState<{ connection: RemoteConnection | null; type?: RemoteType; link?: string } | null>(null)
  // Module state read by folderLabel() and the address bar; set before the tree renders.
  setRemoteMounts(remotes)
  const toolbarSlot = useRef<HTMLDivElement>(null)
  const addressSlot = useRef<HTMLDivElement>(null)
  const statusSlot = useRef<HTMLDivElement>(null)
  const panesRef = useRef<HTMLDivElement>(null)
  const reportsRef = useRef(reports)
  reportsRef.current = reports

  // ---- panes & tabs ----------------------------------------------------------------------------

  /** Current folder, grouping and preview of a tab (falls back to how it started). */
  const current = (tab: TabModel): TabModel => {
    const r = reportsRef.current[tab.id]
    return r ? { ...tab, path: r.path, groupBy: r.groupBy, preview: r.preview, view: r.view } : tab
  }
  const edit = (fn: (m: Model) => Model): void => setModel((m) => m && fn(m))

  const focusedTab = model ? model.panes[model.activePane].tabs[model.panes[model.activePane].active] : null
  const focusedPath = focusedTab ? current(focusedTab).path : api.homeDir
  const focusedPathRef = useRef(focusedPath)
  focusedPathRef.current = focusedPath

  /** A new tab renders nothing (no toolbar, tree or status bar) until its first listing arrives, so it is
   * added in the background and activated on its first report – switching right away made the window blink. */
  const pendingTab = useRef<string | null>(null)
  const onReport = useCallback((id: string, r: TabReport) => {
    setReports((m) => {
      const cur = m[id]
      return cur && cur.path === r.path && cur.title === r.title && cur.groupBy === r.groupBy && cur.preview === r.preview && cur.view === r.view ? m : { ...m, [id]: r }
    })
    if (pendingTab.current !== id) return
    pendingTab.current = null
    setModel((m) => m && activateTab(m, id))
  }, [])

  const addTab = (paneIndex: number, path: string, at?: number): void => {
    playSound('tab')
    const tab = newTab(path)
    pendingTab.current = tab.id
    edit((m) => addTabTo(m, paneIndex, tab, at))
  }
  const selectTab = (paneIndex: number, tabIndex: number): void => {
    pendingTab.current = null
    edit((m) => selectTabIn(m, paneIndex, tabIndex))
  }
  const closeTab = (paneIndex: number, tabIndex: number): void => {
    if (!model) return
    playSound('tab')
    if (model.panes.length === 1 && model.panes[0].tabs.length === 1) return api.window.close()
    edit((m) => closeTabIn(m, paneIndex, tabIndex))
  }
  const moveTab = (drag: TabDrag, toPane: number, toIndex: number): void => edit((m) => moveTabIn(m, drag, toPane, toIndex, current))
  const setPaneCount = (count: number): void => edit((m) => setPaneCountIn(m, count, focusedPath, current))
  const focusPane = (index: number): void => edit((m) => focusPaneIn(m, index))
  const openInActivePane = (path: string): void => {
    if (model) addTab(model.activePane, path)
  }

  // An AI agent asked (over MCP) to show a folder: a new tab in the active pane.
  const activePaneRef = useRef(0)
  activePaneRef.current = model?.activePane ?? 0
  useEffect(() => api.mcp.onOpen((path) => addTab(activePaneRef.current, path)), [])

  // ---- workspaces, areas and the console ---------------------------------------------------------

  const layout = useWorkspaceLayout({
    settings,
    updateSettings,
    onSwitch: (target) => setModel((m) => m && fitPanes(m, target.panes, focusedPathRef.current, current)),
    remember: !api.initialPath
  })
  const { ws, workspaces, maximized, paneAxis, isShown, showEditor } = layout
  const consoleOpen = isShown('console')
  const setConsoleOpen = (open: boolean): void => (open ? showEditor('console') : layout.hideEditor('console'))
  const consoles = useConsoleSessions({ reveal: () => setConsoleOpen(true), showError })

  // The workspace remembers how many file panes it shows.
  useEffect(() => {
    if (model && ws && ws.panes !== model.panes.length) layout.editWorkspace((w) => ({ ...w, panes: model.panes.length }), ws.id)
  }, [model?.panes.length, ws?.id])

  /** "Add to-do…" from a file's menu: shows the Todo area with that file attached to the input. */
  const [todoDraft, setTodoDraft] = useState<(TodoLink & { nonce: number }) | null>(null)
  const addTodo = (link: TodoLink): void => {
    showEditor('todo')
    setTodoDraft({ ...link, nonce: Date.now() })
  }

  // ---- startup -------------------------------------------------------------------------------

  useEffect(() => {
    void (async () => {
      const s = await api.getSettings()
      setSettings(s)
      layout.setActiveWs(s.activeWorkspace)
      setPlaces(await api.places().catch(() => []))
      const start = api.initialPath ?? s.lastPath ?? api.homeDir
      // A window replacing another (native window buttons switched) continues where that one was.
      const handover = await api.window.takeHandover().catch(() => null)
      if (handover) {
        consoles.takeOver(handover.sessions, handover.output, handover.activeSession)
        layout.setMaximized(handover.maximized as Editor | null)
      }
      const saved = handover?.layout ?? (!api.initialPath ? s.layout : null)
      const m = saved ? fromLayout(saved) : singlePane(start)
      const w = s.workspaces.find((x) => x.id === s.activeWorkspace) ?? s.workspaces[0]
      setModel(fitPanes(m, w.panes, start, current))
    })()
  }, [])

  // Remote connections: loaded once, then refreshed whenever any window changes them.
  useEffect(() => {
    const refresh = (): void => void api.remote.list().then(setRemotes, () => {})
    refresh()
    return api.remote.onChanged(refresh)
  }, [])

  /** A connection was saved: show it in a new tab of the active pane. */
  const remoteSaved = async (id: string): Promise<void> => {
    setRemoteDialog(null)
    const list = await api.remote.list().catch(() => remotes)
    setRemotes(list)
    const mount = list.find((m) => m.connection.id === id)
    if (mount) openInActivePane(mount.path)
  }

  useLayoutEffect(() => {
    if (chrome || !toolbarSlot.current || !addressSlot.current || !statusSlot.current) return
    setChrome({ toolbar: toolbarSlot.current, address: addressSlot.current, status: statusSlot.current })
  })

  // The main window remembers its panes and tabs; extra windows (⌘N) are throwaway.
  useEffect(() => {
    if (!model || api.initialPath) return
    const timer = setTimeout(() => persist({ layout: layoutOf(model, current) }), 500)
    return () => clearTimeout(timer)
  }, [model, reports])

  /** This window's state for the window replacing it (Windows/Linux, native window buttons switched). */
  const handoverRef = useRef<() => Omit<WindowHandover, 'output'> | null>(() => null)
  handoverRef.current = () =>
    model && { layout: layoutOf(model, current), sessions: consoles.sessions.filter((s) => s.exitCode === null), activeSession: consoles.activeSession, maximized }
  useEffect(() => api.window.onHandover(() => handoverRef.current()), [])

  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])
  useEffect(() => {
    document.documentElement.toggleAttribute('data-clean', settings?.cleanLook === true)
  }, [settings?.cleanLook])

  // Music plays in the main window only, so more windows do not play it over each other.
  useEffect(() => {
    if (!settings) return
    const { sounds, soundVolume, music, musicVolume, theme } = settings
    configureSound({ sounds, soundVolume: soundVolume / 100, music, musicVolume: musicVolume / 100, theme }, api.initialPath === null)
  }, [settings?.sounds, settings?.soundVolume, settings?.music, settings?.musicVolume, settings?.theme])

  // Never let a file dropped outside a drop target navigate the window away; a drag that ended outside the
  // window never produces a drop here, so it is forgotten on the next click.
  useEffect(() => {
    const block = (e: DragEvent): void => e.preventDefault()
    const reset = (): void => {
      dragging.paths = []
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    window.addEventListener('mousedown', reset)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
      window.removeEventListener('mousedown', reset)
    }
  }, [])

  const startResize = (index: number, e: React.MouseEvent): void => {
    if (!model || !panesRef.current) return
    e.preventDefault()
    const row = paneAxis === 'row'
    const size = row ? panesRef.current.clientWidth : panesRef.current.clientHeight
    const total = model.panes.reduce((s, p) => s + p.weight, 0)
    const a = model.panes[index - 1].weight
    const b = model.panes[index].weight
    const min = total * 0.12
    const start = row ? e.clientX : e.clientY
    const move = (ev: MouseEvent): void => {
      const left = Math.min(Math.max(a + (((row ? ev.clientX : ev.clientY) - start) / size) * total, min), a + b - min)
      edit((m) => resizePanes(m, index, left, a + b))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---- areas ---------------------------------------------------------------------------------

  // Every editor renders once into a stable host element; the layout effect below moves each host
  // into the area that shows it, or into the hidden parking lot. Moving DOM nodes keeps React state,
  // terminals and their scrollback intact.
  const [hosts] = useState(
    () => Object.fromEntries(EDITORS.map((e) => [e, Object.assign(document.createElement('div'), { className: `area-host host-${e}` })])) as Record<Editor, HTMLDivElement>
  )
  const parking = useRef<HTMLDivElement>(null)
  const areaPlaces = useRef<Partial<Record<Editor, HTMLDivElement | null>>>({})
  const placeRefs = useMemo(
    () => Object.fromEntries(EDITORS.map((e) => [e, (el: HTMLDivElement | null) => void (areaPlaces.current[e] = el)])) as Record<Editor, (el: HTMLDivElement | null) => void>,
    []
  )
  useLayoutEffect(() => {
    for (const e of EDITORS) {
      const target = areaPlaces.current[e] ?? parking.current
      if (target && hosts[e].parentNode !== target) target.appendChild(hosts[e])
    }
  })

  const shownKey = layout.shown.join()
  const slots = useMemo<Slots | null>(
    () => chrome && { ...chrome, folders: isShown('folders') ? hosts.folders : null, tasks: isShown('tasks') ? hosts.tasks : null, preview: isShown('preview') ? hosts.preview : null },
    [chrome, shownKey]
  )

  const menuAt = (e: React.MouseEvent, items: MenuItem[]): void => setMenu({ x: e.clientX, y: e.clientY, items })
  const menuBelow = (e: React.MouseEvent, items: MenuItem[]): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: r.left, y: r.bottom + 2, items })
  }
  const showAreaMenu = (editor: Editor, e: React.MouseEvent): void => {
    const items = layout.areaMenuItems(editor)
    if (!items.length) return
    if (e.type === 'contextmenu') menuAt(e, items)
    else menuBelow(e, items)
  }

  const renderArea = (editor: Editor): React.ReactNode => (
    <div key={editor} className={`area area-${editor}${layout.areaDrag.dragging === editor ? ' dragging' : ''}`} data-editor={editor}>
      {editor !== 'files' && editor !== 'console' && (
        <AreaHeader
          editor={editor}
          maximized={maximized === editor}
          onMenu={(e) => showAreaMenu(editor, e)}
          onDragStart={(e) => layout.areaDrag.start(e, editor)}
          onMaximize={() => layout.toggleMaximize(editor)}
          onClose={() => layout.closeArea(editor)}
        />
      )}
      <div className="area-body" ref={placeRefs[editor]} />
    </div>
  )

  /** Handle of an area without a header of its own (Files, Console): drag to move, button for the menu. */
  const areaHandle = (editor: Editor): React.ReactNode => (
    <div className="area-grip" title={t('area.dragHint')} onMouseDown={(e) => layout.areaDrag.start(e, editor)} onContextMenu={(e) => (e.preventDefault(), showAreaMenu(editor, e))}>
      <span className="area-grip-dots" aria-hidden="true">
        ⠿
      </span>
      <EditorButton editor={editor} onMenu={(e) => showAreaMenu(editor, e)} />
    </div>
  )

  // ---- menus ----------------------------------------------------------------------------------

  const consoleMenuItems = (cwd: string): MenuItem[] => {
    const item = (profile: TerminalProfile, labelKey: MessageKey): MenuItem => {
      const installed = consoles.profiles?.[profile] ?? profile === 'shell'
      return {
        label: installed ? `${PROFILE_BADGE[profile]}  ${t(labelKey)}` : t('console.notInstalled', { name: PROFILE_NAMES[profile]() }),
        disabled: !installed,
        onClick: () => void consoles.open(profile, cwd)
      }
    }
    return [
      item('claude', 'console.openClaude'),
      item('codex', 'console.openCodex'),
      item('opencode', 'console.openOpencode'),
      item('shell', 'console.openShell'),
      { label: `↺  ${t('console.past.open')}`, disabled: !AGENT_KINDS.some((a) => consoles.profiles?.[a]), onClick: () => setPastSessions(true) },
      'separator',
      { label: t('console.toggle'), checked: consoleOpen, shortcut: keys.label('toggleConsole'), onClick: () => setConsoleOpen(!consoleOpen) },
      { label: t('console.refresh'), onClick: () => void consoles.refreshProfiles() }
    ]
  }

  const showConsoleNewMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const items = consoleMenuItems(focusedPath)
    // Opening upwards: the console sits at the bottom of the window.
    setMenu({ x: r.left, y: Math.max(8, r.top - 26 * items.length), items })
  }

  const startTour = (): void => {
    setMenu(null)
    setTourOpen(true)
    if (settings && !settings.tourOffered) updateSettings({ tourOffered: true })
  }
  const openSettings = (section?: SettingsSection): void => {
    setSettingsSection(section)
    setSettingsOpen(true)
  }
  const closeSettings = (): void => {
    setSettingsOpen(false)
    setSettingsSection(undefined)
  }

  const showHelpMenu = (e: React.MouseEvent): void =>
    menuBelow(e, [
      { label: t('tour.start'), icon: 'help', shortcut: keys.label('tour'), onClick: startTour },
      { label: t('help.shortcuts'), icon: 'settings', onClick: () => openSettings('shortcuts') },
      { label: t('releaseNotes.title'), onClick: () => setReleaseNotesOpen(true) },
      'separator',
      { label: t('feedback.open'), icon: 'feedback', onClick: openFeedback }
    ])

  const showPanesMenu = (e: React.MouseEvent): void =>
    menuBelow(e, [
      ...PANE_LABELS.map((label, i) => ({ label: t(label), checked: model?.panes.length === i + 1, shortcut: i === 1 ? keys.label('split') : undefined, onClick: () => setPaneCount(i + 1) })),
      ...(model && model.panes.length > 1 ? [{ label: t('area.stackPanes'), checked: paneAxis === 'column', onClick: layout.toggleStackPanes }] : []),
      'separator',
      { label: t('tabs.new'), shortcut: keys.label('newTab'), onClick: () => openInActivePane(focusedPath) },
      { label: t('window.new'), shortcut: keys.label('newWindow'), onClick: () => api.window.open(focusedPath) }
    ])

  const showTabMenu = (paneIndex: number, tabIndex: number, e: React.MouseEvent): void => {
    if (!model) return
    const tab = current(model.panes[paneIndex].tabs[tabIndex])
    const paneCount = model.panes.length
    menuAt(e, [
      { label: t('tabs.new'), shortcut: keys.label('newTab'), onClick: () => addTab(paneIndex, tab.path) },
      { label: t('tabs.duplicate'), onClick: () => addTab(paneIndex, tab.path, tabIndex + 1) },
      ...(paneCount > 1 ? [{ label: t('tabs.toNeighbour'), onClick: () => moveTab({ pane: paneIndex, tab: tabIndex }, (paneIndex + 1) % paneCount, 999) }] : []),
      ...(paneCount < MAX_PANES && model.panes[paneIndex].tabs.length > 1 ? [{ label: t('tabs.toNewPane'), onClick: () => moveTab({ pane: paneIndex, tab: tabIndex }, paneCount, 0) }] : []),
      { label: t('action.openInNewWindow'), onClick: () => api.window.open(tab.path) },
      'separator',
      { label: t('tabs.close'), shortcut: keys.label('closeTab'), onClick: () => closeTab(paneIndex, tabIndex) },
      { label: t('tabs.closeOthers'), disabled: model.panes[paneIndex].tabs.length < 2, onClick: () => edit((m) => closeOtherTabsIn(m, paneIndex, tabIndex)) }
    ])
  }

  // ---- palette and keyboard ------------------------------------------------------------------------

  const openPalette = (): void => {
    if (!model || !settings) return setPalette([...(tabCommands.current?.() ?? [])])
    const pane = model.panes[model.activePane]
    setPalette([
      ...(tabCommands.current?.() ?? []),
      ...windowCommands({
        settings,
        paneCount: model.panes.length,
        workspaces,
        activeWorkspace: ws?.id ?? null,
        maximized: maximized !== null,
        consoleOpen,
        profiles: consoles.profiles,
        remotes,
        isShown,
        newTab: () => addTab(model.activePane, focusedPath),
        closeTab: () => closeTab(model.activePane, pane.active),
        newWindow: () => api.window.open(focusedPath),
        switchWorkspace: layout.switchWorkspace,
        duplicateWorkspace: layout.duplicateCurrent,
        toggleMaximize: () => layout.toggleMaximize(),
        toggleArea: layout.toggleArea,
        setPaneCount,
        addRemote: () => setRemoteDialog({ connection: null }),
        openDesktop: (id) => void api.remote.openDesktop(id).catch(showError),
        openActivity: () => setActivityOpen(true),
        openAutomations: () => setAutomationsOpen(true),
        startTour,
        openReleaseNotes: () => setReleaseNotesOpen(true),
        openFeedback,
        openSettings: () => openSettings(),
        setConsoleOpen,
        openConsole: (profile) => void consoles.open(profile, focusedPath),
        updateSettings,
        changeLanguage
      })
    ])
  }

  const activePane = model?.panes[model.activePane]
  useAppKeyboard({
    ready: model !== null && error === null,
    openSettings: () => openSettings(),
    startTour,
    openPalette,
    toggleConsole: () => setConsoleOpen(!consoleOpen),
    cycleWorkspace: layout.cycleWorkspace,
    toggleMaximize: () => layout.toggleMaximize(),
    newTab: () => openInActivePane(focusedPath),
    closeTab: () => model && activePane && closeTab(model.activePane, activePane.active),
    newWindow: () => api.window.open(focusedPath),
    toggleSplit: () => model && setPaneCount(model.panes.length === 1 ? 2 : 1),
    cycleTab: (step) => model && activePane && selectTab(model.activePane, (activePane.active + step + activePane.tabs.length) % activePane.tabs.length),
    selectTabDigit: (digit) => model && activePane && selectTab(model.activePane, digit === 9 ? activePane.tabs.length - 1 : digit - 1),
    paneCount: model?.panes.length ?? 0,
    cyclePane: (step) => model && focusPane((model.activePane + step + model.panes.length) % model.panes.length)
  })

  // ---- render -------------------------------------------------------------------------------

  const title = (focusedTab && reports[focusedTab.id]?.title) ?? t('app.name')
  // Folder tree roots: the drives on Windows, "/" elsewhere.
  const roots = api.platform === 'win32' ? places.filter((p) => p.icon === 'disk' || p.icon === 'volume').map((p) => p.path) : ['/']
  useEffect(() => {
    document.title = title
  }, [title])

  const ready = settings && model
  const btc = useBtcQuote(settings?.theme === 'bitcoin' && settings.themeInfo)
  const uiIcons = settings?.iconSet ?? 'flat'
  const fileIcons = settings?.fileIconSet ?? 'match'
  const iconSets = useMemo(() => ({ ui: uiIcons, files: fileIcons === 'match' ? uiIcons : fileIcons }), [uiIcons, fileIcons])
  const openConsoleIn = (profile: TerminalProfile, cwd: string, prompt?: string): void => void consoles.open(profile, cwd, prompt)
  return (
    <IconSetContext.Provider value={iconSets}>
      <div className="xp-window app">
        {settings?.theme === 'matrix' && <MatrixRain />}
        <TitleBar title={title} extra={btc && <BtcTicker quote={btc} />} />
        <div className="slot" ref={toolbarSlot} />
        <div className="slot" ref={addressSlot} />
        {ready && ws && settings?.workspaceBar && (
          <WorkspaceBar
            workspaces={workspaces}
            active={ws.id}
            editing={layout.renamingWs}
            onEdit={layout.setRenamingWs}
            onSelect={layout.switchWorkspace}
            onRename={(id, name) => layout.editWorkspace((w) => ({ ...w, name }), id)}
            onMenu={(id, e) => menuAt(e, layout.workspaceMenuItems(id))}
            onAdd={(e) => menuBelow(e, layout.addWorkspaceItems())}
            onAreas={(e) => menuBelow(e, layout.addAreaMenuItems())}
            onReorder={layout.moveWorkspace}
          />
        )}
        <ScreenShareBanner enabled={!!(settings?.companionEnabled || settings?.computersEnabled)} />
        <div className="main workspace-body">{layout.shownTree && <AreaTree node={layout.shownTree} path="" renderArea={renderArea} onRatio={layout.setRatio} />}</div>
        {/* Editors not shown in the workspace wait here, mounted, so tabs and terminals keep their state. */}
        <div className="area-parking" ref={parking} aria-hidden="true" />
        {createPortal(
          <div className={`panes split-${paneAxis}`} ref={panesRef}>
            {ready &&
              model.panes.map((pane, pi) => {
                const neighbour = model.panes.length > 1 ? model.panes[(pi + 1) % model.panes.length] : null
                const otherPath = neighbour ? current(neighbour.tabs[neighbour.active]).path : null
                return (
                  <Fragment key={pane.id}>
                    {pi > 0 && <div className={`pane-divider split-${paneAxis}`} onMouseDown={(e) => startResize(pi, e)} />}
                    <div
                      className={`pane${pi === model.activePane ? ' active' : ''}`}
                      // Relative to the lightest pane: flex-grow values adding up to less than 1 leave part of
                      // the area empty (a lone pane keeping its 0.9 from an earlier split).
                      style={{ flexGrow: pane.weight / Math.min(...model.panes.map((q) => q.weight)) }}
                      onMouseDownCapture={() => focusPane(pi)}
                      onContextMenuCapture={() => focusPane(pi)}
                    >
                      <TabStrip
                        pane={pi}
                        tabs={pane.tabs.map((tab) => {
                          const path = reports[tab.id]?.path ?? tab.path
                          const agents = consoles.runningAgents.filter((s) => samePath(s.cwd, path))
                          return { id: tab.id, title: reports[tab.id]?.title ?? '…', agents }
                        })}
                        active={pane.active}
                        paneActive={pi === model.activePane && model.panes.length > 1}
                        onSelect={(ti) => selectTab(pi, ti)}
                        onClose={(ti) => closeTab(pi, ti)}
                        onNew={() => addTab(pi, current(pane.tabs[pane.active]).path)}
                        onContextMenu={(ti, e) => showTabMenu(pi, ti, e)}
                        onDropTab={(drag, index) => moveTab(drag, pi, index)}
                        onOpenAgent={consoles.show}
                        lead={pi === 0 ? areaHandle('files') : undefined}
                      />
                      <div className="pane-body">
                        {pane.tabs.map((tab, ti) => (
                          <TabView
                            key={tab.id}
                            id={tab.id}
                            initialPath={tab.path}
                            initialGroupBy={tab.groupBy}
                            initialPreview={tab.preview}
                            initialView={tab.view}
                            visible={ti === pane.active}
                            focused={pi === model.activePane && ti === pane.active}
                            settings={settings}
                            updateSettings={updateSettings}
                            places={places}
                            roots={roots}
                            slots={slots}
                            paneCount={model.panes.length}
                            otherPath={otherPath}
                            onReport={onReport}
                            showMenu={setMenu}
                            showError={showError}
                            onAutomations={() => setAutomationsOpen(true)}
                            onSettings={() => openSettings()}
                            onHelp={showHelpMenu}
                            onPanesMenu={showPanesMenu}
                            onOpenInNewTab={(p) => addTab(pi, p)}
                            onAddTodo={addTodo}
                            consoleProfiles={consoles.profiles}
                            consoleOpen={consoleOpen}
                            foldersShown={isShown('folders')}
                            onToggleFolders={layout.toggleFolders}
                            onOpenConsole={openConsoleIn}
                            onRunInConsole={(path, target) => void consoles.run(path, target)}
                            paletteRef={tabCommands}
                            onConsoleMenu={(e) => menuBelow(e, consoleMenuItems(focusedPath))}
                            canInsertIntoConsole={consoles.liveSession !== null}
                            onInsertIntoConsole={consoles.insertPaths}
                            remotes={remotes}
                            onEditRemote={(connection, type) => setRemoteDialog({ connection, type })}
                          />
                        ))}
                      </div>
                    </div>
                  </Fragment>
                )
              })}
          </div>,
          hosts.files
        )}
        {/* Stays mounted while hidden, so running sessions keep their screen and scrollback. */}
        {settings &&
          (consoleOpen || consoles.sessions.length > 0) &&
          createPortal(
            <ConsolePanel
              hidden={!consoleOpen}
              sessions={consoles.sessions}
              active={consoles.activeSession}
              theme={settings.theme}
              sidebar={settings.consoleSidebar}
              handle={areaHandle('console')}
              onToggleSidebar={() => updateSettings({ consoleSidebar: !settings.consoleSidebar })}
              history={settings.consoleHistory}
              onToggleHistory={() => updateSettings({ consoleHistory: !settings.consoleHistory })}
              onSelect={consoles.setActiveSession}
              onClose={consoles.close}
              onHide={() => setConsoleOpen(false)}
              onNewMenu={showConsoleNewMenu}
              onPastSessions={() => setPastSessions(true)}
            />,
            hosts.console
          )}
        {settings &&
          createPortal(
            <GitPanel cwd={focusedPath} visible={isShown('git')} showError={showError} showMenu={setMenu} onOpenConsole={openConsoleIn} onOpenFolder={openInActivePane} />,
            hosts.git
          )}
        {createPortal(
          <TodoPanel cwd={focusedPath} draft={todoDraft} showError={showError} showMenu={setMenu} onOpenLink={(l) => openInActivePane(l.isDir ? l.path : dirOf(l.path))} />,
          hosts.todo
        )}
        {createPortal(<GamesPanel visible={isShown('games')} />, hosts.games)}
        {createPortal(
          <div className="monitor-panel">
            <Suspense fallback={null}>
              <SystemMonitor visible={isShown('monitor')} />
            </Suspense>
          </div>,
          hosts.monitor
        )}
        {createPortal(
          <div className="monitor-panel docker-panel">
            {isShown('docker') && (
              <Suspense fallback={null}>
                <DockerPanel
                  visible={isShown('docker')}
                  folder={focusedPath}
                  onShell={(id, name) => void consoles.containerShell(id, name, focusedPath)}
                  onOpenFolder={openInActivePane}
                />
              </Suspense>
            )}
          </div>,
          hosts.docker
        )}
        {settings && createPortal(<ToolsPanel visible={isShown('tools')} folder={focusedPath} settings={settings} updateSettings={updateSettings} />, hosts.tools)}
        {settings &&
          createPortal(
            <StocksPanel visible={isShown('stocks')} symbols={settings.stocks} theme={settings.theme} onChange={(stocks) => updateSettings({ stocks })} showMenu={setMenu} />,
            hosts.stocks
          )}
        {layout.areaDrag.target && <DockOverlay target={layout.areaDrag.target} />}
        <div className="slot" ref={statusSlot} />
        {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
        {palette && <CommandPalette commands={palette} onClose={() => setPalette(null)} />}
        {remoteDialog && (
          <RemoteDialog connection={remoteDialog.connection} type={remoteDialog.type} link={remoteDialog.link} onSaved={(id) => void remoteSaved(id)} onCancel={() => setRemoteDialog(null)} />
        )}
        {activityOpen && (
          <ActivityDialog
            cwd={focusedPath}
            onClose={() => setActivityOpen(false)}
            onOpenFolder={(folder) => {
              openInActivePane(folder)
              setActivityOpen(false)
            }}
          />
        )}
        {automationsOpen && <AutomationsDialog cwd={focusedPath} onClose={() => setAutomationsOpen(false)} />}
        {settingsOpen && settings && (
          <SettingsDialog
            section={settingsSection}
            onOpenActivity={() => {
              setSettingsOpen(false)
              setActivityOpen(true)
            }}
            settings={settings}
            onChange={updateSettings}
            onLanguageChange={changeLanguage}
            onConnectComputer={(link) => {
              closeSettings()
              setRemoteDialog({ connection: null, type: 'afinder', link })
            }}
            onClose={closeSettings}
          />
        )}
        {pastSessions && (
          <AgentSessionsDialog
            folder={focusedPath}
            installed={{ claude: consoles.profiles?.claude === true, codex: consoles.profiles?.codex === true, opencode: consoles.profiles?.opencode === true }}
            onResume={(s) => void consoles.resume(s).then((ok) => ok && setPastSessions(false))}
            onClose={() => setPastSessions(false)}
          />
        )}
        {tourOpen && <Tour onClose={() => setTourOpen(false)} />}
        {window.api.mas && diskGrants?.length === 0 && !diskOfferClosed && <DiskAccessOffer onGranted={grantedDisk} onDismiss={() => setDiskOfferClosed(true)} />}
        {settings && !settings.tourOffered && !tourOpen && !(window.api.mas && diskGrants?.length === 0 && !diskOfferClosed) && (
          <TourOffer onStart={startTour} onDismiss={() => updateSettings({ tourOffered: true })} />
        )}
        {releaseNotesOpen && <ReleaseNotesDialog onClose={() => setReleaseNotesOpen(false)} />}
        {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
        {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
      </div>
    </IconSetContext.Provider>
  )
}
