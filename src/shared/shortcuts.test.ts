import { describe, expect, it } from 'vitest'
import { isValidBinding, sanitizeShortcuts } from './shortcuts'

describe('shortcut bindings', () => {
  it('accepts modified keys and the few keys that may stand alone', () => {
    expect(isValidBinding('Mod+Shift+KeyN')).toBe(true)
    expect(isValidBinding('Ctrl+Mod+KeyT')).toBe(true)
    expect(isValidBinding('F2')).toBe(true)
    expect(isValidBinding('Space')).toBe(true)
  })

  it('rejects keys that would swallow typing and malformed bindings', () => {
    expect(isValidBinding('KeyA')).toBe(false)
    expect(isValidBinding('Shift+KeyA')).toBe(false)
    expect(isValidBinding('Mod+Mod+KeyA')).toBe(false)
    expect(isValidBinding('Super+KeyA')).toBe(false)
    expect(isValidBinding('Mod+ShiftLeft')).toBe(false)
    expect(isValidBinding(42)).toBe(false)
  })

  it('keeps only known commands and valid bindings', () => {
    expect(sanitizeShortcuts({ copy: ['Mod+KeyC', 'KeyC', 'Mod+KeyC'], nope: ['F3'], paste: [] })).toEqual({ copy: ['Mod+KeyC'], paste: [] })
    expect(sanitizeShortcuts(null)).toEqual({})
  })
})
