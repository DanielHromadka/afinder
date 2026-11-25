import { ASSISTANT_MODES } from '@shared/fileAssistant'
import { plural, t, tos } from '@shared/i18n'
import { isBrowsableArchive } from '@shared/archive'
import { dirOf } from '@shared/paths'
import { AUDIO_TARGETS, convertKind, convertTargets } from '@shared/convert'
import { canStripMetadata } from '@shared/exif'
import { canEditImage } from '@shared/imageEdit'
import { TURNS } from '@shared/orientation'
import { previewKind } from '@shared/preview'
import { canCutVideo } from '@shared/videoCut'
import type { FileEntry, RunTarget } from '@shared/types'
import { keys } from '@renderer/lib/keys'
import { folderLabel } from '@renderer/lib/places'
import { convertJob, extractJob, mergeJob, stripJob, turnJob } from '@renderer/lib/mediaJobs'
import type { MenuItem } from '../ContextMenu'
import type { TabContext } from './actions'

// The context menu of a file list: on an item (with the selection it belongs to) or on the empty space.

export const favoriteOf = (e: FileEntry): { path: string; isDir: boolean; kind: FileEntry['kind'] } => ({ path: e.path, isDir: e.isDir, kind: e.kind })

/** The right-clicked item, or the whole selection when it is part of it. */
export const targetsOf = (ctx: TabContext, entry: FileEntry): FileEntry[] => (ctx.selection.has(entry.path) && ctx.selectedEntries.length > 0 ? ctx.selectedEntries : [entry])

/** Ask, summarize, describe and rename with the AI agent; nothing for remote folders (they would be downloaded whole). */
export function aiMenuItems(ctx: TabContext, entry: FileEntry | null): MenuItem[] {
  const items = entry ? targetsOf(ctx, entry) : ctx.path ? [{ path: ctx.path, name: folderLabel(ctx.path), isDir: true }] : []
  if (items.length === 0 || !ctx.aiCanUse(items)) return []
  if (!ctx.aiAgent) return ['separator', { label: t('ai.notInstalled'), icon: 'ai', disabled: true, onClick: () => {} }]
  const entries = entry ? targetsOf(ctx, entry) : []
  return [
    'separator',
    { label: t('ai.ask'), icon: 'ai', onClick: () => ctx.askAi(items) },
    { label: t(items.length === 1 && items[0].isDir ? 'ai.describeFolder' : 'ai.summarize'), onClick: () => ctx.summarizeAi(items) },
    ...(entries.length > 0 && ctx.consoleProfiles?.claude && !ctx.listing?.readOnly ? [{ label: t('ai.rename'), onClick: () => ctx.aiRename(entries) }] : [])
  ]
}

export function buildContextMenu(
  ctx: TabContext,
  entry: FileEntry | null,
  info: { clip: { paths: string[]; cut: boolean }; runTargets: RunTarget[]; x: number; y: number }
): MenuItem[] {
  const { clip, runTargets } = info
  const { path, settings, selection, selectedEntries, listing } = ctx
  const runPath = entry ? entry.path : path
  const pasteItem: MenuItem = {
    label: t(clip.cut ? 'action.pasteMove' : 'action.paste'),
    shortcut: keys.label('paste'),
    disabled: clip.paths.length === 0,
    onClick: () => (entry?.isDir ? ctx.pasteInto(entry.path) : ctx.paste())
  }
  // The AI agents; the integrated shell is the "Open in Terminal" item above.
  const consoleItems = (cwd: string): MenuItem[] => {
    const profiles = ctx.consoleProfiles
    if (!profiles) return []
    const items: MenuItem[] = [
      ...(profiles.claude ? [{ label: t('console.openClaude'), onClick: () => ctx.openConsole('claude', cwd) }] : []),
      ...(profiles.codex ? [{ label: t('console.openCodex'), onClick: () => ctx.openConsole('codex', cwd) }] : []),
      ...(profiles.opencode ? [{ label: t('console.openOpencode'), onClick: () => ctx.openConsole('opencode', cwd) }] : []),
      ...(ctx.canInsertIntoConsole && entry
        ? [{ label: t('console.insertPaths'), onClick: () => ctx.insertIntoConsole(selection.has(entry.path) ? selectedEntries.map((x) => x.path) : [entry.path]) }]
        : [])
    ]
    return items.length ? ['separator', ...items] : []
  }
  // Running the project: the clicked Python file directly, the project's scripts in a submenu.
  const runItems = (): MenuItem[] => {
    if (!runPath || runTargets.length === 0) return []
    const run = (target: RunTarget): MenuItem => ({ label: target.command, title: target.cwd, onClick: () => ctx.runInConsole(runPath, target) })
    const fileTarget = runTargets.find((x) => x.file)
    const project = runTargets.filter((x) => !x.file)
    // Node, Python and web servers, separated.
    const groups = (['node', 'python', 'web'] as const).map((kind) => project.filter((x) => x.kind === kind).map(run)).filter((g) => g.length)
    const fileLabel = fileTarget?.kind === 'web' ? t('run.openInBrowser') : t('run.file', { name: entry?.name ?? '' })
    return [
      'separator',
      ...(fileTarget ? [{ label: fileLabel, icon: 'terminal' as const, title: fileTarget.command, onClick: () => ctx.runInConsole(runPath, fileTarget) }] : []),
      ...(groups.length ? [{ label: t('run.project'), icon: 'terminal' as const, items: groups.flatMap((g, i): MenuItem[] => (i ? ['separator', ...g] : g)) }] : [])
    ]
  }
  const otherPaneItems: MenuItem[] =
    ctx.paneCount > 1 && ctx.otherPath
      ? [
          'separator',
          { label: t('action.copyToPane'), shortcut: keys.label('copyToPane'), onClick: () => ctx.toOtherPane('copy') },
          { label: t('action.moveToPane'), shortcut: keys.label('moveToPane'), onClick: () => ctx.toOtherPane('move') }
        ]
      : []
  const slideshowItems = (e: FileEntry): MenuItem[] => {
    const show = ctx.slideshowOf(e)
    const picked = selection.has(e.path) && selectedEntries.filter((x) => !x.isDir && previewKind(x.name) === 'image').length > 1
    return show && (picked || (!e.isDir && previewKind(e.name) === 'image'))
      ? [{ label: picked ? plural('slideshow.playSelected', show.images.length, { n: show.images.length }) : t('slideshow.playFolder', { n: show.images.length }), icon: 'image', onClick: () => ctx.playSlideshow(show) }]
      : []
  }
  // The image editor or video cutter, for one file the editor can open in a writable folder.
  const editItems = (e: FileEntry): MenuItem[] => {
    const single = !selection.has(e.path) || selection.size <= 1
    const kind = previewKind(e.name)
    const editable = (kind === 'image' && canEditImage(e.name)) || (kind === 'video' && canCutVideo(e.name))
    return single && editable && !e.isDir && !listing?.readOnly ? [{ label: t('preview.edit'), icon: kind, onClick: () => ctx.editInQuickLook(e) }] : []
  }
  // Images and videos to another format; only for a selection of one kind, and not in read-only listings.
  const convertItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    const offer = !listing?.readOnly && targets.every((x) => !x.isDir) ? convertTargets(targets.map((x) => x.name)) : null
    if (!offer) return []
    return [{ label: t('convert.menu'), icon: offer.kind === 'image' ? 'image' : 'video', items: offer.targets.map((ext) => ({ label: t(`convert.format.${ext}`), onClick: () => ctx.startJob(convertJob(targets, offer.kind, ext)) })) }]
  }
  // Smaller copies of photos (or the photos themselves made smaller); any image the converter can read.
  const resizeItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    if (listing?.readOnly || !targets.every((x) => !x.isDir && convertKind(x.name) === 'image')) return []
    return [{ label: t('resize.menu'), icon: 'image', onClick: () => ctx.resizeImages(targets) }]
  }
  // Turning and mirroring photos in place (JPEG losslessly).
  const turnItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    if (listing?.readOnly || !targets.every((x) => !x.isDir && canStripMetadata(x.name))) return []
    return [{ label: t('turn.menu'), icon: 'image', items: TURNS.map((turn): MenuItem => ({ label: t(`turn.${turn}`), onClick: () => ctx.startJob(turnJob(targets, turn)) })) }]
  }
  // What can be made of videos: a GIF of a stretch of one, their sound alone, several joined into one.
  const videoItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    if (listing?.readOnly || !targets.every((x) => !x.isDir && convertKind(x.name) === 'video')) return []
    return [
      ...(targets.length === 1 ? [{ label: t('gif.menu'), icon: 'video' as const, onClick: () => ctx.makeGif(e) }] : []),
      { label: t('extract.menu'), icon: 'audio', items: AUDIO_TARGETS.map((ext): MenuItem => ({ label: t(`extract.format.${ext}`), onClick: () => ctx.startJob(extractJob(targets, ext)) })) },
      ...(targets.length > 1 ? [{ label: t('merge.menu', { n: targets.length }), icon: 'video' as const, onClick: () => ctx.startJob(mergeJob(targets)) }] : [])
    ]
  }
  // Several photos or videos: a contact sheet of them.
  const sheetItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    if (listing?.readOnly || targets.length < 2 || !targets.every((x) => !x.isDir && convertKind(x.name) !== null)) return []
    return [{ label: t('contact.menu'), icon: 'image', onClick: () => ctx.contactSheet(targets) }]
  }
  // Speech to text, when turned on in Settings.
  const transcribeItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    if (!settings.transcribeEnabled || listing?.readOnly || !targets.every((x) => !x.isDir && (previewKind(x.name) === 'audio' || previewKind(x.name) === 'video'))) return []
    return [{ label: t('transcribe.menu'), icon: 'text', onClick: () => ctx.transcribe(targets) }]
  }
  // Exactly two images: compare them.
  const compareItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    if (targets.length !== 2 || !targets.every((x) => !x.isDir && convertKind(x.name) === 'image')) return []
    return [{ label: t('compare.menu'), icon: 'image', onClick: () => ctx.compareImages([targets[0], targets[1]]) }]
  }
  // Removing the location or all metadata from photos, in place; only for JPEG, PNG and WebP.
  const metadataItems = (e: FileEntry): MenuItem[] => {
    const targets = targetsOf(ctx, e)
    if (listing?.readOnly || !targets.every((x) => !x.isDir && canStripMetadata(x.name))) return []
    return [
      {
        label: t('strip.menu'),
        icon: 'image',
        items: [
          { label: t('strip.gps'), onClick: () => ctx.startJob(stripJob(targets, 'gps')) },
          { label: t('strip.all'), onClick: () => ctx.startJob(stripJob(targets, 'all')) }
        ]
      }
    ]
  }
  // One item opens as a double click would; several open side by side: folders in new tabs, files in their apps.
  const openTargets = (e: FileEntry): void => {
    const targets = targetsOf(ctx, e)
    if (targets.length === 1) return ctx.openEntry(e)
    for (const x of targets) {
      if (x.isDir) ctx.openInNewTab(x.path)
      else ctx.openExternal(x.path)
    }
  }
  const items: MenuItem[] = entry
    ? [
        { label: t('action.open'), icon: 'open', bold: true, shortcut: keys.isMac ? keys.label('open') : 'Enter', onClick: () => openTargets(entry) },
        {
          label: t('action.quickLook'),
          shortcut: keys.label('quickLook'),
          onClick: () => {
            // Keeps the selection; Quick Look starts on the clicked item.
            ctx.select(selection.has(entry.path) ? [...selection] : [entry.path], entry.path)
            ctx.setQuickLook(true)
          }
        },
        ...editItems(entry),
        ...slideshowItems(entry),
        ...(!entry.isDir && !listing?.readOnly ? [{ label: t('action.tail'), icon: 'console' as const, onClick: () => ctx.startTail(entry) }] : []),
        ...(entry.isDir
          ? [
              { label: t('action.openInNewTab'), onClick: () => ctx.openInNewTab(entry.path) },
              { label: t('action.openInNewWindow'), onClick: () => ctx.openWindow(entry.path) }
            ]
          : []),
        ...(!entry.isDir && isBrowsableArchive(entry.name) ? [{ label: t('action.openExternal'), onClick: () => ctx.openExternal(entry.path) }] : []),
        ...(ctx.searchMode ? [{ label: t('action.showInParent'), onClick: () => ctx.navigate(dirOf(entry.path), 'push', entry.path) }] : []),
        { label: tos('action.terminal'), icon: 'terminal', onClick: () => ctx.openTerminal(entry.isDir ? entry.path : dirOf(entry.path)) },
        { label: t('action.systemTerminal'), onClick: () => ctx.openSystemTerminal(entry.isDir ? entry.path : dirOf(entry.path)) },
        { label: tos('action.reveal'), icon: 'reveal', onClick: () => ctx.reveal(entry.path) },
        ctx.favoriteItem(favoriteOf(entry)),
        { label: t('action.addTodo'), icon: 'todo', onClick: () => targetsOf(ctx, entry).forEach((x) => ctx.addTodo({ path: x.path, isDir: x.isDir })) },
        { label: t('action.editNote'), icon: 'note', onClick: () => ctx.editNote(entry, info.x, info.y) },
        ...runItems(),
        ...consoleItems(entry.isDir ? entry.path : dirOf(entry.path)),
        ...aiMenuItems(ctx, entry),
        'separator',
        { label: t('action.cut'), shortcut: keys.label('cut'), onClick: () => ctx.copySelection(true) },
        { label: t('action.copy'), icon: 'copy', shortcut: keys.label('copy'), onClick: () => ctx.copySelection(false) },
        ...(entry.isDir ? [pasteItem] : []),
        { label: t('action.duplicate'), shortcut: keys.label('duplicate'), onClick: ctx.duplicate },
        ...(ctx.canArchive ? [{ label: t('action.compress'), icon: 'archive' as const, onClick: () => ctx.openArchive(selection.has(entry.path) ? selectedEntries : [entry]) }] : []),
        ...compareItems(entry),
        ...sheetItems(entry),
        ...convertItems(entry),
        ...resizeItems(entry),
        ...turnItems(entry),
        ...videoItems(entry),
        ...transcribeItems(entry),
        ...metadataItems(entry),
        ...otherPaneItems,
        'separator',
        selection.has(entry.path) && selection.size > 1
          ? { label: t('action.renameMany', { n: selection.size }), icon: 'rename', shortcut: keys.label('rename'), onClick: () => ctx.openBatch(selectedEntries) }
          : { label: t('action.rename'), icon: 'rename', shortcut: keys.label('rename'), onClick: () => ctx.renameOne(entry.path) },
        { label: tos('action.trash'), icon: 'trash', shortcut: keys.label('trash'), onClick: ctx.trashSelected },
        'separator',
        { label: t('action.copyPath'), shortcut: keys.label('copyPath'), onClick: ctx.copyPath }
      ]
    : [
        { label: t('action.newFolder'), icon: 'newFolder', shortcut: keys.label('newFolder'), onClick: ctx.newFolder },
        { label: t('action.newFile'), icon: 'newFile', onClick: ctx.newFile },
        { label: tos('action.terminal'), icon: 'terminal', shortcut: keys.label('terminal'), onClick: () => ctx.openTerminal() },
        ...(path ? [{ label: t('action.systemTerminal'), onClick: () => ctx.openSystemTerminal(path) }] : []),
        ...runItems(),
        ...(path ? consoleItems(path) : []),
        ...aiMenuItems(ctx, null),
        ...(path ? [ctx.favoriteItem({ path, isDir: true, kind: 'folder' })] : []),
        'separator',
        pasteItem,
        ...(ctx.canArchive ? [{ label: t('action.compressFolder'), icon: 'archive' as const, onClick: () => ctx.openArchive(null) }] : []),
        'separator',
        { label: t(settings.showHidden ? 'action.hideHidden' : 'action.showHidden'), shortcut: keys.label('hidden'), onClick: ctx.toggleHidden },
        { label: t('action.copyPath'), icon: 'copy', onClick: ctx.copyPath },
        { label: t('action.refresh'), onClick: ctx.reload }
      ]
  if (settings.fileAssistantEnabled && !listing?.readOnly) {
    items.push('separator', { label: t('assistant.title'), items: ASSISTANT_MODES.map((mode) => ({ label: t(`assistant.mode.${mode}`), onClick: () => ctx.setAssistantMode(mode) })) })
  }
  return items
}
