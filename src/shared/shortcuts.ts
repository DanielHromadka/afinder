// Commands with a customizable keyboard shortcut. Bindings are "Mod+Shift+KeyN"-style strings: "Mod" is ⌘ on
// macOS and Ctrl elsewhere, the last part is a KeyboardEvent.code. Shared so the main process can validate
// what the renderer saves.

export const COMMANDS = [
  'palette',
  'filter',
  'recursive',
  'open',
  'quickLook',
  'preview',
  'viewDetails',
  'viewList',
  'viewIcons',
  'back',
  'forward',
  'up',
  'newFolder',
  'rename',
  'duplicate',
  'trash',
  'copy',
  'cut',
  'paste',
  'pasteMove',
  'copyPath',
  'selectAll',
  'favorite',
  'hidden',
  'newTab',
  'closeTab',
  'nextTab',
  'prevTab',
  'newWindow',
  'split',
  'copyToPane',
  'moveToPane',
  'terminal',
  'toggleConsole',
  'nextWorkspace',
  'prevWorkspace',
  'maximizeArea',
  'screenshot',
  'tour'
] as const

export type Command = (typeof COMMANDS)[number]

/** User bindings per command; they replace the defaults, an empty list turns the shortcut off. */
export type ShortcutOverrides = Partial<Record<Command, string[]>>

export const MAX_BINDINGS = 4

const MODIFIERS = ['Ctrl', 'Mod', 'Alt', 'Shift'] as const
/** Keys that may stand alone; any other key needs Mod, Ctrl or Alt so typing is not hijacked. */
const BARE = /^(F([1-9]|1[0-9]|2[0-4])|Space|Delete|Insert)$/

export function isValidBinding(binding: unknown): binding is string {
  if (typeof binding !== 'string' || binding.length > 40) return false
  const parts = binding.split('+')
  const code = parts.pop()!
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(code) || /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/.test(code)) return false
  if (parts.some((p, i) => !(MODIFIERS as readonly string[]).includes(p) || parts.indexOf(p) !== i)) return false
  return BARE.test(code) || parts.some((p) => p !== 'Shift')
}

export function sanitizeShortcuts(value: unknown): ShortcutOverrides {
  if (typeof value !== 'object' || value === null) return {}
  const out: ShortcutOverrides = {}
  for (const command of COMMANDS) {
    const list = (value as Record<string, unknown>)[command]
    if (Array.isArray(list)) out[command] = [...new Set(list.filter(isValidBinding))].slice(0, MAX_BINDINGS)
  }
  return out
}
