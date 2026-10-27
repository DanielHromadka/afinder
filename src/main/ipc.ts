import type { AssistantRequest, AssistantApply } from '@shared/fileAssistant'
import type { DiffSource, GitAction } from '@shared/git'
import type { FileAssistantService } from './services/fileAssistantService'
import os from 'node:os'
import path from 'node:path'
import { stat, writeFile } from 'node:fs/promises'
import type { ActivityService } from './services/activityService'
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, type IpcMainInvokeEvent } from 'electron'
import dragIconPath from '../../build/drag.png?asset'
import {
  IPC,
  type ConflictPolicy,
  type FeedbackDraft,
  type McpStatus,
  type McpView,
  type Result,
  type SearchRequest,
  type TerminalProfile,
  type ThemeId,
  type ArchiveRequest,
  type TransferPlan,
  type TransferRequest,
  type WindowHandover
} from '@shared/types'
import { t, tos } from '@shared/i18n'
import type { InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipcContract'
import * as fileClipboard from './services/fileClipboard'
import * as ai from './services/ai'
import { generateAutomation } from './services/automationAi'
import type { AutomationService } from './services/automationService'
import * as remote from './services/remote'
import * as vfs from './services/vfs'
import * as files from './services/fileSystem'
import * as git from './services/git'
import * as projectRunner from './services/projectRunner'
import * as system from './services/system'
import * as preview from './services/preview'
import * as recents from './services/recents'
import * as todos from './services/todos'
import * as stocks from './services/stocks'
import * as agentSessions from './services/agentSessions'
import { AGENT_KINDS, validSessionId } from '@shared/agentSessions'
import * as screenshot from './services/screenshot'
import * as feedback from './services/feedback'
import * as tools from './services/tools'
import * as sysMonitor from './services/systemMonitor'
import * as doom from './services/doom'
import * as tail from './services/tail'
import { planArchive, planTransfer, runTransfer, type TransferControl } from './services/transfer'
import { applyLanguage } from './services/language'
import { checkForUpdates } from './services/updater'
import * as releaseNotes from './services/releaseNotes'
import { diskGrants, grantDiskAccess, revokeDiskAccess } from './services/diskAccess'
import { isMas } from './mas'
import { publicSettings, sanitizeSettings, updateState } from './services/settings'
import type { SearchService } from './services/searchService'
import type { TerminalService } from './services/terminals'
import type { SizeService } from './services/sizeService'

/** Wraps a handler so errors reach the renderer as a clean message instead of Electron's prefixed one. */
/**
 * Answers a channel of the IPC contract. The handler is typed with what the renderer's API sends and must
 * return what it promises; it still validates its arguments, since they cross a process boundary.
 */
function handle<C extends InvokeChannel>(channel: C, fn: (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<InvokeResult<C>>> => {
    try {
      return { ok: true, value: await fn(event, ...(args as InvokeArgs<C>)) }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException
  const where = e.path ? `\n${e.path}` : ''
  switch (e.code) {
    case 'EACCES':
    case 'EPERM':
      // The sandbox, not the system privacy settings, keeps the Mac App Store build out.
      return `${t('error.denied')}${where}\n\n${isMas ? t('error.deniedHintMas') : tos('error.deniedHint')}`
    case 'ENOENT':
      return `${t('error.notFound')}${where}`
    case 'ENOTDIR':
      return `${t('error.notDir')}${where}`
    case 'EEXIST':
      return `${t('error.exists')}${where}`
    case 'EBUSY':
      return `${t('error.busy')}${where}`
    default:
      return e.message ?? String(err)
  }
}

const viewId = (v: unknown): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) throw new Error(t('error.invalidId'))
  return v
}

export function registerIpc(deps: {
  sizeServiceFor(sender: Electron.WebContents): SizeService | undefined
  search: SearchService
  terminals: TerminalService
  automations: AutomationService
  activity: ActivityService
  fileAssistant: FileAssistantService
  openWindow(path: string): void
  /** Replacing a window (see WindowHandover): the old page's state arrives, the new page takes it. */
  windows: {
    handoverState(sender: Electron.WebContents, state: unknown): void
    takeHandover(sender: Electron.WebContents): WindowHandover | null
  }
  applyTheme(theme: ThemeId): void
  applyScale(scale: number): void
  companion: {
    host(): Promise<import('./services/companion').CompanionHost>
    /** Connects or disconnects after its settings changed. */
    apply(): Promise<void>
  }
  mcp: {
    info(): McpStatus & { token: string }
    newToken(): Promise<McpStatus & { token: string }>
    /** Restarts or stops the server after its settings changed. */
    apply(): Promise<unknown> | undefined
    reportView(sender: Electron.WebContents, view: McpView): void
  }
}): void {
  const audit = deps.activity
  const parentOf = (p: unknown): string | null => typeof p === 'string' && path.isAbsolute(p) ? path.dirname(p) : null
  handle(IPC.list, (_e, p: string) => files.list(p))
  handle(IPC.mkfile, async (_e, parent: string) => {
    const created = await audit.track({ action: 'create', folder: parent }, () => files.createFile(parent), (created) => ({ paths: [created], count: 1 }))
    void recents.touch(created, 'created')
    return created
  })
  handle(IPC.mkdir, (_e, parent: string) => audit.track({ action: 'create', folder: parent }, () => files.createFolder(parent), (created) => ({ paths: [created], count: 1 })))
  handle(IPC.rename, (_e, p: string, name: string) => audit.track({ action: 'rename', folder: parentOf(p), paths: [p] }, () => files.rename(p, name), (to) => ({ destinations: [to] })))
  handle(IPC.renameMany, (_e, items: unknown) => audit.track({ action: 'rename', paths: Array.isArray(items) ? items.map((i) => i?.path) : [] }, () => files.renameMany(items), (to) => ({ destinations: to })))
  handle(IPC.trash, (e, paths: string[]) => audit.track({ action: 'trash', paths }, () => files.trash(paths, BrowserWindow.fromWebContents(e.sender))))
  handle(IPC.open, async (_e, p: string) => {
    await audit.track({ action: 'open', folder: parentOf(p), paths: [p] }, () => files.open(p))
    void recents.touch(p, 'opened')
  })
  handle(IPC.reveal, (_e, p: string) => files.reveal(p))
  handle(IPC.terminal, (_e, p: string) => audit.track({ action: 'terminal', folder: p, outcome: 'started', label: 'system' }, () => files.openTerminal(p)))
  handle(IPC.places, () => files.places())
  handle(IPC.copyText, (_e, text: string) => clipboard.writeText(String(text)))
  handle(IPC.readText, () => clipboard.readText())
  handle(IPC.gitStatus, (_e, p: string) => git.status(p))
  handle(IPC.gitFile, (_e, p: string) => git.file(p))
  handle(IPC.gitBlame, (_e, p: string) => git.blame(p))
  handle(IPC.gitRepo, (_e, p: string) => git.repo(p))
  handle(IPC.gitAction, (_e, p: string, action: GitAction) => git.action(p, action))
  handle(IPC.gitDiff, (_e, p: string, source: DiffSource) => git.diff(p, source))
  handle(IPC.gitGraph, (_e, p: string, ref: unknown, limit: unknown) => git.graph(p, ref, limit))
  handle(IPC.gitCommit, (_e, p: string, hash: unknown) => git.commitDetails(p, hash))
  handle(IPC.checkForUpdates, () => checkForUpdates(true))
  handle(IPC.releaseNotes, () => releaseNotes.list())
  handle(IPC.releaseNotesPending, () => releaseNotes.pending())
  handle(IPC.defaultAppStatus, async () => {
    const defaultApp = await import('./services/defaultApp')
    return { supported: defaultApp.supported(), isDefault: await defaultApp.isDefault() }
  })
  handle(IPC.defaultAppSet, async (_e, on: unknown) => (await import('./services/defaultApp')).setDefault(on === true))
  handle(IPC.diskGrants, () => diskGrants())
  handle(IPC.diskGrant, (e, suggested?: unknown) => grantDiskAccess(BrowserWindow.fromWebContents(e.sender), typeof suggested === 'string' ? suggested : '/'))
  handle(IPC.diskRevoke, (_e, p: unknown) => revokeDiskAccess(String(p)))
  handle(IPC.toolsHash, (e, id: unknown, p: unknown) => tools.hashFile(e.sender, id, p))
  handle(IPC.toolsDuplicates, (e, id: unknown, dir: unknown) => tools.findDuplicates(e.sender, id, dir))
  handle(IPC.toolsDiskTree, (e, id: unknown, dir: unknown) => tools.diskTree(e.sender, id, dir))
  ipcMain.on(IPC.toolsCancel, (_e, id: unknown) => tools.cancel(id))
  handle(IPC.doomStatus, () => doom.status())
  handle(IPC.doomDownload, () => doom.download())
  handle(IPC.doomCancel, () => doom.cancel())
  handle(IPC.doomRemove, () => doom.remove())
  handle(IPC.toolsRates, () => tools.exchangeRates())
  handle(IPC.toolsDecodeImage, (_e, p: unknown) => tools.decodeImage(p))
  handle(IPC.toolsSaveImage, (_e, dir: string, name: unknown, data: unknown) =>
    audit.track({ action: 'create', folder: dir }, () => tools.saveImage(dir, name, data), (saved) => ({ paths: [saved], count: 1 }))
  )
  handle(IPC.toolsPick, (e, kind: unknown, multiple: unknown) => tools.pick(e.sender, kind, multiple))
  handle(IPC.toolsClipboard, () => tools.clipboardEntries())
  handle(IPC.toolsClipboardClear, () => tools.clearClipboardHistory())
  handle(IPC.sysSample, () => sysMonitor.sample())
  handle(IPC.sysProcesses, () => sysMonitor.processes())
  handle(IPC.sysSensors, () => sysMonitor.sensors())
  handle(IPC.sysInfo, () => sysMonitor.info())
  handle(IPC.sysKill, (_e, pid: unknown, force: unknown) => sysMonitor.kill(pid, force))

  // Docker: the service is loaded on the area's first call.
  const docker = (): Promise<typeof import('./services/docker')> => import('./services/docker')
  handle(IPC.dockerStatus, async () => (await docker()).status())
  handle(IPC.dockerStartDesktop, async () => (await docker()).startDesktop())
  handle(IPC.dockerContainers, async () => (await docker()).containers())
  handle(IPC.dockerUsage, async () => (await docker()).usage())
  handle(IPC.dockerAction, async (_e, id: unknown, action: unknown) => (await docker()).action(id, action))
  handle(IPC.dockerInspect, async (_e, id: unknown) => (await docker()).inspect(id))
  // A shell in the user's console (the docker CLI from their PATH), so it behaves like typing the command there.
  handle(IPC.dockerShell, async (e, id: unknown, cols: number, rows: number) => deps.terminals.run(e.sender, os.homedir(), (await docker()).shellCommand(id), cols, rows))
  handle(IPC.dockerImages, async () => (await docker()).images())
  handle(IPC.dockerRemoveImage, async (_e, id: unknown, force: unknown) => (await docker()).removeImage(id, force))
  handle(IPC.dockerPull, async (e, image: unknown) => (await docker()).pull(e.sender, image))
  handle(IPC.dockerVolumes, async () => (await docker()).volumes())
  handle(IPC.dockerRemoveVolume, async (_e, name: unknown) => (await docker()).removeVolume(name))
  handle(IPC.dockerNetworks, async () => (await docker()).networks())
  handle(IPC.dockerRemoveNetwork, async (_e, id: unknown) => (await docker()).removeNetwork(id))
  handle(IPC.dockerDiskUsage, async () => (await docker()).diskUsage())
  handle(IPC.dockerPrune, async (_e, kind: unknown) => (await docker()).prune(kind))
  handle(IPC.dockerCompose, async (_e, project: unknown, action: unknown) => (await docker()).compose(project, action))
  handle(IPC.dockerComposeFile, async (_e, folder: unknown) => (await docker()).composeFile(folder))
  handle(IPC.dockerComposeUp, async (_e, folder: unknown) => (await docker()).composeUp(folder))
  handle(IPC.dockerLogs, async (e, id: unknown, tail: unknown, timestamps: unknown) => (await docker()).logs(e.sender, id, tail, timestamps))
  handle(IPC.dockerStats, async (e, id: unknown) => (await docker()).stats(e.sender, id))
  handle(IPC.dockerEvents, async (e) => (await docker()).events(e.sender))
  ipcMain.on(IPC.dockerStop, (e, id: unknown) => void docker().then((d) => d.stop(e.sender, id)))
  handle(IPC.dockerSaveLogs, async (e, name: unknown, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Invalid logs.')
    const parent = BrowserWindow.fromWebContents(e.sender)
    const safe = typeof name === 'string' ? name.replace(/[^\w.-]+/g, '_').slice(0, 80) : 'container'
    const options: Electron.SaveDialogOptions = { defaultPath: `${safe}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`, filters: [{ name: 'Log', extensions: ['log', 'txt'] }] }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, text)
    return true
  })
  handle(IPC.dockerOpenPort, async (_e, port: unknown) => {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.')
    await shell.openExternal(`http://localhost:${port}`)
  })
  handle(IPC.feedbackSend, (_e, draft: FeedbackDraft) => feedback.send(draft))
  handle(IPC.systemInfo, (_e, p: string) => system.info(String(p)))
  handle(IPC.btcPrice, () => system.btcPrice())
  handle(IPC.companionStatus, async () => (await deps.companion.host()).status())
  handle(IPC.companionPair, async (_e, kind: unknown) => (await deps.companion.host()).pair(kind === 'computer' ? 'computer' : 'phone'))
  handle(IPC.companionCancelPair, async () => (await deps.companion.host()).cancelPair())
  handle(IPC.companionAnswer, async (_e, accept: unknown) => (await deps.companion.host()).answer(accept === true))
  handle(IPC.companionDevice, async (_e, id: unknown, write: unknown) => (await deps.companion.host()).setWrite(String(id), write === true))
  handle(IPC.companionScreen, async (_e, id: unknown, screen: unknown) => (await deps.companion.host()).setScreen(String(id), screen === true))
  handle(IPC.companionControl, async (_e, id: unknown, control: unknown) => (await deps.companion.host()).setControl(String(id), control === true))
  handle(IPC.companionStopScreen, async () => (await deps.companion.host()).stopScreen())
  handle(IPC.companionRemove, async (_e, id: unknown) => (await deps.companion.host()).remove(String(id)))
  handle(IPC.stockQuotes, (_e, symbols: unknown) => stocks.stockQuotes(symbols))
  handle(IPC.stockSearch, (_e, q: unknown) => stocks.stockSearch(q))
  handle(IPC.mcpInfo, () => deps.mcp.info())
  handle(IPC.mcpNewToken, () => deps.mcp.newToken())
  ipcMain.on(IPC.mcpReportView, (e, view: unknown) => {
    const v = view as Partial<McpView> | null
    if (!v || typeof v.folder !== 'string' || !Array.isArray(v.selection)) return
    deps.mcp.reportView(e.sender, { folder: v.folder, selection: v.selection.filter((p): p is string => typeof p === 'string').slice(0, 1000) })
  })
  handle(IPC.tailStart, (e, p: string) => tail.start(e.sender, p))
  ipcMain.on(IPC.tailStop, (e, id: unknown) => tail.stop(e.sender, id))
  handle(IPC.previewDocx, (_e, p: string) => preview.docxHtml(p))
  handle(IPC.previewSheet, (_e, p: string, index?: number) => preview.sheet(p, index))
  handle(IPC.previewThumbnail, (_e, p: string, size: number) => preview.thumbnail(p, size))
  handle(IPC.previewSave, async (_e, p: string, text: string, modified: number, bom: boolean, force: boolean) => {
    const saved = await audit.track({ action: 'edit', folder: parentOf(p), paths: [p] }, () => preview.saveText(p, text, modified, bom, force))
    void recents.touch(p, 'edited')
    return saved
  })
  handle(IPC.previewSaveImage, async (_e, p: string, data: Uint8Array, modified: number | undefined, force: boolean, copy: boolean) => {
    const saved = await audit.track({ action: copy ? 'create' : 'edit', folder: parentOf(p), paths: copy ? [] : [p] }, () => preview.saveImage(p, data, modified, force, copy), (saved) => ({ paths: [saved.path], count: 1 }))
    void recents.touch(saved.path, copy ? 'created' : 'edited')
    return saved
  })
  handle(IPC.screenshot, async (_e, folder: string | null, mode: unknown) => {
    const shot = await audit.track({ action: 'create', folder }, () => screenshot.capture(folder, mode), (shot) => (shot ? { paths: [shot.path], count: 1 } : { outcome: 'cancelled' }))
    if (shot) void recents.touch(shot.path, 'screenshot')
    return shot
  })
  handle(IPC.screenshotCopy, (_e, p: string) => screenshot.copyImage(p))
  handle(IPC.recents, () => recents.recent())
  handle(IPC.recentsForget, (_e, p: string) => recents.forget(p))
  handle(IPC.recentsClear, () => recents.clear())
  handle(IPC.todos, () => todos.todos())
  handle(IPC.todosSave, (_e, todo: unknown) => todos.save(todo))
  handle(IPC.todosRemove, (_e, id: unknown) => todos.remove(id))
  handle(IPC.todosClearDone, () => todos.clearDone())
  handle(IPC.notes, () => todos.allNotes())
  handle(IPC.notesSave, (_e, p: unknown, text: unknown) => todos.saveNote(p, text))

  handle(IPC.terminalProfiles, (_e, refresh?: boolean) => deps.terminals.available(refresh === true))
  handle(IPC.terminalOpen, async (e, profile: TerminalProfile, cwd: string, cols: number, rows: number, prompt: unknown) => {
    const loc = await vfs.locate(files.validatePath(cwd))
    // A shell in a folder of an SFTP connection is a shell on that server.
    const ssh = loc.kind === 'remote' && profile === 'shell' ? remote.sshTarget(loc.at) : null
    const actualCwd = ssh ? loc.path : await vfs.outsideFolder(loc.path)
    return audit.track({ action: 'terminal', folder: actualCwd, label: profile, outcome: 'started' }, () => ssh ? deps.terminals.openSsh(e.sender, ssh, cols, rows) : deps.terminals.open(e.sender, profile, actualCwd, cols, rows, typeof prompt === 'string' ? prompt : undefined))
  })
  handle(IPC.agentSessions, (_e, folder: unknown) => agentSessions.listSessions(folder))
  handle(IPC.terminalResume, async (e, agent: unknown, sessionId: unknown, cwd: string, cols: number, rows: number) => {
    const kind = AGENT_KINDS.find((k) => k === agent)
    if (!kind) throw new Error('Invalid profile.')
    if (typeof sessionId !== 'string' || !validSessionId(kind, sessionId)) throw new Error(t('error.invalidOption'))
    // Agents resume only in the folder the session ran in, so it must still exist on the local disk.
    const dir = files.validatePath(cwd)
    if ((await vfs.locate(dir)).kind !== 'local' || !(await stat(dir).then((s) => s.isDirectory(), () => false))) throw new Error(t('console.resumeMissing', { path: dir }))
    return audit.track({ action: 'terminal', folder: dir, label: kind, outcome: 'started' }, () => deps.terminals.resume(e.sender, kind, sessionId, dir, cols, rows))
  })
  // Projects run only from the local disk – a shell cannot reach into archives or remote folders.
  const runnable = async (p: string): Promise<string | null> => {
    const target = files.validatePath(p)
    return (await vfs.isVirtual(target)) ? null : target
  }
  handle(IPC.terminalTargets, async (_e, p: string) => {
    const target = await runnable(p)
    return target ? projectRunner.runTargets(target) : []
  })
  handle(IPC.terminalRun, async (e, p: string, targetId: unknown, cols: number, rows: number) => {
    const target = await runnable(p)
    if (!target || typeof targetId !== 'string') throw new Error('Invalid run command.')
    const run = await projectRunner.findTarget(target, targetId)
    const id = await audit.track({ action: 'project', folder: run.cwd, paths: [target], label: run.id, outcome: 'started' }, () => deps.terminals.run(e.sender, run.cwd, run.command, cols, rows))
    // An HTML page opens in the browser as soon as its server is up.
    const url = run.url
    if (url) void projectRunner.whenListening(Number(new URL(url).port)).then(async (up) => {
      if (up) await shell.openExternal(url)
    })
    return id
  })
  ipcMain.on(IPC.terminalWrite, (e, id: unknown, data: unknown) => {
    if (typeof id === 'string' && typeof data === 'string') deps.terminals.write(e.sender, id, data)
  })
  ipcMain.on(IPC.terminalResize, (e, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id === 'string') deps.terminals.resize(e.sender, id, Number(cols), Number(rows))
  })
  ipcMain.on(IPC.terminalClose, (e, id: unknown) => {
    if (typeof id === 'string') deps.terminals.close(e.sender, id)
  })
  handle(IPC.watchSizes, async (e, id: string, dir: string, subdirs: string[]) => {
    if (!Array.isArray(subdirs)) throw new Error(t('error.invalidFolderList'))
    const sizes = deps.sizeServiceFor(e.sender)
    // Archive folders come with their sizes and never change on their own; remote folders are not watched.
    if (await vfs.isVirtual(files.validatePath(dir))) return sizes?.unwatch(viewId(id))
    sizes?.watch(viewId(id), files.validatePath(dir), subdirs.map(files.validatePath))
  })
  ipcMain.on(IPC.unwatchSizes, (e, id: unknown) => {
    if (typeof id === 'string') deps.sizeServiceFor(e.sender)?.unwatch(id)
  })
  handle(IPC.search, async (e, id: string, req: SearchRequest) => {
    if (typeof req !== 'object' || req === null || typeof req.query !== 'string') throw new Error(t('error.invalidSearch'))
    // No subfolder search inside archives and remote folders (yet): report an empty, finished search.
    if (await vfs.isVirtual(files.validatePath(req.root))) {
      e.sender.send(IPC.searchResults, { id: viewId(id), entries: [], done: true, truncated: false })
      return
    }
    deps.search.start(e.sender, viewId(id), {
      root: files.validatePath(req.root),
      query: req.query.slice(0, 200),
      fuzzy: req.fuzzy === true,
      showHidden: req.showHidden === true
    })
  })
  ipcMain.on(IPC.cancelSearch, (e, id: unknown) => {
    if (typeof id === 'string') deps.search.cancel(e.sender, id)
  })
  handle(IPC.clipboardWriteFiles, async (_e, paths: string[], cut: boolean) => {
    // Other apps need real files: archive members and remote items go to the clipboard as local copies.
    const real = Array.isArray(paths) ? await Promise.all(paths.map((p) => vfs.realPath(files.validatePath(p)))) : paths
    return fileClipboard.writeFiles(real, cut === true)
  })
  handle(IPC.clipboardReadFiles, () => fileClipboard.readFiles())

  // One transfer at a time per window; the renderer shows a modal progress dialog meanwhile.
  const transfers = new Map<number, TransferControl>()
  handle(IPC.planTransfer, (_e, req: TransferRequest) => planTransfer(req))
  handle(IPC.runTransfer, async (e, plan: TransferPlan, policy: ConflictPolicy) => {
    if (transfers.has(e.sender.id)) throw new Error(t('error.transferRunning'))
    const control: TransferControl = { cancelled: false }
    transfers.set(e.sender.id, control)
    try {
      const created = await audit.track({ action: plan.mode, folder: plan.dest, paths: plan.sources, destinations: [plan.dest] }, () => runTransfer(plan, policy, control, (p) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.transferProgress, p)
      }), (created) => ({ destinations: created, count: created.length, outcome: control.cancelled ? 'cancelled' : 'success' }))
      // Only what actually moved stops being "cut"; an auto batch may have copied some items.
      const moved = plan.sources.filter((_, i) => plan.modes?.[i] === 'move')
      if (moved.length) fileClipboard.forgetCut(moved)
      return created
    } finally {
      transfers.delete(e.sender.id)
    }
  })
  // Shares the transfer slot: same progress dialog, same cancel button.
  handle(IPC.createArchive, async (e, req: ArchiveRequest) => {
    if (transfers.has(e.sender.id)) throw new Error(t('error.transferRunning'))
    const control: TransferControl = { cancelled: false }
    transfers.set(e.sender.id, control)
    try {
      const job = await planArchive(req)
      const { writeArchive } = await import('./services/archiveWriter')
      return await audit.track({ action: 'archive', folder: path.dirname(job.target), paths: job.sources, destinations: [job.target] }, async () => {
        const written = await writeArchive(job, control, (p) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.transferProgress, p)
        })
        return written ? job.target : null
      }, (out) => ({ destinations: out ? [out] : [], count: out ? 1 : 0, outcome: out ? 'success' : 'cancelled' }))
    } finally {
      transfers.delete(e.sender.id)
    }
  })
  ipcMain.on(IPC.cancelTransfer, (e) => {
    const control = transfers.get(e.sender.id)
    if (control) control.cancelled = true
  })

  const dragIcon = nativeImage.createFromPath(dragIconPath).resize({ width: 48, height: 48 })
  ipcMain.on(IPC.startDrag, async (e, paths: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0) return
    try {
      const valid = await Promise.all(paths.map((p) => vfs.realPath(files.validatePath(p))))
      e.sender.startDrag({ file: valid[0], files: valid, icon: dragIcon })
    } catch {
      // invalid path from the renderer – ignore the drag
    }
  })

  handle(IPC.assistantStatus, () => deps.fileAssistant.status())
  handle(IPC.assistantDownload, (e) => deps.fileAssistant.download(e.sender.id))
  handle(IPC.assistantAnalyze, (e, input: AssistantRequest) => deps.fileAssistant.analyze(e.sender.id, input))
  handle(IPC.assistantApply, (e, input: AssistantApply) => deps.fileAssistant.apply(e.sender.id, input))
  handle(IPC.assistantCancel, (e) => deps.fileAssistant.cancel(e.sender.id))
  handle(IPC.assistantClearTags, () => deps.fileAssistant.clearTags())
  handle(IPC.assistantPickFolder, async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  handle(IPC.activityVisit, (e, folder: unknown) => audit.visit(files.validatePath(folder), e.sender.id))
  handle(IPC.activityQuery, (_e, query: unknown) => audit.query(query))
  handle(IPC.activityNote, (_e, folder: unknown, title: unknown, content: unknown) => audit.note(files.validatePath(folder), title, content))
  handle(IPC.activityStatus, () => audit.status())
  handle(IPC.activityCheck, () => audit.check())
  handle(IPC.activityDownload, () => audit.download())
  handle(IPC.activityRebuild, () => audit.rebuild())
  handle(IPC.activityClear, () => audit.clear())
  handle(IPC.activityExport, async (e, query: unknown) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.SaveDialogOptions = { defaultPath: `afinder-activity-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, audit.export(query), { mode: 0o600 })
    return true
  })

  handle(IPC.automationList, () => deps.automations.list())
  handle(IPC.automationGenerate, (_e, description: unknown, cwd: unknown, language: unknown) => generateAutomation(description, files.validatePath(cwd), language))
  handle(IPC.automationSave, (_e, id: unknown, draft: unknown) => deps.automations.save(id, draft))
  handle(IPC.automationEnable, (_e, id: unknown, enabled: unknown) => deps.automations.enable(id, enabled))
  handle(IPC.automationRun, (_e, id: unknown) => deps.automations.run(id))
  handle(IPC.automationCancel, (_e, id: unknown) => deps.automations.cancel(id))
  handle(IPC.automationRemove, (_e, id: unknown) => deps.automations.remove(id))

  handle(IPC.aiSuggestNames, (_e, items: unknown, hint: unknown, language: unknown) => ai.suggestNames(items, hint, language))
  handle(IPC.localCopies, async (_e, paths: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) throw new Error(t('error.invalidList'))
    return Promise.all(paths.map((p) => vfs.realPath(files.validatePath(p))))
  })

  handle(IPC.remoteList, () => remote.mounts())
  handle(IPC.remoteSave, (_e, connection: unknown, secrets: unknown) => remote.save(connection, secrets))
  handle(IPC.remoteRemove, (_e, id: unknown) => remote.remove(id))
  handle(IPC.remoteTest, (_e, connection: unknown, secrets: unknown) => remote.test(connection, secrets))
  handle(IPC.remoteDisconnect, (_e, id: unknown) => remote.disconnect(String(id)))
  handle(IPC.remotePairStart, (_e, uri: unknown) => remote.pairComputerStart(uri))
  handle(IPC.remotePairWait, () => remote.pairComputerWait())
  handle(IPC.remotePairCancel, () => remote.pairComputerCancel())
  handle(IPC.remoteDesktopOpen, async (_e, id: unknown) => (await import('./services/remoteDesktop')).open(String(id)))
  handle(IPC.remotePickKey, async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openFile', 'showHiddenFiles'], defaultPath: `${os.homedir()}/.ssh` }
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  handle(IPC.getSettings, () => publicSettings())
  handle(IPC.setSettings, async (e, patch: unknown) => {
    const clean = sanitizeSettings(patch)
    // The change applies in any case; a failed save is reported after it, so the user knows it will not last.
    const saveError = updateState(clean)
    if ('fileAssistantEnabled' in clean || 'fileAssistantReadContent' in clean) deps.fileAssistant.configure(publicSettings())
    if ('activityEnabled' in clean || 'semanticEnabled' in clean || 'activityRetentionDays' in clean) audit.configure(publicSettings())
    if (clean.language) applyLanguage()
    if (clean.theme) deps.applyTheme(clean.theme)
    if (clean.uiScale) deps.applyScale(clean.uiScale)
    if ('mcpEnabled' in clean) await deps.mcp.apply()
    if ('companionEnabled' in clean || 'computersEnabled' in clean || 'companionRelay' in clean) await deps.companion.apply()
    if ('clipboardHistory' in clean) tools.setClipboardHistory(clean.clipboardHistory === true)
    if (clean.recentFiles === false) recents.clear() // turning it off forgets what was kept
    // The other windows follow (theme, language, favorites, …). The layout and the last folder are
    // per window and not worth waking them for.
    if (Object.keys(clean).some((k) => k !== 'layout' && k !== 'lastPath')) {
      const all = publicSettings()
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.webContents !== e.sender && !w.webContents.isDestroyed()) w.webContents.send(IPC.settingsChanged, all)
      }
    }
    if (saveError) throw new Error(t('error.settingsNotSaved', { reason: describeError(saveError) }))
  })

  const win = (e: Electron.IpcMainEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)
  ipcMain.on(IPC.winNew, (_e, p: unknown) => {
    try {
      deps.openWindow(files.validatePath(p))
    } catch {
      // invalid path – ignore
    }
  })
  ipcMain.on(IPC.winMinimize, (e) => win(e)?.minimize())
  ipcMain.on(IPC.winToggleMaximize, (e) => {
    const w = win(e)
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on(IPC.winClose, (e) => win(e)?.close())
  // Answered straight from the preload (no Result wrapper): the page has nothing to do with the reply.
  ipcMain.handle(IPC.winHandoverState, (e, state: unknown) => deps.windows.handoverState(e.sender, state))
  handle(IPC.winTakeHandover, (e) => deps.windows.takeHandover(e.sender))
}
