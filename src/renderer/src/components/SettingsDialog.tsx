import { FileAssistantSettings } from './FileAssistantSettings'
import { DiskAccessSettings } from './DiskAccess'
import { ActivitySettings } from './ActivitySettings'
import { McpSettings } from './McpSettings'
import { CompanionSettings } from './CompanionSettings'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'
import { resizeCursor, resizeDialog } from '@renderer/lib/dragDialog'
import { DialogTitleBar, useModalDialog } from './Dialog'
import { useEffect, useState } from 'react'
import { LANGUAGES, locale, t, tos, type LanguageSetting, type MessageKey } from '@shared/i18n'
import { COMMANDS, type Command, type ShortcutOverrides } from '@shared/shortcuts'
import { ICON_SETS, THEMES, UI_SCALES, type FileIconSetting, type IconSetId, type Settings } from '@shared/types'
import { Icon, type IconName } from './Icon'
import { keys } from '@renderer/lib/keys'

const SECTIONS = [
  { id: 'general', icon: 'settings' },
  { id: 'appearance', icon: 'theme' },
  { id: 'icons', icon: 'view' },
  { id: 'sound', icon: 'audio' },
  { id: 'files', icon: 'folder' },
  { id: 'ai', icon: 'ai' },
  { id: 'phone', icon: 'remote' },
  { id: 'computers', icon: 'desktop' },
  { id: 'shortcuts', icon: 'terminal' }
] as const satisfies readonly { id: string; icon: IconName }[]
export type Section = (typeof SECTIONS)[number]['id']
/** Reopening the dialog returns to the category the user last looked at. */
let lastSection: Section = 'general'

interface Props {
  settings: Settings
  onChange(patch: Partial<Settings>): void
  onLanguageChange(language: LanguageSetting): void
  onOpenActivity(): void
  /** Closes the settings and pairs another computer with this link (Settings → Remote access). */
  onConnectComputer(link: string): void
  onClose(): void
  /** Opens on this category instead of the last one shown. */
  section?: Section
}

/** aFinder as the system's file manager: what it is now, and the button to take over or give back. */
function DefaultAppSetting(): React.JSX.Element | null {
  const [state, setState] = useState<{ supported: boolean; isDefault: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void window.api.defaultApp.status().then(setState, () => setState(null)), [])
  if (!state?.supported) return null
  const toggle = (): void => {
    setBusy(true)
    setError(null)
    window.api.defaultApp
      .set(!state.isDefault)
      .then((isDefault) => setState({ ...state, isDefault }), (err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }
  return (
    <div className="settings-default-app">
      <p className="settings-note">{tos(state.isDefault ? 'defaultApp.isDefault' : 'defaultApp.notDefault')}</p>
      <button className="xp-button" disabled={busy} onClick={toggle}>
        {tos(state.isDefault ? 'defaultApp.restore' : 'defaultApp.make')}
      </button>
      {error && <p className="settings-note mcp-error" role="alert">{error}</p>}
    </div>
  )
}

/** Edits the same preferences used by the toolbar and persisted by App. */
export function SettingsDialog({ settings, onChange, onLanguageChange, onOpenActivity, onConnectComputer, onClose, section: initial }: Props): React.JSX.Element {
  const modal = useModalDialog(onClose)
  const [releaseNotes, setReleaseNotes] = useState(false)
  const [section, setSection] = useState<Section>(initial ?? lastSection)
  const select = (id: Section): void => {
    lastSection = id
    setSection(id)
  }
  /** Arrow keys move between categories, as in any vertical tab list. */
  const navKey = (e: React.KeyboardEvent): void => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const i = SECTIONS.findIndex((s) => s.id === section)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? SECTIONS.length - 1 : (i + step! + SECTIONS.length) % SECTIONS.length
    select(SECTIONS[next].id)
    document.getElementById(`settings-tab-${SECTIONS[next].id}`)?.focus()
  }

  return (
    <dialog
      ref={modal.ref}
      className="xp-window dialog settings-dialog"
      onPointerDown={resizeDialog}
      onPointerMove={resizeCursor}
      aria-labelledby="settings-title"
      onCancel={modal.onCancel}
    >
      <DialogTitleBar title={t('settings.title')} titleId="settings-title" onClose={onClose} />
      <div className="settings-body">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label={t('settings.title')} onKeyDown={navKey}>
          {SECTIONS.map(({ id, icon }) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              role="tab"
              aria-selected={section === id}
              aria-controls="settings-panel"
              tabIndex={section === id ? 0 : -1}
              className={`settings-nav-item${section === id ? ' active' : ''}`}
              onClick={() => select(id)}
            >
              <Icon name={icon} size={16} />
              <span>{t(`settings.section.${id}`)}</span>
            </button>
          ))}
        </nav>
        <div id="settings-panel" className="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${section}`} tabIndex={-1}>
          {section === 'general' && (
            <fieldset>
              <legend>{t('settings.section.general')}</legend>
              <label className="settings-field">
                <span>{t('menu.language')}</span>
                <select value={settings.language} onChange={(e) => onLanguageChange(e.target.value as LanguageSetting)}>
                  <option value="auto">{t('lang.auto')}</option>
                  {LANGUAGES.map((lang) => <option key={lang.id} value={lang.id}>{lang.name}</option>)}
                </select>
              </label>
              {/* The App Store updates its own build; that build has the sandbox's disk access instead. */}
              {window.api.mas ? (
                <DiskAccessSettings />
              ) : (
                <>
                  <label className="settings-check">
                    <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => onChange({ autoUpdate: e.target.checked })} />
                    {t('settings.autoUpdate')}
                  </label>
                  <p className="settings-note">
                    <button className="link-button" onClick={() => void window.api.checkForUpdates()}>{t('settings.checkNow')}</button>
                    {' · '}
                    <button className="link-button" onClick={() => setReleaseNotes(true)}>{t('releaseNotes.title')}</button>
                  </p>
                </>
              )}
              <DefaultAppSetting />
              <div className="settings-about">
                <p className="settings-note"><strong>{tos('settings.version', { version: window.api.about.version, arch: window.api.about.arch })}</strong></p>
                <p className="settings-note">{t('settings.runtime', window.api.about)}</p>
              </div>
            </fieldset>
          )}
          {section === 'appearance' && (
            <fieldset>
              <legend>{t('settings.appearance')}</legend>
              <label className="settings-field">
                <span>{t('menu.theme')}</span>
                <select value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as Settings['theme'] })}>
                  {THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.id === 'classic' ? t('theme.classic') : theme.name}</option>)}
                </select>
              </label>
              <label className="settings-check">
                <input type="checkbox" checked={settings.workspaceBar} onChange={(e) => onChange({ workspaceBar: e.target.checked })} />
                {t('settings.workspaceBar')}
              </label>
              {settings.theme === 'apple' && (
                <label className="settings-check">
                  <input type="checkbox" checked={settings.cleanLook} onChange={(e) => onChange({ cleanLook: e.target.checked })} />
                  {t('settings.cleanLook')}
                </label>
              )}
              <label className="settings-field">
                <span>{t('settings.uiScale')}</span>
                <select value={settings.uiScale} onChange={(e) => onChange({ uiScale: Number(e.target.value) })}>
                  {UI_SCALES.map((scale) => (
                    <option key={scale} value={scale}>
                      {new Intl.NumberFormat(locale(), { style: 'percent' }).format(scale / 100)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-check">
                <input type="checkbox" checked={settings.themeInfo} onChange={(e) => onChange({ themeInfo: e.target.checked })} />
                {t('settings.themeInfo')}
              </label>
              <p className="settings-note">{t('settings.themeInfoHint')}</p>
            </fieldset>
          )}
          {section === 'icons' && <IconSettings settings={settings} onChange={onChange} />}
          {section === 'sound' && (
            <fieldset>
              <legend>{t('sound.title')}</legend>
              <label className="settings-check">
                <input type="checkbox" checked={settings.sounds} onChange={(e) => onChange({ sounds: e.target.checked })} />
                {t('sound.effects')}
              </label>
              <label className="settings-field">
                <span>{t('sound.effectsVolume')}</span>
                <input type="range" min={0} max={100} step={5} disabled={!settings.sounds} value={settings.soundVolume} onChange={(e) => onChange({ soundVolume: Number(e.target.value) })} />
              </label>
              <label className="settings-check">
                <input type="checkbox" checked={settings.music} onChange={(e) => onChange({ music: e.target.checked })} />
                {t('sound.music')}
              </label>
              <label className="settings-field">
                <span>{t('sound.musicVolume')}</span>
                <input type="range" min={0} max={100} step={5} disabled={!settings.music} value={settings.musicVolume} onChange={(e) => onChange({ musicVolume: Number(e.target.value) })} />
              </label>
              <p className="settings-note">{t('sound.hint')}</p>
            </fieldset>
          )}
          {section === 'files' && (
            <>
              <fieldset>
                <legend>{t('settings.files')}</legend>
                <label className="settings-check">
                  <input type="checkbox" checked={settings.showHidden} onChange={(e) => onChange({ showHidden: e.target.checked })} />
                  {t('action.showHidden')}
                </label>
                <label className="settings-check">
                  <input type="checkbox" checked={settings.lineNumbers} onChange={(e) => onChange({ lineNumbers: e.target.checked })} />
                  {t('settings.lineNumbers')}
                </label>
                <label className="settings-check">
                  <input type="checkbox" checked={settings.expandFolders} onChange={(e) => onChange({ expandFolders: e.target.checked })} />
                  {t('settings.expandFolders')}
                </label>
                <label className="settings-check" title={t('settings.recentFilesHint')}>
                  <input type="checkbox" checked={settings.recentFiles} onChange={(e) => onChange({ recentFiles: e.target.checked })} />
                  {t('settings.recentFiles')}
                </label>
              </fieldset>
              <fieldset>
                <legend>{t('settings.search')}</legend>
                <label className="settings-check">
                  <input type="checkbox" checked={settings.fuzzy} onChange={(e) => onChange({ fuzzy: e.target.checked })} />
                  {t('toolbar.fuzzyTitle')}
                </label>
                <label className="settings-check">
                  <input type="checkbox" checked={settings.recursive} onChange={(e) => onChange({ recursive: e.target.checked })} />
                  {t('toolbar.subfoldersTitle')}
                </label>
              </fieldset>
            </>
          )}
          {section === 'ai' && (
            <>
              <FileAssistantSettings settings={settings} onChange={onChange} />
              <ActivitySettings settings={settings} onChange={onChange} onOpen={onOpenActivity} />
              <McpSettings settings={settings} onChange={onChange} />
            </>
          )}
          {section === 'phone' && <CompanionSettings key="phone" kind="phone" settings={settings} onChange={onChange} />}
          {section === 'computers' && <CompanionSettings key="computers" kind="computer" settings={settings} onChange={onChange} onConnectComputer={onConnectComputer} />}
          {section === 'shortcuts' && <ShortcutSettings overrides={settings.shortcuts} onChange={(shortcuts) => onChange({ shortcuts })} />}
          <p className="settings-note">{t('settings.saved')}</p>
        </div>
      </div>
      <div className="dialog-buttons">
        <button className="xp-button" onClick={onClose}>{t('window.close')}</button>
      </div>
      {/* Inside the <dialog>, so it shares the top layer above the settings. */}
      {releaseNotes && <ReleaseNotesDialog onClose={() => setReleaseNotes(false)} />}
    </dialog>
  )
}

/** A few toolbar and file icons that show the character of a set. */
const UI_SAMPLE: IconName[] = ['back', 'forward', 'up', 'newFolder', 'terminal', 'folders', 'group', 'preview', 'search', 'trash']
const FILE_SAMPLE: IconName[] = ['folder', 'documents', 'image', 'audio', 'video', 'pdf', 'code', 'archive', 'text', 'disk']

function IconSettings({ settings, onChange }: { settings: Settings; onChange(patch: Partial<Settings>): void }): React.JSX.Element {
  const fileSet: IconSetId = settings.fileIconSet === 'match' ? settings.iconSet : settings.fileIconSet
  return (
    <>
      <fieldset>
        <legend>{t('icons.ui')}</legend>
        <p className="settings-note">{t('icons.uiHint')}</p>
        <div className="icon-set-list" role="radiogroup" aria-label={t('icons.ui')}>
          {ICON_SETS.map((set) => (
            <label key={set} className={`icon-set-card${settings.iconSet === set ? ' active' : ''}`}>
              <input type="radio" name="icon-set" checked={settings.iconSet === set} onChange={() => onChange({ iconSet: set })} />
              <span className="icon-set-text">
                <strong>{t(`icons.set.${set}`)}</strong>
                <span className="settings-note">{t(`icons.desc.${set}`)}</span>
              </span>
              <span className="icon-set-sample" aria-hidden="true">
                {UI_SAMPLE.map((name) => <Icon key={name} name={name} size={20} set={set} />)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('icons.files')}</legend>
        <label className="settings-field">
          <span>{t('icons.filesSet')}</span>
          <select value={settings.fileIconSet} onChange={(e) => onChange({ fileIconSet: e.target.value as FileIconSetting })}>
            <option value="match">{t('icons.match')}</option>
            {ICON_SETS.map((set) => <option key={set} value={set}>{t(`icons.set.${set}`)}</option>)}
          </select>
        </label>
        <div className="icon-set-sample" aria-hidden="true">
          {FILE_SAMPLE.map((name) => <Icon key={name} name={name} size={24} set={fileSet} />)}
        </div>
        <p className="settings-note">{t('icons.filesHint')}</p>
      </fieldset>
    </>
  )
}

const commandName = (command: Command): string => t(`shortcut.${command}` as MessageKey)

/** One row per command: click the shortcut, press the new keys. */
function ShortcutSettings({ overrides, onChange }: { overrides: ShortcutOverrides; onChange(next: ShortcutOverrides): void }): React.JSX.Element {
  const [recording, setRecording] = useState<Command | null>(null)
  const [message, setMessage] = useState('')

  const set = (command: Command, list: string[] | null): void => {
    const next = { ...overrides }
    // Back at the defaults: forget the override, so later changes to the defaults apply.
    if (list === null || list.join() === keys.defaults(command).join()) delete next[command]
    else next[command] = list
    onChange(next)
  }

  const record = (command: Command, e: React.KeyboardEvent): void => {
    // Keep every key away from the dialog (Esc would close it) and from the app's shortcuts.
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      setRecording(null)
      setMessage('')
      return
    }
    if (['Meta', 'Control', 'Alt', 'Shift', 'OS'].includes(e.key)) return
    const binding = keys.fromEvent(e.nativeEvent)
    if (!binding) return setMessage(t('settings.invalid', { mods: keys.isMac ? '⌘ / ⌃ / ⌥' : 'Ctrl / Alt' }))
    const label = keys.format(binding)
    const other = keys.conflict(binding, command)
    if (other === 'reserved') return setMessage(t('settings.reserved', { keys: label }))
    if (other) return setMessage(t('settings.conflict', { keys: label, command: commandName(other) }))
    set(command, [binding])
    setRecording(null)
    setMessage('')
  }

  return (
    <fieldset className="settings-shortcuts">
      <legend>{t('settings.shortcuts')}</legend>
      <p className="settings-note">{t('settings.shortcutsHint')}</p>
      <div className="shortcut-list" role="table" aria-label={t('settings.shortcuts')}>
        {COMMANDS.map((command) => {
          const bindings = keys.bindings(command)
          const changed = overrides[command] !== undefined
          const active = recording === command
          return (
            <div key={command} className={`shortcut-row${changed ? ' changed' : ''}`} role="row">
              <span role="cell" className="shortcut-name">{commandName(command)}</span>
              <span role="cell">
                <button
                  className={`xp-button shortcut-keys${active ? ' recording' : ''}`}
                  aria-label={`${commandName(command)}: ${active ? t('settings.recording') : bindings.map(keys.format).join(', ') || t('settings.none')}`}
                  onClick={() => { setRecording(active ? null : command); setMessage('') }}
                  onKeyDown={active ? (e) => record(command, e) : undefined}
                  onBlur={() => active && setRecording(null)}
                >
                  {active ? t('settings.recording') : bindings.length ? bindings.map((b) => <kbd key={b}>{keys.format(b)}</kbd>) : <span className="muted">{t('settings.none')}</span>}
                </button>
              </span>
              <span role="cell" className="shortcut-actions">
                {bindings.length > 0 && (
                  <button className="link-button" title={t('settings.clearTitle')} onClick={() => set(command, [])}>{t('settings.clear')}</button>
                )}
                {changed && (
                  <button className="link-button" title={t('settings.resetTitle')} onClick={() => set(command, null)}>{t('settings.reset')}</button>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <p className="shortcut-message" aria-live="polite">{message}</p>
      <button className="xp-button" disabled={Object.keys(overrides).length === 0} onClick={() => { onChange({}); setMessage('') }}>
        {t('settings.resetAll')}
      </button>
    </fieldset>
  )
}
