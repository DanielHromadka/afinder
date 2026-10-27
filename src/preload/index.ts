import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { DoomStatus } from '@shared/doom'
import {
  IPC,
  type AfinderApi,
  type ClipboardEntry,
  type CompanionStatus,
  type Result,
  type SearchBatch,
  type Settings,
  type SizeUpdate,
  type TailChunk,
  type TerminalData,
  type TerminalExit,
  type AgentInfo,
  type ToolsProgress,
  type TransferProgress
} from '@shared/types'
import type { DockerStreamEvent } from '@shared/docker'
import type { InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipcContract'

/** A request to main on a channel of the IPC contract: the arguments and the answer are the API method's. */
async function call<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<InvokeResult<C>>
  if (!res.ok) throw new Error(res.error)
  return res.value
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const arg = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}

const api: AfinderApi = {
  homeDir: arg('afinder-home') ?? '/',
  platform: process.platform,
  mas: arg('afinder-mas') === '1',
  about: { version: arg('afinder-version') ?? '', arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  initialPath: arg('afinder-open'),
  list: (p) => call(IPC.list, p),
  mkdir: (parent) => call(IPC.mkdir, parent),
  mkfile: (parent) => call(IPC.mkfile, parent),
  rename: (p, name) => call(IPC.rename, p, name),
  renameMany: (items) => call(IPC.renameMany, items),
  trash: (paths) => call(IPC.trash, paths),
  open: (p) => call(IPC.open, p),
  reveal: (p) => call(IPC.reveal, p),
  openTerminal: (p) => call(IPC.terminal, p),
  places: () => call(IPC.places),
  copyText: (text) => call(IPC.copyText, text),
  readText: () => call(IPC.readText),
  watchSizes: (id, dir, subdirs) => call(IPC.watchSizes, id, dir, subdirs),
  unwatchSizes: (id) => ipcRenderer.send(IPC.unwatchSizes, id),
  search: (id, request) => call(IPC.search, id, request),
  cancelSearch: (id) => ipcRenderer.send(IPC.cancelSearch, id),
  onSearchResults: (cb) => subscribe<SearchBatch>(IPC.searchResults, cb),
  onSizes: (cb) => subscribe<SizeUpdate[]>(IPC.sizes, cb),
  onDirChanged: (cb) => subscribe<string>(IPC.dirChanged, cb),
  writeFileClipboard: (paths, cut) => call(IPC.clipboardWriteFiles, paths, cut),
  readFileClipboard: () => call(IPC.clipboardReadFiles),
  planTransfer: (request) => call(IPC.planTransfer, request),
  runTransfer: (plan, policy) => call(IPC.runTransfer, plan, policy),
  cancelTransfer: () => ipcRenderer.send(IPC.cancelTransfer),
  createArchive: (request) => call(IPC.createArchive, request),
  onTransferProgress: (cb) => subscribe<TransferProgress>(IPC.transferProgress, cb),
  startDrag: (paths) => ipcRenderer.send(IPC.startDrag, paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  terminal: {
    profiles: (refresh) => call(IPC.terminalProfiles, refresh === true),
    open: (profile, cwd, cols, rows, prompt) => call(IPC.terminalOpen, profile, cwd, cols, rows, prompt),
    sessions: (folder) => call(IPC.agentSessions, folder),
    resume: (agent, sessionId, cwd, cols, rows) => call(IPC.terminalResume, agent, sessionId, cwd, cols, rows),
    targets: (p) => call(IPC.terminalTargets, p),
    run: (p, targetId, cols, rows) => call(IPC.terminalRun, p, targetId, cols, rows),
    write: (id, data) => ipcRenderer.send(IPC.terminalWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.terminalResize, id, cols, rows),
    close: (id) => ipcRenderer.send(IPC.terminalClose, id),
    onData: (cb) => subscribe<TerminalData>(IPC.terminalData, cb),
    onExit: (cb) => subscribe<TerminalExit>(IPC.terminalExit, cb),
    onAgent: (cb) => subscribe<AgentInfo>(IPC.terminalAgent, cb)
  },
  getSettings: () => call(IPC.getSettings),
  setSettings: (patch) => call(IPC.setSettings, patch),
  onSettingsChanged: (cb) => subscribe<Settings>(IPC.settingsChanged, cb),
  localCopies: (paths) => call(IPC.localCopies, paths),
  fileAssistant: {
    status: () => call(IPC.assistantStatus),
    download: () => call(IPC.assistantDownload),
    analyze: (input) => call(IPC.assistantAnalyze, input),
    apply: (input) => call(IPC.assistantApply, input),
    cancel: () => call(IPC.assistantCancel),
    clearTags: () => call(IPC.assistantClearTags),
    pickFolder: () => call(IPC.assistantPickFolder),
    onChanged: (callback) => subscribe(IPC.assistantChanged, callback)
  },
  activity: {
    visit: (folder) => call(IPC.activityVisit, folder),
    query: (query) => call(IPC.activityQuery, query),
    note: (folder, title, content) => call(IPC.activityNote, folder, title, content),
    status: () => call(IPC.activityStatus),
    check: () => call(IPC.activityCheck),
    download: () => call(IPC.activityDownload),
    rebuild: () => call(IPC.activityRebuild),
    clear: () => call(IPC.activityClear),
    export: (query) => call(IPC.activityExport, query),
    onChanged: (cb) => subscribe<void>(IPC.activityChanged, () => cb())
  },
  automations: {
    list: () => call(IPC.automationList),
    generate: (description, cwd, language) => call(IPC.automationGenerate, description, cwd, language),
    save: (id, draft) => call(IPC.automationSave, id, draft),
    enable: (id, enabled) => call(IPC.automationEnable, id, enabled),
    run: (id) => call(IPC.automationRun, id),
    cancel: (id) => call(IPC.automationCancel, id),
    remove: (id) => call(IPC.automationRemove, id),
    onChanged: (cb) => subscribe<void>(IPC.automationChanged, () => cb())
  },
  ai: {
    suggestNames: (items, hint, language) => call(IPC.aiSuggestNames, items, hint, language)
  },
  gitStatus: (p) => call(IPC.gitStatus, p),
  gitFile: (p) => call(IPC.gitFile, p),
  gitBlame: (p) => call(IPC.gitBlame, p),
  gitRepo: (p) => call(IPC.gitRepo, p),
  gitAction: (p, action) => call(IPC.gitAction, p, action),
  gitDiff: (p, source) => call(IPC.gitDiff, p, source),
  gitGraph: (p, ref, limit) => call(IPC.gitGraph, p, ref, limit),
  gitCommit: (p, hash) => call(IPC.gitCommit, p, hash),
  checkForUpdates: () => call(IPC.checkForUpdates),
  releaseNotes: { list: () => call(IPC.releaseNotes), pending: () => call(IPC.releaseNotesPending) },
  defaultApp: {
    status: () => call(IPC.defaultAppStatus),
    set: (on) => call(IPC.defaultAppSet, on)
  },
  diskAccess: { list: () => call(IPC.diskGrants), grant: (suggested) => call(IPC.diskGrant, suggested), revoke: (p) => call(IPC.diskRevoke, p) },
  tools: {
    hash: (id, p) => call(IPC.toolsHash, id, p),
    duplicates: (id, dir) => call(IPC.toolsDuplicates, id, dir),
    diskTree: (id, dir) => call(IPC.toolsDiskTree, id, dir),
    cancel: (id) => ipcRenderer.send(IPC.toolsCancel, id),
    onProgress: (cb) => {
      const listener = (_e: unknown, id: string, progress: ToolsProgress): void => cb(id, progress)
      ipcRenderer.on(IPC.toolsProgress, listener)
      return () => void ipcRenderer.removeListener(IPC.toolsProgress, listener)
    },
    rates: () => call(IPC.toolsRates),
    decodeImage: (p) => call(IPC.toolsDecodeImage, p),
    saveImage: (dir, name, data) => call(IPC.toolsSaveImage, dir, name, data),
    pick: (kind, multiple) => call(IPC.toolsPick, kind, multiple === true),
    clipboard: () => call(IPC.toolsClipboard),
    clearClipboard: () => call(IPC.toolsClipboardClear),
    onClipboard: (cb) => subscribe<ClipboardEntry[]>(IPC.toolsClipboardChanged, cb)
  },
  sys: {
    sample: () => call(IPC.sysSample),
    processes: () => call(IPC.sysProcesses),
    sensors: () => call(IPC.sysSensors),
    info: () => call(IPC.sysInfo),
    kill: (pid, force) => call(IPC.sysKill, pid, force)
  },
  docker: {
    status: () => call(IPC.dockerStatus),
    startDesktop: () => call(IPC.dockerStartDesktop),
    containers: () => call(IPC.dockerContainers),
    usage: () => call(IPC.dockerUsage),
    action: (id, action) => call(IPC.dockerAction, id, action),
    inspect: (id) => call(IPC.dockerInspect, id),
    shell: (id, cols, rows) => call(IPC.dockerShell, id, cols, rows),
    images: () => call(IPC.dockerImages),
    removeImage: (id, force) => call(IPC.dockerRemoveImage, id, force),
    pull: (image) => call(IPC.dockerPull, image),
    volumes: () => call(IPC.dockerVolumes),
    removeVolume: (name) => call(IPC.dockerRemoveVolume, name),
    networks: () => call(IPC.dockerNetworks),
    removeNetwork: (id) => call(IPC.dockerRemoveNetwork, id),
    diskUsage: () => call(IPC.dockerDiskUsage),
    prune: (kind) => call(IPC.dockerPrune, kind),
    compose: (project, action) => call(IPC.dockerCompose, project, action),
    composeFile: (folder) => call(IPC.dockerComposeFile, folder),
    composeUp: (folder) => call(IPC.dockerComposeUp, folder),
    logs: (id, tail, timestamps) => call(IPC.dockerLogs, id, tail, timestamps),
    stats: (id) => call(IPC.dockerStats, id),
    events: () => call(IPC.dockerEvents),
    stop: (streamId) => ipcRenderer.send(IPC.dockerStop, streamId),
    onStream: (cb) => subscribe<DockerStreamEvent>(IPC.dockerStream, cb),
    saveLogs: (name, text) => call(IPC.dockerSaveLogs, name, text),
    openPort: (port) => call(IPC.dockerOpenPort, port)
  },
  doom: {
    status: () => call(IPC.doomStatus),
    download: () => call(IPC.doomDownload),
    cancel: () => call(IPC.doomCancel),
    remove: () => call(IPC.doomRemove),
    onChanged: (cb) => subscribe<DoomStatus>(IPC.doomChanged, cb)
  },
  feedback: {
    send: (draft) => call(IPC.feedbackSend, draft)
  },
  systemInfo: (p) => call(IPC.systemInfo, p),
  btcPrice: () => call(IPC.btcPrice),
  stockQuotes: (symbols) => call(IPC.stockQuotes, symbols),
  stockSearch: (q) => call(IPC.stockSearch, q),
  screenshot: (folder, mode) => call(IPC.screenshot, folder, mode),
  copyImage: (p) => call(IPC.screenshotCopy, p),
  recents: {
    list: () => call(IPC.recents),
    forget: (p) => call(IPC.recentsForget, p),
    clear: () => call(IPC.recentsClear),
    onChanged: (cb) => subscribe<void>(IPC.recentsChanged, () => cb())
  },
  todos: {
    list: () => call(IPC.todos),
    save: (todo) => call(IPC.todosSave, todo),
    remove: (id) => call(IPC.todosRemove, id),
    clearDone: () => call(IPC.todosClearDone),
    notes: () => call(IPC.notes),
    saveNote: (p, text) => call(IPC.notesSave, p, text),
    onChanged: (cb) => subscribe<void>(IPC.todosChanged, () => cb())
  },
  preview: {
    docx: (p) => call(IPC.previewDocx, p),
    sheet: (p, index) => call(IPC.previewSheet, p, index ?? 0),
    thumbnail: (p, size) => call(IPC.previewThumbnail, p, size),
    save: (p, text, modified, bom, force) => call(IPC.previewSave, p, text, modified, bom, force === true),
    saveImage: (p, data, opts) => call(IPC.previewSaveImage, p, data, opts.modified, opts.force === true, opts.copy === true)
  },
  companion: {
    status: () => call(IPC.companionStatus),
    pair: (kind) => call(IPC.companionPair, kind),
    cancelPair: () => call(IPC.companionCancelPair),
    answer: (accept) => call(IPC.companionAnswer, accept),
    setWrite: (id, write) => call(IPC.companionDevice, id, write),
    setScreen: (id, screen) => call(IPC.companionScreen, id, screen),
    setControl: (id, control) => call(IPC.companionControl, id, control),
    stopScreen: () => call(IPC.companionStopScreen),
    remove: (id) => call(IPC.companionRemove, id),
    onChanged: (cb) => subscribe<CompanionStatus>(IPC.companionChanged, cb)
  },
  mcp: {
    info: () => call(IPC.mcpInfo),
    newToken: () => call(IPC.mcpNewToken),
    reportView: (view) => ipcRenderer.send(IPC.mcpReportView, view),
    onOpen: (cb) => subscribe<string>(IPC.mcpOpen, cb)
  },
  tail: {
    start: (p) => call(IPC.tailStart, p),
    stop: (id) => ipcRenderer.send(IPC.tailStop, id),
    onData: (cb) => subscribe<TailChunk>(IPC.tailData, cb)
  },
  remote: {
    list: () => call(IPC.remoteList),
    save: (connection, secrets) => call(IPC.remoteSave, connection, secrets),
    remove: (id) => call(IPC.remoteRemove, id),
    test: (connection, secrets) => call(IPC.remoteTest, connection, secrets),
    disconnect: (id) => call(IPC.remoteDisconnect, id),
    pickKey: () => call(IPC.remotePickKey),
    onChanged: (cb) => subscribe<void>(IPC.remoteChanged, () => cb()),
    pairStart: (uri) => call(IPC.remotePairStart, uri),
    pairWait: () => call(IPC.remotePairWait),
    pairCancel: () => call(IPC.remotePairCancel),
    openDesktop: (id) => call(IPC.remoteDesktopOpen, id)
  },
  window: {
    open: (p) => ipcRenderer.send(IPC.winNew, p),
    minimize: () => ipcRenderer.send(IPC.winMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.winToggleMaximize),
    close: () => ipcRenderer.send(IPC.winClose),
    onFullScreen: (cb) => subscribe<boolean>(IPC.winFullScreen, cb),
    onHandover: (collect) => subscribe<void>(IPC.winHandover, () => void ipcRenderer.invoke(IPC.winHandoverState, collect())),
    takeHandover: () => call(IPC.winTakeHandover)
  }
}

contextBridge.exposeInMainWorld('api', api)
