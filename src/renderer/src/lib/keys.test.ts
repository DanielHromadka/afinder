import { describe, expect, it } from 'vitest'
import { COMMANDS, isValidBinding } from '@shared/shortcuts'
import { createKeymap } from './keys'

const key = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}): KeyboardEvent =>
  ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent

describe('keymap', () => {
  const mac = createKeymap('darwin')
  const win = createKeymap('win32')

  it('maps Mod to ⌘ on macOS and Ctrl elsewhere', () => {
    expect(mac.is(key('KeyC', { metaKey: true }), 'copy')).toBe(true)
    expect(mac.is(key('KeyC', { ctrlKey: true }), 'copy')).toBe(false)
    expect(win.is(key('KeyC', { ctrlKey: true }), 'copy')).toBe(true)
    expect(win.is(key('KeyC', { metaKey: true }), 'copy')).toBe(false)
  })

  it('requires the exact modifiers', () => {
    expect(mac.is(key('KeyF', { metaKey: true, altKey: true }), 'filter')).toBe(false)
    expect(mac.is(key('KeyF', { metaKey: true, altKey: true }), 'recursive')).toBe(true)
  })

  it('uses Explorer conventions on Windows', () => {
    expect(win.is(key('Delete'), 'trash')).toBe(true)
    expect(win.is(key('ArrowLeft', { altKey: true }), 'back')).toBe(true)
    expect(win.is(key('PageDown', { ctrlKey: true }), 'nextTab')).toBe(true)
  })

  it('formats labels', () => {
    expect(mac.label('newFolder')).toBe('⇧⌘N')
    expect(win.label('newFolder')).toBe('Ctrl+Shift+N')
    expect(mac.label('trash')).toBe('⌘⌫')
    expect(win.label('trash')).toBe('Del')
    expect(win.label('up')).toBe('Alt+↑')
  })

  it('reads tab digits', () => {
    expect(mac.tabDigit(key('Digit3', { metaKey: true }))).toBe(3)
    expect(win.tabDigit(key('Digit3', { ctrlKey: true }))).toBe(3)
    expect(win.tabDigit(key('Digit3', { metaKey: true }))).toBe(0)
  })

  it('applies user shortcuts over the defaults', () => {
    const custom = createKeymap('darwin', { copy: ['Ctrl+Mod+KeyC'], paste: [] })
    expect(custom.is(key('KeyC', { metaKey: true }), 'copy')).toBe(false)
    expect(custom.is(key('KeyC', { metaKey: true, ctrlKey: true }), 'copy')).toBe(true)
    expect(custom.label('paste')).toBe('')
    expect(custom.label('cut')).toBe('⌘X')
  })

  it('records bindings from key events', () => {
    expect(mac.fromEvent(key('KeyN', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+KeyN')
    expect(win.fromEvent(key('KeyN', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+KeyN')
    expect(mac.fromEvent(key('KeyN'))).toBe(null)
    expect(win.fromEvent(key('F3'))).toBe('F3')
  })

  it('finds conflicts and reserved keys', () => {
    expect(mac.conflict('Mod+KeyC', 'paste')).toBe('copy')
    expect(mac.conflict('Mod+KeyC', 'copy')).toBe(null)
    expect(mac.conflict('Mod+Digit3', 'copy')).toBe('reserved')
    expect(mac.conflict('Mod+KeyQ', 'copy')).toBe('reserved')
    expect(win.conflict('Mod+KeyQ', 'copy')).toBe(null)
  })

  it('has only valid default bindings', () => {
    for (const map of [mac, win]) for (const c of COMMANDS) for (const b of map.defaults(c)) expect(isValidBinding(b), b).toBe(true)
  })
})
