// The Doom add-on: what gets downloaded (pinned by size and SHA-256), from where, and how browser keys map to
// Doom's key codes. The engine (GPLv2) and Freedoom (BSD) are never bundled – see doom/README.md.

export const DOOM_RELEASE = 'doom-1'
export const DOOM_BASE = `https://github.com/DanielHromadka/afinder/releases/download/${DOOM_RELEASE}`
export const DOOM_SOURCE_URL = `${DOOM_BASE}/doom-source.tar.gz`
export const DOOM_WAD = 'freedoom1.wad'

export const DOOM_FILES = [
  { file: 'doom.wasm', size: 442699, sha256: '4df28dc2de82938a1d163b3ead0a06ad581fac6d9b718c786b5c8d4c56eeb696' },
  { file: DOOM_WAD, size: 28795076, sha256: '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d' },
  { file: 'DOOM-COPYING.txt', size: 18092, sha256: '8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643' },
  { file: 'FREEDOOM-COPYING.txt', size: 1644, sha256: '7c62f2c520769c798774f416637eec4921e5f0aafdac1245ae7c8a8cf65fe102' }
] as const

export const DOOM_BYTES = DOOM_FILES.reduce((n, f) => n + f.size, 0)

export type DoomStatus =
  | { state: 'missing' }
  | { state: 'downloading'; progress: number }
  | { state: 'ready'; dir: string }
  | { state: 'failed'; error: string }

const named: Record<string, number> = {
  ArrowLeft: 0xac, ArrowUp: 0xad, ArrowRight: 0xae, ArrowDown: 0xaf,
  ControlLeft: 0xa3, ControlRight: 0xa3, Space: 0xa2, Comma: 0xa0, Period: 0xa1,
  ShiftLeft: 0xb6, ShiftRight: 0xb6, AltLeft: 0xb8, AltRight: 0xb8,
  Escape: 27, Enter: 13, NumpadEnter: 13, Tab: 9, Backspace: 0x7f, Pause: 0xff,
  Equal: 0x3d, Minus: 0x2d, NumpadAdd: 0x3d, NumpadSubtract: 0x2d,
  F1: 0xbb, F2: 0xbc, F3: 0xbd, F4: 0xbe, F5: 0xbf, F6: 0xc0, F7: 0xc1, F8: 0xc2, F9: 0xc3, F10: 0xc4, F11: 0xd7, F12: 0xd8
}

/** Doom key code for a KeyboardEvent.code (doomkeys.h), or 0 for keys Doom does not know. */
export function doomKey(code: string): number {
  if (code in named) return named[code]
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code)
  return m ? (m[1] ? m[1].toLowerCase() : m[2]).charCodeAt(0) : 0
}
