// Keyboard shortcuts per platform. "Mod" is ⌘ on macOS and Ctrl elsewhere; keys are KeyboardEvent.code
// values. macOS follows Finder, Windows and Linux follow Explorer / Nautilus conventions (and avoid
// Ctrl+Alt, which is AltGr on many European layouts).

import { t } from '@shared/i18n'
import { isValidBinding, type Command, type ShortcutOverrides } from '@shared/shortcuts'

export type { Command }

type Bindings = Record<Command, string[]>

const MAC: Bindings = {
  filter: ['Mod+KeyF'],
  recursive: ['Mod+Alt+KeyF'],
  newFolder: ['Mod+Shift+KeyN'],
  terminal: ['Mod+Shift+KeyT'],
  hidden: ['Mod+Shift+Period'],
  back: ['Mod+BracketLeft'],
  forward: ['Mod+BracketRight'],
  up: ['Mod+ArrowUp'],
  open: ['Mod+ArrowDown'],
  trash: ['Mod+Backspace'],
  copy: ['Mod+KeyC'],
  cut: ['Mod+KeyX'],
  paste: ['Mod+KeyV'],
  pasteMove: ['Mod+Alt+KeyV'],
  duplicate: ['Mod+KeyD'],
  selectAll: ['Mod+KeyA'],
  copyPath: ['Mod+Alt+KeyC'],
  rename: ['F2'],
  copyToPane: ['F5'],
  moveToPane: ['F6'],
  newTab: ['Mod+KeyT'],
  closeTab: ['Mod+KeyW'],
  nextTab: ['Ctrl+Tab', 'Mod+Shift+BracketRight'],
  prevTab: ['Ctrl+Shift+Tab', 'Mod+Shift+BracketLeft'],
  newWindow: ['Mod+KeyN'],
  split: ['Mod+Backslash'],
  toggleConsole: ['Ctrl+Backquote'],
  preview: ['Mod+Shift+KeyP'],
  viewDetails: ['Ctrl+Mod+Digit1'],
  viewList: ['Ctrl+Mod+Digit2'],
  viewIcons: ['Ctrl+Mod+Digit3'],
  quickLook: ['Space'],
  // Finder's "Add to Sidebar".
  favorite: ['Ctrl+Mod+KeyT'],
  palette: ['Mod+KeyK'],
  nextWorkspace: ['Ctrl+Mod+BracketRight'],
  prevWorkspace: ['Ctrl+Mod+BracketLeft'],
  // Blender's Ctrl+Space (macOS uses it to switch input sources).
  maximizeArea: ['Mod+Shift+Enter'],
  // ⇧⌘3/4/5 belong to the system screenshot tool.
  screenshot: ['Mod+Shift+KeyS'],
  // The usual help key (fn+F1 on Mac keyboards).
  tour: ['F1']
}

const PC: Bindings = {
  ...MAC,
  recursive: ['Mod+Shift+KeyF'],
  terminal: ['Mod+Alt+KeyT', 'Mod+Shift+KeyT'],
  hidden: ['Mod+KeyH'],
  back: ['Alt+ArrowLeft'],
  forward: ['Alt+ArrowRight'],
  up: ['Alt+ArrowUp'],
  open: ['Alt+ArrowDown'],
  trash: ['Delete'],
  pasteMove: ['Mod+Shift+KeyV'],
  copyPath: ['Mod+Shift+KeyC'],
  preview: ['Alt+KeyP'],
  // Explorer's Ctrl+Shift+1…8 view shortcuts.
  viewDetails: ['Mod+Shift+Digit6'],
  viewList: ['Mod+Shift+Digit5'],
  viewIcons: ['Mod+Shift+Digit2'],
  favorite: ['Mod+Shift+KeyD'],
  // Ctrl+K and, as in VS Code, Ctrl+Shift+P.
  palette: ['Mod+KeyK', 'Mod+Shift+KeyP'],
  nextTab: ['Ctrl+Tab', 'Ctrl+PageDown'],
  prevTab: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
  nextWorkspace: ['Ctrl+Shift+PageDown'],
  prevWorkspace: ['Ctrl+Shift+PageUp']
}

interface Parsed {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  code: string
}

const MAC_GLYPHS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Period: '.',
  Backquote: '`',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

const PC_NAMES: Record<string, string> = {
  ...MAC_GLYPHS,
  Backspace: 'Backspace',
  Delete: 'Del',
  Tab: 'Tab',
  ArrowLeft: '←',
  ArrowRight: '→'
}

const keyName = (code: string, mac: boolean): string =>
  code === 'Space' ? t('key.space') : ((mac ? MAC_GLYPHS : PC_NAMES)[code] ?? code.replace(/^Key|^Digit/, ''))

export interface Keymap {
  isMac: boolean
  /** Does the event trigger the command? */
  is(e: KeyboardEvent, command: Command): boolean
  /** Primary shortcut as shown in menus and tooltips ("⇧⌘N" or "Ctrl+Shift+N"); empty when there is none. */
  label(command: Command): string
  /** The platform's "command" modifier is held (⌘ or Ctrl) – for ⌘-click / Ctrl-click selection. */
  mod(e: { metaKey: boolean; ctrlKey: boolean }): boolean
  /** Mod+1 … Mod+9: the digit, else 0. */
  tabDigit(e: KeyboardEvent): number
  /** Bindings in effect for the command (user overrides, else the platform defaults). */
  bindings(command: Command): string[]
  /** The platform defaults of the command. */
  defaults(command: Command): string[]
  /** One binding as the user sees it. */
  format(binding: string): string
  /** The binding a keydown would record, or null for a lone modifier or a key that cannot be a shortcut. */
  fromEvent(e: KeyboardEvent): string | null
  /** Another command that already reacts to the binding, or "reserved" for keys aFinder or the system keeps. */
  conflict(binding: string, except: Command): Command | 'reserved' | null
}

export function createKeymap(platform: string, overrides: ShortcutOverrides = {}): Keymap {
  const isMac = platform === 'darwin'
  const defaults = isMac ? MAC : PC
  const bindings = { ...defaults } as Bindings
  for (const [command, list] of Object.entries(overrides) as [Command, string[] | undefined][])
    if (command in defaults && list) bindings[command] = list.filter(isValidBinding)
  const parse = (binding: string): Parsed => {
    const parts = binding.split('+')
    const code = parts.pop()!
    const has = (m: string): boolean => parts.includes(m)
    return {
      meta: isMac && has('Mod'),
      ctrl: has('Ctrl') || (!isMac && has('Mod')),
      alt: has('Alt'),
      shift: has('Shift'),
      code
    }
  }
  const parsed = Object.fromEntries(Object.entries(bindings).map(([k, v]) => [k, v.map(parse)])) as Record<Command, Parsed[]>

  const matches = (e: KeyboardEvent, p: Parsed): boolean =>
    e.code === p.code && e.metaKey === p.meta && e.ctrlKey === p.ctrl && e.altKey === p.alt && e.shiftKey === p.shift

  const same = (a: Parsed, b: Parsed): boolean =>
    a.code === b.code && a.meta === b.meta && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift

  const format = (p: Parsed): string => {
    const key = keyName(p.code, isMac)
    if (isMac) return `${p.ctrl ? '⌃' : ''}${p.alt ? '⌥' : ''}${p.shift ? '⇧' : ''}${p.meta ? '⌘' : ''}${key}`
    return [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', key].filter(Boolean).join('+')
  }

  return {
    isMac,
    is: (e, command) => parsed[command].some((p) => matches(e, p)),
    label: (command) => (parsed[command][0] ? format(parsed[command][0]) : ''),
    mod: (e) => (isMac ? e.metaKey : e.ctrlKey),
    tabDigit: (e) => {
      const modOk = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      return modOk && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0
    },
    bindings: (command) => bindings[command],
    defaults: (command) => defaults[command],
    format: (binding) => format(parse(binding)),
    fromEvent: (e) => {
      // The Windows / Super key is not a modifier aFinder binds.
      if (!isMac && e.metaKey) return null
      const mods = isMac
        ? [e.ctrlKey && 'Ctrl', e.metaKey && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift']
        : [e.ctrlKey && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift']
      const binding = [...mods.filter(Boolean), e.code].join('+')
      return isValidBinding(binding) ? binding : null
    },
    conflict: (binding, except) => {
      const p = parse(binding)
      const modOnly = (isMac ? p.meta && !p.ctrl : p.ctrl) && !p.alt && !p.shift
      // Mod+1 … Mod+9 switch tabs, Mod+, opens settings; ⌘Q, ⌘H and ⌘M belong to macOS.
      if (modOnly && (/^Digit[1-9]$/.test(p.code) || p.code === 'Comma' || (isMac && /^Key[QHM]$/.test(p.code)))) return 'reserved'
      return (Object.keys(parsed) as Command[]).find((c) => c !== except && parsed[c].some((q) => same(p, q))) ?? null
    }
  }
}

const platform = typeof window !== 'undefined' && window.api ? window.api.platform : 'darwin'

/** The keymap of the platform this renderer runs on, with the user's shortcuts (a live binding). */
export let keys: Keymap = createKeymap(platform)

let applied: ShortcutOverrides | undefined
/** Switch to the user's shortcuts; cheap to call on every render. */
export function applyShortcuts(overrides: ShortcutOverrides | undefined): void {
  if (overrides === applied) return
  applied = overrides
  keys = createKeymap(platform, overrides)
}

/** "Text (⌘K)", or just the text when the user turned the shortcut off. */
export function withShortcut(text: string, command: Command): string {
  const label = keys.label(command)
  return label ? `${text} (${label})` : text
}
