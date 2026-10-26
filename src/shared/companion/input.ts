// Mouse and keyboard of a remote desktop session. The viewer (renderer/src/remote) sends InputEvents as JSON
// on the session's data channel; the computer validates them (parseInput), turns them into commands of the
// input helper (native/afinder-input, enigo) and writes those to it. Pure code, shared and tested.

/** Held modifiers: bit flags, so an event says in one number what the viewer's keyboard holds. */
export const Mod = { Shift: 1, Ctrl: 2, Alt: 4, Meta: 8 } as const

export type MouseButton = 'left' | 'right' | 'middle'

export type InputEvent =
  /** Pointer position on the watched monitor, 0..1 from its top left corner. */
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; b: MouseButton; d: boolean }
  /** Wheel notches; positive scrolls down / right. */
  | { t: 'scroll'; x: number; y: number }
  /** A key by its physical position (KeyboardEvent.code), the text it typed (KeyboardEvent.key) and modifiers. */
  | { t: 'key'; code: string; key: string; d: boolean; m: number }
  /** Lets go of everything held (the viewer lost focus). */
  | { t: 'release' }

/** What native/afinder-input reads, one per line. */
export type HelperCommand =
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; b: MouseButton; d: boolean }
  | { t: 'scroll'; x: number; y: number }
  | { t: 'key'; k: string; d: boolean }
  | { t: 'key'; c: string; d: boolean }
  | { t: 'text'; s: string }
  | { t: 'release' }

const BUTTONS: readonly MouseButton[] = ['left', 'right', 'middle']
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const notches = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-50, Math.min(50, Math.round(v))) : null)

/** The event, or null for anything malformed (the viewer is trusted only as far as its permission goes). */
export function parseInput(raw: unknown): InputEvent | null {
  let v: Record<string, unknown>
  try {
    v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  switch (v.t) {
    case 'move':
      return unit(v.x) && unit(v.y) ? { t: 'move', x: v.x, y: v.y } : null
    case 'button':
      return BUTTONS.includes(v.b as MouseButton) && typeof v.d === 'boolean' ? { t: 'button', b: v.b as MouseButton, d: v.d } : null
    case 'scroll': {
      const x = notches(v.x)
      const y = notches(v.y)
      return x !== null && y !== null ? { t: 'scroll', x, y } : null
    }
    case 'key':
      return typeof v.code === 'string' && v.code.length <= 32 && typeof v.key === 'string' && v.key.length <= 32 && typeof v.d === 'boolean' && Number.isInteger(v.m) && (v.m as number) >= 0 && (v.m as number) < 16
        ? { t: 'key', code: v.code, key: v.key, d: v.d, m: v.m as number }
        : null
    case 'release':
      return { t: 'release' }
    default:
      return null
  }
}

/** Keys that type nothing, by KeyboardEvent.code, as the helper names them. */
const NAMED: Record<string, string> = {
  Enter: 'Return',
  NumpadEnter: 'Return',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  CapsLock: 'CapsLock',
  ShiftLeft: 'Shift',
  ShiftRight: 'RShift',
  ControlLeft: 'Control',
  ControlRight: 'RControl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]))
}

/** Character keys by position, as on a US keyboard: shortcuts (Ctrl+C) go by position, like on the viewer. */
const PUNCTUATION: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
}

function plainChar(code: string): string | null {
  const m = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(code)
  if (m) return (m[1] ?? m[2] ?? m[3]).toLowerCase()
  return PUNCTUATION[code] ?? null
}

/**
 * Turns key events into helper commands. Typing goes as text, so the viewer's keyboard layout decides
 * which character comes out (Czech "ě" works whatever layout the computer has); shortcuts and keys that
 * type nothing go as keys. `typed` remembers keys sent as text, whose release then has nothing to undo.
 */
export class KeyMapper {
  private typed = new Set<string>()

  map(e: Extract<InputEvent, { t: 'key' }>): HelperCommand | null {
    if (!e.d && this.typed.delete(e.code)) return null
    const named = NAMED[e.code]
    if (named && e.code !== 'Space') return { t: 'key', k: named, d: e.d }
    const plain = plainChar(e.code)
    const printable = [...e.key].length === 1
    const ctrl = (e.m & Mod.Ctrl) !== 0
    const alt = (e.m & Mod.Alt) !== 0
    const meta = (e.m & Mod.Meta) !== 0
    // Ctrl+Alt is AltGr on Windows and Option types characters on a Mac: "@" from AltGr+V or "©" from
    // Option+G is text, while Ctrl+Alt+T or Alt+F (the key still says "t", "f") are shortcuts.
    const shortcut = meta || (ctrl && !alt) || ((ctrl || alt) && e.key.toLowerCase() === plain)
    if (e.d && printable && !shortcut) {
      this.typed.add(e.code)
      return { t: 'text', s: e.key }
    }
    if (e.code === 'Space') return { t: 'key', k: 'Space', d: e.d }
    if (plain) return { t: 'key', c: plain, d: e.d }
    return null
  }

  reset(): void {
    this.typed.clear()
  }
}

/** A Mac keyboard driving Windows or Linux (or the other way): Cmd and Ctrl trade places, so Cmd+C copies. */
export function swapCmdCtrl(e: Extract<InputEvent, { t: 'key' }>): Extract<InputEvent, { t: 'key' }> {
  const code = ({ MetaLeft: 'ControlLeft', MetaRight: 'ControlRight', ControlLeft: 'MetaLeft', ControlRight: 'MetaRight' } as Record<string, string>)[e.code] ?? e.code
  const key = e.key === 'Meta' ? 'Control' : e.key === 'Control' ? 'Meta' : e.key
  const m = (e.m & ~(Mod.Ctrl | Mod.Meta)) | (e.m & Mod.Ctrl ? Mod.Meta : 0) | (e.m & Mod.Meta ? Mod.Ctrl : 0)
  return { ...e, code, key, m }
}

export interface DisplayGeometry {
  /** Electron's display.bounds, in DIP. */
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

/**
 * Where a 0..1 position lies in the helper's coordinates: points on macOS (= DIP), physical pixels on
 * Windows and X11. `toPhysical` is Electron's screen.dipToScreenPoint on Windows, which also knows
 * monitors with different scaling; elsewhere DIP times the scale factor is close enough.
 */
export function screenPoint(d: DisplayGeometry, x: number, y: number, platform: string, toPhysical?: (p: { x: number; y: number }) => { x: number; y: number }): { x: number; y: number } {
  const p = { x: d.bounds.x + Math.min(x, 0.9999) * d.bounds.width, y: d.bounds.y + Math.min(y, 0.9999) * d.bounds.height }
  if (platform === 'darwin') return { x: Math.round(p.x), y: Math.round(p.y) }
  if (platform === 'win32' && toPhysical) return toPhysical({ x: Math.round(p.x), y: Math.round(p.y) })
  return { x: Math.round(p.x * d.scaleFactor), y: Math.round(p.y * d.scaleFactor) }
}

/** The event as the helper command(s) for this computer; null when there is nothing to do. */
export function helperCommand(e: InputEvent, keys: KeyMapper, point: (x: number, y: number) => { x: number; y: number }): HelperCommand | null {
  switch (e.t) {
    case 'move':
      return { t: 'move', ...point(e.x, e.y) }
    case 'button':
      return e
    case 'scroll':
      return e.x || e.y ? e : null
    case 'key':
      return keys.map(e)
    case 'release':
      keys.reset()
      return e
  }
}
