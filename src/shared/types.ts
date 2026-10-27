// Types shared by main, preload and renderer: the domain types live in ./model (re-exported here, so
// everything imports from '@shared/types'), the channel names in ./ipcChannels and their typing in
// ./ipcContract; this file keeps the API the renderer sees as window.api.

import type { ActivityPage, ActivityQuery, ActivityStatus } from './activity'
import type { AgentKind, AgentSession } from './agentSessions'
import type { Automation, AutomationDraft, AutomationProposal } from './automation'
import type { DeviceKind } from './companion/crypto'
import type { ComposeAction, ContainerAction, DockerContainer, DockerDiskUsage, DockerImage, DockerInspect, DockerNetwork, DockerPruneKind, DockerStatus, DockerStreamEvent, DockerUsage, DockerVolume } from './docker'
import type { DoomStatus } from './doom'
import type { AssistantApplied, AssistantApply, AssistantPlan, AssistantRequest, AssistantStatus } from './fileAssistant'
import type { CommitDetails, DiffSource, FileDiff, GitAction, GitBlame, GitFile, GitStatus, GraphCommit, RepoState } from './git'
import type { FileKind, Listing, Place, ScreenshotMode, ScreenshotResult, SearchBatch, SearchRequest, SheetPreview, SizeUpdate, TailChunk, TailInfo } from './model/files'
import type { BtcQuote, CompanionStatus, FeedbackDraft, McpStatus, McpView, SystemInfo } from './model/services'
import type { Settings, WindowHandover } from './model/settings'
import type { AgentInfo, RunTarget, TerminalData, TerminalExit, TerminalProfile, TerminalProfiles } from './model/terminal'
import type { ClipboardEntry, DiskNode, DuplicateGroup, FileHashes, SysInfo, SysProcess, SysSample, SysSensors, ToolsProgress } from './model/tools'
import type { ArchiveRequest, ConflictPolicy, FileClipboard, TransferPlan, TransferProgress, TransferRequest } from './model/transfer'
import type { RecentFile } from './recents'
import type { ReleaseNote } from './releaseNotes'
import type { RemoteConnection, RemoteMount, RemoteSecrets } from './remote'
import type { StockMatch, StockQuote } from './stocks'
import type { Note, Todo } from './todos'
import type { Rates } from './tools/rates'

export * from './model/files'
export * from './model/settings'
export * from './model/terminal'
export * from './model/transfer'
export * from './model/tools'
export * from './model/services'
export * from './ipcChannels'

/** API exposed to the renderer as `window.api`. */
export interface AfinderApi {
  homeDir: string
  /** process.platform of the machine: 'darwin', 'win32', 'linux', … */
  platform: string
  /** Mac App Store build: sandboxed, updated by the App Store, disk access granted per folder. */
  mas: boolean
  /** aFinder version, CPU architecture and the runtime versions, shown in Settings → General. */
  about: { version: string; arch: string; electron: string; chrome: string; node: string }
  /** Folder this window was opened with (⌘N), or null for the main window restoring its layout. */
  initialPath: string | null
  list(path: string): Promise<Listing>
  /** Creates "Nová složka" (or "Nová složka N") in parent, returns its full path. */
  mkdir(parent: string): Promise<string>
  /** Creates an empty "Nový soubor.txt" (or "Nový soubor N.txt") in parent, returns its full path. */
  mkfile(parent: string): Promise<string>
  /** Renames an item, returns the new full path. */
  rename(path: string, newName: string): Promise<string>
  /** Renames all items in one go (swaps allowed); returns the new paths. */
  renameMany(items: { path: string; name: string }[]): Promise<string[]>
  trash(paths: string[]): Promise<void>
  open(path: string): Promise<void>
  reveal(path: string): Promise<void>
  openTerminal(path: string): Promise<void>
  places(): Promise<Place[]>
  copyText(text: string): Promise<void>
  readText(): Promise<string>
  /** Sets the folder shown by a view (tab): watches it for changes and computes sizes of the given subfolders. */
  watchSizes(viewId: string, dir: string, subdirs: string[]): Promise<void>
  /** The view is hidden or gone – stop watching its folder. */
  unwatchSizes(viewId: string): void
  /** Starts (or restarts) a recursive search; results arrive via onSearchResults with the same id. */
  search(id: string, request: SearchRequest): Promise<void>
  cancelSearch(id: string): void
  onSearchResults(cb: (batch: SearchBatch) => void): () => void
  onSizes(cb: (updates: SizeUpdate[]) => void): () => void
  onDirChanged(cb: (dir: string) => void): () => void
  /** Puts files on the system clipboard (pasteable in Finder too). */
  writeFileClipboard(paths: string[], cut: boolean): Promise<void>
  /** Reads files from the system clipboard (also files copied in Finder). */
  readFileClipboard(): Promise<FileClipboard>
  planTransfer(request: TransferRequest): Promise<TransferPlan>
  /** Executes a plan, returns paths of the created items. */
  runTransfer(plan: TransferPlan, policy: ConflictPolicy): Promise<string[]>
  cancelTransfer(): void
  /** Runs like a transfer (progress events, cancelTransfer); null when cancelled. */
  createArchive(request: ArchiveRequest): Promise<string | null>
  onTransferProgress(cb: (progress: TransferProgress) => void): () => void
  /** Starts a native drag of the files (can be dropped into Finder and other apps). */
  startDrag(paths: string[]): void
  /** Resolves the path of a File from a drop event. */
  pathForFile(file: File): string
  terminal: {
    /** Installed agents (refresh = ask the shell again). */
    profiles(refresh?: boolean): Promise<TerminalProfiles>
    /** Starts a session in the folder; returns its id. Output arrives via onData. */
    open(profile: TerminalProfile, cwd: string, cols: number, rows: number, prompt?: string): Promise<string>
    /** Past Claude Code / Codex sessions (in the folder, or everywhere with null), newest first. */
    sessions(folder: string | null): Promise<AgentSession[]>
    /** Reopens a past agent session in a new console session in its folder; returns the id. */
    resume(agent: AgentKind, sessionId: string, cwd: string, cols: number, rows: number): Promise<string>
    /** Ways to run the project of a folder, or a Python file (empty when nothing is runnable). */
    targets(path: string): Promise<RunTarget[]>
    /** Starts a shell session running one of targets(path); returns its id. */
    run(path: string, targetId: string, cols: number, rows: number): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    close(id: string): void
    onData(cb: (d: TerminalData) => void): () => void
    onExit(cb: (e: TerminalExit) => void): () => void
    onAgent(cb: (info: AgentInfo) => void): () => void
  }
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<void>
  /** Real local paths for the items: archive members extracted, remote items downloaded (cached). */
  localCopies(paths: string[]): Promise<string[]>
  fileAssistant: {
    status(): Promise<AssistantStatus>
    download(): Promise<AssistantStatus>
    analyze(input: AssistantRequest): Promise<AssistantPlan>
    apply(input: AssistantApply): Promise<AssistantApplied>
    cancel(): Promise<void>
    clearTags(): Promise<void>
    pickFolder(): Promise<string | null>
    onChanged(callback: () => void): () => void
  }
  activity: {
    visit(folder: string): Promise<void>
    query(query: ActivityQuery): Promise<ActivityPage>
    note(folder: string, title: string, content: string): Promise<void>
    status(): Promise<ActivityStatus>
    check(): Promise<ActivityStatus>
    download(): Promise<ActivityStatus>
    rebuild(): Promise<void>
    clear(): Promise<void>
    export(query: ActivityQuery): Promise<boolean>
    onChanged(cb: () => void): () => void
  }
  automations: {
    list(): Promise<Automation[]>
    generate(description: string, cwd: string, language: string): Promise<AutomationProposal>
    save(id: string | null, draft: AutomationDraft): Promise<string>
    enable(id: string, enabled: boolean): Promise<void>
    run(id: string): Promise<void>
    cancel(id: string): Promise<void>
    remove(id: string): Promise<void>
    onChanged(cb: () => void): () => void
  }
  ai: {
    /** New names for the items from Claude Code (print mode, no tools – it sees only the names). */
    suggestNames(items: { name: string; isDir: boolean }[], hint: string, language: string): Promise<string[]>
  }
  /** Another window changed the settings (theme, favorites, …); carries all of them. */
  onSettingsChanged(cb: (settings: Settings) => void): () => void
  /** Git status of the folder's repository, limited to the folder; null outside a repository or without git. */
  gitStatus(path: string): Promise<GitStatus | null>
  /** The file's committed (HEAD) version; null outside a repository, for ignored files or without git. */
  gitFile(path: string): Promise<GitFile | null>
  /** Last commit of each line of the file; null outside a repository, for untracked files or without git. */
  gitBlame(path: string): Promise<GitBlame | null>
  /** The repository containing the folder, for the source control area; null outside one or without git. */
  gitRepo(path: string): Promise<RepoState | null>
  /** Runs a source control action in the folder's repository; resolves with git's output. */
  gitAction(path: string, action: GitAction): Promise<string>
  /** Both versions of a changed file in the folder's repository, for the diff view. */
  gitDiff(path: string, source: DiffSource): Promise<FileDiff>
  /** Commits of one branch, or of all branches when ref is null, newest first in topological order. */
  gitGraph(path: string, ref: string | null, limit: number): Promise<GraphCommit[]>
  /** Message, author and changed files of a commit. */
  gitCommit(path: string, hash: string): Promise<CommitDetails>
  /** Looks for a newer version now and tells the user the result in a dialog. */
  checkForUpdates(): Promise<void>
  /** "What's new": notes bundled with this build; `pending` is true once after an update. */
  releaseNotes: {
    list(): Promise<ReleaseNote[]>
    pending(): Promise<boolean>
  }
  /** aFinder as the system's file manager (opens folders from other apps); `supported` only in the installed app. */
  defaultApp: {
    status(): Promise<{ supported: boolean; isDefault: boolean }>
    /** Takes over (or gives back to Finder / Explorer / the desktop's file manager); resolves to the new state. */
    set(on: boolean): Promise<boolean>
  }
  /** Mac App Store build: folders the sandbox lets aFinder into (empty elsewhere), asking for one, removing one. */
  diskAccess: { list(): Promise<string[]>; grant(suggested?: string): Promise<string | null>; revoke(path: string): Promise<void> }
  tools: {
    /** Long jobs run in a worker; `id` (from the caller) names the job for progress and cancel. */
    hash(id: string, path: string): Promise<FileHashes>
    duplicates(id: string, dir: string): Promise<DuplicateGroup[]>
    diskTree(id: string, dir: string): Promise<DiskNode>
    cancel(id: string): void
    onProgress(callback: (id: string, progress: ToolsProgress) => void): () => void
    /** CNB exchange rates (cached for an hour). */
    rates(): Promise<Rates>
    /** PNG bytes of an image the renderer cannot decode itself (e.g. HEIC on macOS). */
    decodeImage(path: string): Promise<Uint8Array>
    /** Saves image bytes into dir under a free name; returns the new file's path. */
    saveImage(dir: string, name: string, data: Uint8Array): Promise<string>
    pick(kind: 'file' | 'folder' | 'image', multiple?: boolean): Promise<string[]>
    clipboard(): Promise<ClipboardEntry[]>
    clearClipboard(): Promise<void>
    onClipboard(callback: (entries: ClipboardEntry[]) => void): () => void
  }
  /** The Task Manager tool: readings from a worker, polled while the tool is visible. */
  sys: {
    sample(): Promise<SysSample>
    processes(): Promise<SysProcess[]>
    sensors(): Promise<SysSensors>
    info(): Promise<SysInfo>
    /** Ends a process (SIGTERM, or SIGKILL when forced; Windows terminates either way). */
    kill(pid: number, force: boolean): Promise<void>
  }
  /** The Docker area: the engine API over its local socket, see src/main/services/docker.ts. */
  docker: {
    status(): Promise<DockerStatus>
    startDesktop(): Promise<void>
    containers(): Promise<DockerContainer[]>
    /** CPU and memory of the running containers. */
    usage(): Promise<DockerUsage[]>
    action(id: string, action: ContainerAction): Promise<void>
    inspect(id: string): Promise<DockerInspect>
    /** Opens a shell in the container as a console session; returns the session id. */
    shell(id: string, cols: number, rows: number): Promise<string>
    images(): Promise<DockerImage[]>
    removeImage(id: string, force: boolean): Promise<void>
    /** Starts pulling; progress and the end come through onStream with the returned id. */
    pull(image: string): Promise<string>
    volumes(): Promise<DockerVolume[]>
    removeVolume(name: string): Promise<void>
    networks(): Promise<DockerNetwork[]>
    removeNetwork(id: string): Promise<void>
    diskUsage(): Promise<DockerDiskUsage>
    /** Bytes freed. */
    prune(kind: DockerPruneKind): Promise<number>
    /** Runs `docker compose` on a project; resolves with its output. */
    compose(project: string, action: ComposeAction): Promise<string>
    /** The compose file in a folder, or null. */
    composeFile(folder: string): Promise<string | null>
    composeUp(folder: string): Promise<string>
    /** Streams (ids for onStream and stop): logs from the last `tail` lines (0 = all), stats, engine events. */
    logs(id: string, tail: number, timestamps: boolean): Promise<string>
    stats(id: string): Promise<string>
    events(): Promise<string>
    stop(streamId: string): void
    onStream(callback: (event: DockerStreamEvent) => void): () => void
    /** Asks where to save and writes the text; false when cancelled. */
    saveLogs(name: string, text: string): Promise<boolean>
    openPort(port: number): Promise<void>
  }
  /** The Doom add-on in the Games panel: downloaded only on request, see src/shared/doom.ts. */
  doom: {
    status(): Promise<DoomStatus>
    download(): Promise<DoomStatus>
    cancel(): Promise<void>
    remove(): Promise<DoomStatus>
    onChanged(callback: (status: DoomStatus) => void): () => void
  }
  feedback: {
    /** Sends the report to the feedback service; rejects with a readable message. */
    send(draft: FeedbackDraft): Promise<void>
  }
  /** CPU, memory, uptime and the disk of the folder. */
  systemInfo(path: string): Promise<SystemInfo>
  /** Bitcoin price in USD (cached for a few minutes); null when offline. */
  btcPrice(): Promise<BtcQuote | null>
  /** Prices and changes of the symbols (cached for a few minutes); unknown ones are left out. */
  stockQuotes(symbols: string[]): Promise<StockQuote[]>
  /** Symbols matching a company name or ticker. */
  stockSearch(query: string): Promise<StockMatch[]>
  /** Takes a screenshot into the folder (or Pictures); null when cancelled. */
  screenshot(folder: string | null, mode: ScreenshotMode): Promise<ScreenshotResult | null>
  /** Puts the image file on the clipboard as a picture. */
  copyImage(path: string): Promise<void>
  recents: {
    list(): Promise<(RecentFile & { kind: FileKind })[]>
    forget(path: string): Promise<void>
    clear(): Promise<void>
    onChanged(cb: () => void): () => void
  }
  /** The Todo area's list and the notes pinned to files, shared by every window. */
  todos: {
    list(): Promise<Todo[]>
    /** Adds the item or replaces the one with the same id. */
    save(todo: Todo): Promise<void>
    remove(id: string): Promise<void>
    clearDone(): Promise<void>
    notes(): Promise<Note[]>
    /** Sets the note of a file or folder; an empty text removes it. */
    saveNote(path: string, text: string): Promise<void>
    /** To-dos or notes changed. */
    onChanged(cb: () => void): () => void
  }

  preview: {
    /** Word document converted to HTML (no scripts; render it sandboxed anyway). */
    docx(path: string): Promise<string>
    sheet(path: string, index?: number): Promise<SheetPreview>
    /** OS thumbnail as a data URL (macOS and Windows), or null. */
    thumbnail(path: string, size: number): Promise<string | null>
    /** Writes edited text; rejects if the file changed since `modified` unless force. Returns the new mtime. */
    save(path: string, text: string, modified: number, bom: boolean, force?: boolean): Promise<number>
    /**
     * Writes an edited image: in place (rejects if changed since `modified` unless force), or with copy
     * next to it as `name (edited).ext`. Returns where it went and its mtime.
     */
    saveImage(path: string, data: Uint8Array, opts: { modified?: number; force?: boolean; copy?: boolean }): Promise<{ path: string; modified: number }>
  }
  mcp: {
    /** Server state and the bearer token agents need. */
    info(): Promise<McpStatus & { token: string }>
    /** Replaces the token; agents configured with the old one stop working. */
    newToken(): Promise<McpStatus & { token: string }>
    /** The focused tab tells the main process what it shows. */
    reportView(view: McpView): void
    /** An agent asked to show a folder. */
    onOpen(cb: (path: string) => void): () => void
  }
  companion: {
    status(): Promise<CompanionStatus>
    /** Shows a new pairing QR code or link (valid for a few minutes). */
    pair(kind: DeviceKind): Promise<CompanionStatus>
    cancelPair(): Promise<void>
    /** Confirms or refuses the phone waiting in `request`. */
    answer(accept: boolean): Promise<void>
    setWrite(id: string, write: boolean): Promise<void>
    setScreen(id: string, screen: boolean): Promise<void>
    setControl(id: string, control: boolean): Promise<void>
    /** Ends the screen session that is running. */
    stopScreen(): Promise<void>
    remove(id: string): Promise<void>
    onChanged(cb: (status: CompanionStatus) => void): () => void
  }
  tail: {
    /** Starts following a local file (last 64 KB, then appends) or reading a device / FIFO. */
    start(path: string): Promise<TailInfo>
    stop(id: string): void
    onData(cb: (chunk: TailChunk) => void): () => void
  }
  remote: {
    /** Saved connections with their mount folders. */
    list(): Promise<RemoteMount[]>
    /** Creates (empty id) or updates a connection; empty secrets keep the saved ones. Returns the id. */
    save(connection: RemoteConnection, secrets: RemoteSecrets): Promise<string>
    remove(id: string): Promise<void>
    /** Connects with these settings and lists the root; rejects with the reason. */
    test(connection: RemoteConnection, secrets: RemoteSecrets): Promise<void>
    disconnect(id: string): Promise<void>
    /** Lets the user choose a private key file; null when cancelled. */
    pickKey(): Promise<string | null>
    /** Connections were added, changed, removed, connected or disconnected. */
    onChanged(cb: () => void): () => void
    /** Pairing with aFinder on another computer: starts from its pairing link and resolves with the code
     * both computers show; `pairWait` resolves with the new connection (to save) once the other side accepted. */
    pairStart(uri: string): Promise<{ sas: string; name: string }>
    pairWait(): Promise<RemoteConnection>
    pairCancel(): Promise<void>
    /** Opens the remote desktop window of an aFinder connection. */
    openDesktop(id: string): Promise<void>
  }
  window: {
    /** Opens another aFinder window showing the folder. */
    open(path: string): void
    minimize(): void
    toggleMaximize(): void
    close(): void
    /** Native full screen on/off – macOS hides the traffic lights there. */
    onFullScreen(cb: (on: boolean) => void): () => void
    /** Answers main's request for this window's state before it is replaced (see WindowHandover). */
    onHandover(collect: () => Omit<WindowHandover, 'output'> | null): () => void
    /** The state the window this one replaces handed over, once; null for an ordinary new window. */
    takeHandover(): Promise<WindowHandover | null>
  }
}
