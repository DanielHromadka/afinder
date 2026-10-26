import { forwardRef } from 'react'
import { t, tos } from '@shared/i18n'
import { keys, withShortcut } from '@renderer/lib/keys'
import { Icon, type IconName } from './Icon'

const withKey = withShortcut

interface Props {
  canBack: boolean
  canForward: boolean
  canUp: boolean
  foldersShown: boolean
  filter: string
  fuzzy: boolean
  recursive: boolean
  grouped: boolean
  paneCount: number
  consoleOpen: boolean
  previewPane: boolean
  onTogglePreview(): void
  onBack(): void
  onForward(): void
  onUp(): void
  onNewFolder(): void
  onTerminal(): void
  onToggleFolders(): void
  onFilter(value: string): void
  onToggleFuzzy(): void
  onToggleRecursive(): void
  onGroupMenu(e: React.MouseEvent): void
  onViewMenu(e: React.MouseEvent): void
  onPanesMenu(e: React.MouseEvent): void
  onConsoleMenu(e: React.MouseEvent): void
  onAutomations(): void
  onSettings(): void
  onHelp(e: React.MouseEvent): void
}

function ToolButton(props: {
  icon: IconName
  label?: string
  title: string
  disabled?: boolean
  pressed?: boolean
  /** Icon size; by default 24 with a label, 20 without. */
  size?: number
  /** What the guided tour points at. */
  tour?: string
  onClick(e: React.MouseEvent): void
}): React.JSX.Element {
  return (
    <button
      data-tour={props.tour}
      className={`tool-btn${props.pressed ? ' pressed' : ''}`}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={props.size ?? (props.label ? 24 : 20)} />
      {props.label && <span>{props.label}</span>}
    </button>
  )
}

/** A mouse wheel scrolls up and down; in a toolbar too wide for the window that means sideways. */
function scrollSideways(e: React.WheelEvent<HTMLDivElement>): void {
  const bar = e.currentTarget
  if (bar.scrollWidth > bar.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) bar.scrollLeft += e.deltaY
}

/** In the macOS theme on a Mac the toolbar stands in for the hidden title bar, so a double-click on its empty space zooms. */
function zoomFromToolbar(e: React.MouseEvent): void {
  const empty = e.target === e.currentTarget || (e.target as Element).classList.contains('toolbar-spacer')
  if (empty && document.documentElement.dataset.theme === 'apple' && window.api.platform === 'darwin') window.api.window.toggleMaximize()
}

export const Toolbar = forwardRef<HTMLInputElement, Props>(function Toolbar(p, filterRef) {
  return (
    <div className="toolbar" onDoubleClick={zoomFromToolbar} onWheel={scrollSideways}>
      <div className="tool-sep lead" />
      <ToolButton icon="back" tour="back" title={withKey(t('toolbar.back'), 'back')} disabled={!p.canBack} onClick={p.onBack} />
      <ToolButton icon="forward" tour="forward" title={withKey(t('toolbar.forward'), 'forward')} disabled={!p.canForward} onClick={p.onForward} />
      <ToolButton icon="up" tour="up" title={withKey(t('toolbar.up'), 'up')} disabled={!p.canUp} onClick={p.onUp} />
      <div className="tool-sep" />
      <ToolButton icon="newFolder" label={t('toolbar.newFolder')} title={withKey(t('toolbar.newFolder'), 'newFolder')} onClick={p.onNewFolder} />
      <ToolButton icon="terminal" tour="terminal" label={t('toolbar.terminal')} title={withKey(tos('action.terminal'), 'terminal')} onClick={p.onTerminal} />
      <div className="tool-sep" />
      <ToolButton
        icon="folders" tour="folders"
        label={t('toolbar.folders')}
        title={t('toolbar.foldersTitle')}
        pressed={p.foldersShown}
        onClick={p.onToggleFolders}
      />
      <ToolButton icon="view" tour="view" label={t('toolbar.view')} title={t('toolbar.viewTitle')} onClick={p.onViewMenu} />
      <ToolButton icon="group" tour="group" label={t('toolbar.group')} title={t('toolbar.groupTitle')} pressed={p.grouped} onClick={p.onGroupMenu} />
      <ToolButton
        icon="panes" tour="panes"
        label={t('toolbar.panes')}
        title={t('toolbar.panesTitle', { split: keys.label('split'), window: keys.label('newWindow') })}
        pressed={p.paneCount > 1}
        onClick={p.onPanesMenu}
      />
      <ToolButton
        icon="preview" tour="preview"
        label={t('toolbar.preview')}
        title={withKey(t('toolbar.previewTitle'), 'preview')}
        pressed={p.previewPane}
        onClick={p.onTogglePreview}
      />
      <ToolButton
        icon="console" tour="console"
        label={t('console.button')}
        title={withKey(t('console.title'), 'toggleConsole')}
        pressed={p.consoleOpen}
        onClick={p.onConsoleMenu}
      />
      <ToolButton icon="automation" tour="automations" label={t('automation.title')} title={t('automation.title')} onClick={p.onAutomations} />
      <div className="toolbar-spacer" />
      <div className="filter-box">
        <Icon name="search" size={14} />
        <input
          ref={filterRef}
          value={p.filter}
          placeholder={withKey(t(p.recursive ? 'toolbar.search' : 'toolbar.filter'), 'filter')}
          spellCheck={false}
          onChange={(e) => p.onFilter(e.target.value)}
        />
        {p.filter && (
          <button className="filter-clear" title={t('toolbar.clear')} onClick={() => p.onFilter('')}>
            ✕
          </button>
        )}
        {/* Search options sit in the field itself, as in VS Code's find box. */}
        <button
          className={`filter-opt fuzzy-toggle${p.fuzzy ? ' on' : ''}`}
          aria-pressed={p.fuzzy}
          aria-label={t('toolbar.fuzzy')}
          title={t('toolbar.fuzzyTitle')}
          onClick={p.onToggleFuzzy}
        >
          ≈
        </button>
        <button
          className={`filter-opt fuzzy-toggle${p.recursive ? ' on' : ''}`}
          aria-pressed={p.recursive}
          aria-label={t('toolbar.subfolders')}
          title={withKey(t('toolbar.subfoldersTitle'), 'recursive')}
          onClick={p.onToggleRecursive}
        >
          <Icon name="folders" size={14} />
        </button>
      </div>
      {/* Icon only: with a label the toolbar no longer fits a 1280 px window. */}
      <ToolButton icon="help" tour="help" size={24} title={withKey(t('help.title'), 'tour')} onClick={p.onHelp} />
      <ToolButton icon="settings" tour="settings" size={24} title={`${t('settings.title')} (${keys.isMac ? '⌘,' : 'Ctrl+,'})`} onClick={p.onSettings} />
    </div>
  )
})
