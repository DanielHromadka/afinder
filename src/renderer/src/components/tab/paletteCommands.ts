import { ASSISTANT_MODES } from '@shared/fileAssistant'
import { t, tos } from '@shared/i18n'
import { GROUP_BY, VIEW_MODES, type ScreenshotMode, type ViewMode } from '@shared/types'
import { groupByLabel } from '@renderer/lib/grouping'
import { keys } from '@renderer/lib/keys'
import type { PaletteCommand } from '@renderer/lib/palette'
import { folderLabel } from '@renderer/lib/places'
import type { Command } from '@shared/shortcuts'
import type { TabContext } from './actions'

// The focused tab's part of the command palette (⌘K): its folder, selection, view and AI commands.

export const SCREENSHOT_MODES: ScreenshotMode[] = ['region', 'window', 'screen']
export const VIEW_COMMAND: Record<ViewMode, Command> = { details: 'viewDetails', list: 'viewList', icons: 'viewIcons' }

export function tabPaletteCommands(ctx: TabContext): PaletteCommand[] {
  const { path, settings, listing } = ctx
  if (!path) return []
  const g = { actions: t('palette.group.actions'), view: t('palette.group.view'), go: t('palette.group.go'), ai: 'AI' }
  const item = ctx.focusIndex >= 0 && ctx.selection.size > 0 ? ctx.rows[ctx.focusIndex].entry : null
  const sel = ctx.selectedEntries
  const show = ctx.slideshowOf(item)
  const list: (PaletteCommand | false | null)[] = [
    ...ASSISTANT_MODES.filter(() => settings.fileAssistantEnabled && !listing?.readOnly).map((mode) => ({
      id: `assistant-${mode}`,
      group: g.ai,
      label: `${t('assistant.title')}: ${t(`assistant.mode.${mode}`)}`,
      keywords: 'local laya assistant soubory',
      run: () => ctx.setAssistantMode(mode)
    })),
    // actions on the folder and the selection
    { id: 'newFolder', group: g.actions, label: t('action.newFolder'), icon: 'newFolder', shortcut: keys.label('newFolder'), run: ctx.newFolder },
    { id: 'newFile', group: g.actions, label: t('action.newFile'), icon: 'newFile', keywords: 'file txt soubor', run: ctx.newFile },
    item && { id: 'open', group: g.actions, label: `${t('action.open')}: ${item.name}`, icon: 'open', run: () => ctx.openEntry(item) },
    ...SCREENSHOT_MODES.map((mode) => ({
      id: `screenshot-${mode}`,
      group: g.actions,
      label: `${t('screenshot.title')}: ${t(`screenshot.mode.${mode}`)}`,
      keywords: 'screenshot capture snimek',
      shortcut: mode === 'region' ? keys.label('screenshot') : undefined,
      run: () => ctx.takeScreenshot(mode)
    })),
    show && { id: 'slideshow', group: g.actions, label: t('slideshow.title'), icon: 'image', keywords: 'slideshow presentation prezentace', run: () => ctx.playSlideshow(show) },
    item && { id: 'quickLook', group: g.actions, label: t('action.quickLook'), shortcut: keys.label('quickLook'), run: () => ctx.setQuickLook(true) },
    sel.length > 0 && {
      id: 'rename',
      group: g.actions,
      label: sel.length > 1 ? t('action.renameMany', { n: sel.length }) : t('action.rename'),
      icon: 'rename',
      shortcut: keys.label('rename'),
      run: ctx.startRename
    },
    sel.length > 0 && { id: 'copy', group: g.actions, label: t('action.copy'), icon: 'copy', shortcut: keys.label('copy'), run: () => ctx.copySelection(false) },
    sel.length > 0 && { id: 'cut', group: g.actions, label: t('action.cut'), shortcut: keys.label('cut'), run: () => ctx.copySelection(true) },
    { id: 'paste', group: g.actions, label: t('action.paste'), shortcut: keys.label('paste'), run: () => ctx.paste() },
    sel.length > 0 && { id: 'duplicate', group: g.actions, label: t('action.duplicate'), shortcut: keys.label('duplicate'), run: ctx.duplicate },
    sel.length > 0 && ctx.canArchive && { id: 'archive', group: g.actions, label: t('action.compress'), icon: 'archive', keywords: 'zip tar gzip zstd compress komprimovat', run: () => ctx.openArchive(sel) },
    ctx.canArchive && { id: 'archiveFolder', group: g.actions, label: t('action.compressFolder'), icon: 'archive', keywords: 'zip tar gzip zstd compress komprimovat', run: () => ctx.openArchive(null) },
    sel.length > 0 && { id: 'trash', group: g.actions, label: tos('action.trash'), icon: 'trash', shortcut: keys.label('trash'), run: ctx.trashSelected },
    { id: 'selectAll', group: g.actions, label: t('palette.selectAll'), shortcut: keys.label('selectAll'), run: ctx.selectAll },
    { id: 'copyPath', group: g.actions, label: t('action.copyPath'), shortcut: keys.label('copyPath'), run: ctx.copyPath },
    sel.length > 0 && { id: 'reveal', group: g.actions, label: tos('action.reveal'), icon: 'reveal', run: ctx.revealSelected },
    { id: 'terminal', group: g.actions, label: tos('action.terminal'), icon: 'terminal', shortcut: keys.label('terminal'), run: () => ctx.openTerminal() },
    { id: 'systemTerminal', group: g.actions, label: t('action.systemTerminal'), run: () => ctx.openSystemTerminal(path) },
    item
      ? {
          id: 'favorite',
          group: g.actions,
          label: `${t(ctx.isFavorite(item.path) ? 'action.removeFavorite' : 'action.addFavorite')}: ${item.name}`,
          icon: 'star',
          shortcut: keys.label('favorite'),
          run: () => ctx.toggleFavorite({ path: item.path, isDir: item.isDir, kind: item.kind })
        }
      : {
          id: 'favorite',
          group: g.actions,
          label: `${t(ctx.isFavorite(path) ? 'action.removeFavorite' : 'action.addFavorite')}: ${folderLabel(path)}`,
          icon: 'star',
          shortcut: keys.label('favorite'),
          run: () => ctx.toggleFavorite({ path, isDir: true, kind: 'folder' })
        },
    { id: 'refresh', group: g.actions, label: t('action.refresh'), run: ctx.reload },
    // AI
    ...(ctx.aiAgent && ctx.aiCanUse(sel.length ? sel : [{ path, isDir: true }])
      ? [
          { id: 'aiAsk', group: g.ai, label: t('ai.ask'), icon: 'ai' as const, keywords: 'claude codex', run: () => ctx.askAi(sel.length ? sel : [{ path, name: folderLabel(path), isDir: true }]) },
          {
            id: 'aiSummarize',
            group: g.ai,
            label: t(sel.length ? 'ai.summarize' : 'ai.describeFolder'),
            icon: 'ai' as const,
            keywords: 'claude codex',
            run: () => ctx.summarizeAi(sel.length ? sel : [{ path, isDir: true }])
          },
          ...(sel.length && ctx.consoleProfiles?.claude && !listing?.readOnly ? [{ id: 'aiRename', group: g.ai, label: t('ai.rename'), icon: 'ai' as const, keywords: 'claude', run: () => ctx.aiRename(sel) }] : [])
        ]
      : []),
    // view
    { id: 'hidden', group: g.view, label: t('action.showHidden'), checked: settings.showHidden, shortcut: keys.label('hidden'), run: ctx.toggleHidden },
    { id: 'preview', group: g.view, label: t('toolbar.preview'), icon: 'preview', checked: ctx.preview, shortcut: keys.label('preview'), run: ctx.togglePreview },
    { id: 'recursive', group: g.view, label: t('toolbar.subfoldersTitle'), checked: settings.recursive, shortcut: keys.label('recursive'), run: ctx.toggleRecursive },
    { id: 'fuzzy', group: g.view, label: t('toolbar.fuzzyTitle'), checked: settings.fuzzy, run: ctx.toggleFuzzy },
    { id: 'folders', group: g.view, label: t('toolbar.folders'), icon: 'folders', checked: ctx.foldersShown, run: ctx.toggleFolders },
    ...VIEW_MODES.map((mode) => ({
      id: `view-${mode}`,
      group: g.view,
      label: `${t('palette.view')}: ${t(`view.${mode}`)}`,
      icon: 'view' as const,
      checked: ctx.view === mode,
      shortcut: keys.label(VIEW_COMMAND[mode]),
      run: () => ctx.setView(mode)
    })),
    ...GROUP_BY.map((by) => ({ id: `group-${by}`, group: g.view, label: `${t('palette.groupBy')}: ${groupByLabel(by)}`, icon: 'group' as const, checked: ctx.groupBy === by, run: () => ctx.changeGroupBy(by) })),
    // go
    { id: 'filter', group: g.go, label: t('palette.filter'), icon: 'search', shortcut: keys.label('filter'), run: () => ctx.focusFilter(true) },
    ctx.history.back.length > 0 && { id: 'back', group: g.go, label: t('toolbar.back'), icon: 'back', shortcut: keys.label('back'), run: ctx.goBack },
    ctx.history.forward.length > 0 && { id: 'forward', group: g.go, label: t('toolbar.forward'), icon: 'forward', shortcut: keys.label('forward'), run: ctx.goForward },
    (listing?.parent !== null || ctx.virtual !== null) && { id: 'up', group: g.go, label: t('toolbar.up'), icon: 'up', shortcut: keys.label('up'), run: ctx.goUp },
    ...settings.favorites.map((f) => ({
      id: `fav-${f.path}`,
      group: g.go,
      label: `${t('tasks.favorites')}: ${f.isDir ? folderLabel(f.path) : f.path.split(/[\\/]/).pop()}`,
      icon: f.kind,
      keywords: f.path,
      run: () => ctx.openFavorite(f)
    })),
    ...ctx.places.map((p) => ({ id: `place-${p.path}`, group: g.go, label: `${t('palette.goTo')}: ${p.name}`, icon: p.icon, keywords: p.path, run: () => ctx.navigate(p.path) })),
    ...ctx.remotes.map((m) => ({ id: `remote-${m.connection.id}`, group: g.go, label: `${t('palette.goTo')}: ${m.connection.name}`, icon: 'remote' as const, keywords: m.url, run: () => ctx.navigate(m.path) }))
  ]
  return list.filter((c): c is PaletteCommand => !!c)
}
