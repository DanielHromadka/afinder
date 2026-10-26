import { LANGUAGES, t, type LanguageSetting, type MessageKey } from '@shared/i18n'
import type { RemoteMount } from '@shared/remote'
import { ICON_SETS, THEMES, type Settings, type TerminalProfile, type TerminalProfiles } from '@shared/types'
import { EDITORS, type Editor, type Workspace } from '@shared/workspace'
import { keys } from '@renderer/lib/keys'
import type { PaletteCommand } from '@renderer/lib/palette'
import { editorName, workspaceName } from '../components/Workspace'

// The window's own commands in the palette (⌘K); the focused tab adds its folder, selection, view and AI ones.

export const PANE_LABELS: MessageKey[] = ['panes.one', 'panes.two', 'panes.three', 'panes.four']

export interface WindowCommandContext {
  settings: Settings
  paneCount: number
  workspaces: Workspace[]
  activeWorkspace: string | null
  maximized: boolean
  consoleOpen: boolean
  profiles: TerminalProfiles | null
  remotes: RemoteMount[]
  isShown(editor: Editor): boolean
  newTab(): void
  closeTab(): void
  newWindow(): void
  switchWorkspace(id: string): void
  duplicateWorkspace(): void
  toggleMaximize(): void
  toggleArea(editor: Editor): void
  setPaneCount(count: number): void
  addRemote(): void
  openDesktop(connectionId: string): void
  openActivity(): void
  openAutomations(): void
  startTour(): void
  openReleaseNotes(): void
  openFeedback(): void
  openSettings(): void
  setConsoleOpen(open: boolean): void
  openConsole(profile: TerminalProfile): void
  updateSettings(patch: Partial<Settings>): void
  changeLanguage(lang: LanguageSetting): void
}

export function windowCommands(c: WindowCommandContext): PaletteCommand[] {
  const { settings } = c
  const g = { window: t('palette.group.window'), console: t('palette.group.console'), look: t('palette.group.look'), workspace: t('workspace.title') }
  const agents: [TerminalProfile, MessageKey][] = [
    ['claude', 'console.openClaude'],
    ['codex', 'console.openCodex'],
    ['opencode', 'console.openOpencode'],
    ['shell', 'console.openShell']
  ]
  return [
    { id: 'newTab', group: g.window, label: t('tabs.new'), shortcut: keys.label('newTab'), run: c.newTab },
    { id: 'closeTab', group: g.window, label: t('tabs.close'), shortcut: keys.label('closeTab'), run: c.closeTab },
    { id: 'newWindow', group: g.window, label: t('window.new'), shortcut: keys.label('newWindow'), run: c.newWindow },
    ...c.workspaces.map((w) => ({
      id: `workspace-${w.id}`,
      group: g.workspace,
      label: `${t('workspace.title')}: ${workspaceName(w)}`,
      icon: 'panes' as const,
      keywords: 'workspace layout rozložení pracovní plocha',
      checked: w.id === c.activeWorkspace,
      run: () => c.switchWorkspace(w.id)
    })),
    {
      id: 'workspaceBar',
      group: g.workspace,
      label: t('settings.workspaceBar'),
      checked: settings.workspaceBar === true,
      keywords: 'workspace bar lišta pracovní plochy oblasti',
      run: () => c.updateSettings({ workspaceBar: !settings.workspaceBar })
    },
    { id: 'maximizeArea', group: g.workspace, label: t(c.maximized ? 'area.restore' : 'area.maximize'), shortcut: keys.label('maximizeArea'), run: c.toggleMaximize },
    ...EDITORS.filter((e) => e !== 'files').map((editor) => ({
      id: `area-${editor}`,
      group: g.workspace,
      label: t('area.toggle', { name: editorName(editor) }),
      checked: c.isShown(editor),
      keywords: 'area panel oblast',
      run: () => c.toggleArea(editor)
    })),
    ...(c.activeWorkspace ? [{ id: 'duplicateWorkspace', group: g.workspace, label: t('workspace.duplicateCurrent'), run: c.duplicateWorkspace }] : []),
    ...PANE_LABELS.map((label, i) => ({
      id: `panes-${i + 1}`,
      group: g.window,
      label: t(label),
      icon: 'panes' as const,
      checked: c.paneCount === i + 1,
      shortcut: i === 1 ? keys.label('split') : undefined,
      run: () => c.setPaneCount(i + 1)
    })),
    { id: 'addRemote', group: g.window, label: t('remote.add'), icon: 'remote', keywords: 'sftp s3 sharepoint onedrive afinder computer počítač', run: c.addRemote },
    ...c.remotes
      .filter((m) => m.connection.type === 'afinder')
      .map((m) => ({
        id: `desktop-${m.connection.id}`,
        group: g.window,
        label: t('remoteDesktop.openNamed', { name: m.connection.name }),
        icon: 'remote' as const,
        keywords: 'remote desktop vzdálená plocha ovládání control',
        run: () => c.openDesktop(m.connection.id)
      })),
    { id: 'activity', group: g.window, label: t('activity.title'), keywords: 'history audit log fragment historie aktivita', run: c.openActivity },
    { id: 'automations', group: g.window, label: t('automation.title'), icon: 'automation', keywords: 'automation workflow schedule sync automatizace synchronizace', run: c.openAutomations },
    { id: 'sounds', group: g.look, label: t('sound.effects'), checked: settings.sounds, keywords: 'sound zvuk audio', run: () => c.updateSettings({ sounds: !settings.sounds }) },
    { id: 'music', group: g.look, label: t('sound.music'), checked: settings.music, keywords: 'music hudba hacker', run: () => c.updateSettings({ music: !settings.music }) },
    { id: 'tour', group: g.window, label: t('tour.start'), icon: 'help', shortcut: keys.label('tour'), keywords: 'help tutorial guide nápověda průvodce', run: c.startTour },
    { id: 'releaseNotes', group: g.window, label: t('releaseNotes.title'), keywords: 'release notes changelog what is new novinky co je nového verze version', run: c.openReleaseNotes },
    { id: 'feedback', group: g.window, label: t('feedback.open'), icon: 'feedback', keywords: 'bug report feedback chyba nahlásit návrh zpětná vazba', run: c.openFeedback },
    { id: 'settings', group: g.window, label: t('settings.title'), shortcut: keys.isMac ? '⌘,' : 'Ctrl+,', run: c.openSettings },
    { id: 'console', group: g.console, label: t('console.toggle'), icon: 'console', checked: c.consoleOpen, shortcut: keys.label('toggleConsole'), run: () => c.setConsoleOpen(!c.consoleOpen) },
    ...agents
      .filter(([profile]) => profile === 'shell' || c.profiles?.[profile])
      .map(([profile, key]) => ({ id: `console-${profile}`, group: g.console, label: t(key), icon: 'terminal' as const, run: () => c.openConsole(profile) })),
    ...THEMES.map((theme) => ({
      id: `theme-${theme.id}`,
      group: g.look,
      label: `${t('menu.theme')}: ${theme.id === 'classic' ? t('theme.classic') : theme.name}`,
      icon: 'theme' as const,
      keywords: 'theme vzhled',
      checked: settings.theme === theme.id,
      run: () => c.updateSettings({ theme: theme.id })
    })),
    ...ICON_SETS.map((set) => ({
      id: `icons-${set}`,
      group: g.look,
      label: `${t('icons.title')}: ${t(`icons.set.${set}`)}`,
      icon: 'view' as const,
      keywords: 'icons ikony',
      checked: settings.iconSet === set,
      run: () => c.updateSettings({ iconSet: set })
    })),
    ...[{ id: 'auto' as LanguageSetting, name: t('lang.auto') }, ...LANGUAGES].map((l) => ({
      id: `lang-${l.id}`,
      group: g.look,
      label: `${t('menu.language')}: ${l.name}`,
      keywords: 'language jazyk',
      checked: settings.language === l.id,
      run: () => c.changeLanguage(l.id)
    }))
  ]
}
