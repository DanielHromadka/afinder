import { describe, expect, it } from 'vitest'
import { helperCommand, KeyMapper, Mod, parseInput, screenPoint, swapCmdCtrl, type InputEvent } from './input'

const key = (code: string, k: string, d: boolean, m = 0): Extract<InputEvent, { t: 'key' }> => ({ t: 'key', code, key: k, d, m })

describe('parseInput', () => {
  it('accepts well-formed events', () => {
    expect(parseInput('{"t":"move","x":0.5,"y":1}')).toEqual({ t: 'move', x: 0.5, y: 1 })
    expect(parseInput({ t: 'button', b: 'right', d: true })).toEqual({ t: 'button', b: 'right', d: true })
    expect(parseInput({ t: 'scroll', x: 0, y: 2.4 })).toEqual({ t: 'scroll', x: 0, y: 2 })
    expect(parseInput({ t: 'key', code: 'KeyA', key: 'a', d: true, m: 0 })).toEqual(key('KeyA', 'a', true))
    expect(parseInput({ t: 'release' })).toEqual({ t: 'release' })
  })

  it('refuses anything else', () => {
    expect(parseInput('not json')).toBeNull()
    expect(parseInput({ t: 'move', x: 2, y: 0 })).toBeNull()
    expect(parseInput({ t: 'button', b: 'back', d: true })).toBeNull()
    expect(parseInput({ t: 'key', code: 'KeyA', key: 'a', d: true, m: 99 })).toBeNull()
    expect(parseInput({ t: 'exec', cmd: 'rm' })).toBeNull()
    expect(parseInput(null)).toBeNull()
  })

  it('caps scrolling', () => expect(parseInput({ t: 'scroll', x: -1e9, y: 0 })).toEqual({ t: 'scroll', x: -50, y: 0 }))
})

describe('KeyMapper', () => {
  it('types characters as text and skips their release', () => {
    const k = new KeyMapper()
    expect(k.map(key('Digit2', 'ě', true))).toEqual({ t: 'text', s: 'ě' })
    expect(k.map(key('Digit2', 'ě', false))).toBeNull()
    expect(k.map(key('KeyA', 'A', true, Mod.Shift))).toEqual({ t: 'text', s: 'A' })
  })

  it('sends shortcuts and named keys as keys', () => {
    const k = new KeyMapper()
    expect(k.map(key('KeyC', 'c', true, Mod.Ctrl))).toEqual({ t: 'key', c: 'c', d: true })
    expect(k.map(key('KeyC', 'c', false, Mod.Ctrl))).toEqual({ t: 'key', c: 'c', d: false })
    expect(k.map(key('KeyV', 'v', true, Mod.Meta))).toEqual({ t: 'key', c: 'v', d: true })
    expect(k.map(key('Enter', 'Enter', true))).toEqual({ t: 'key', k: 'Return', d: true })
    expect(k.map(key('ShiftLeft', 'Shift', true, Mod.Shift))).toEqual({ t: 'key', k: 'Shift', d: true })
    expect(k.map(key('Space', ' ', true, Mod.Ctrl))).toEqual({ t: 'key', k: 'Space', d: true })
    expect(k.map(key('KeyF', 'f', true, Mod.Alt))).toEqual({ t: 'key', c: 'f', d: true })
  })

  it('types AltGr and Option characters', () => {
    const k = new KeyMapper()
    expect(k.map(key('KeyV', '@', true, Mod.Ctrl | Mod.Alt))).toEqual({ t: 'text', s: '@' })
    expect(k.map(key('KeyG', '©', true, Mod.Alt))).toEqual({ t: 'text', s: '©' })
    expect(k.map(key('KeyT', 't', true, Mod.Ctrl | Mod.Alt))).toEqual({ t: 'key', c: 't', d: true })
  })

  it('types a plain space as text', () => expect(new KeyMapper().map(key('Space', ' ', true))).toEqual({ t: 'text', s: ' ' }))
})

describe('swapCmdCtrl', () => {
  it('trades Cmd and Ctrl', () => {
    expect(swapCmdCtrl(key('KeyC', 'c', true, Mod.Meta | Mod.Shift))).toEqual(key('KeyC', 'c', true, Mod.Ctrl | Mod.Shift))
    expect(swapCmdCtrl(key('MetaLeft', 'Meta', true, Mod.Meta))).toEqual(key('ControlLeft', 'Control', true, Mod.Ctrl))
  })
})

describe('screenPoint', () => {
  const d = { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 }
  it('uses points on macOS', () => expect(screenPoint(d, 0.5, 0.5, 'darwin')).toEqual({ x: 2400, y: 540 }))
  it('uses physical pixels on Linux', () => expect(screenPoint(d, 0, 0, 'linux')).toEqual({ x: 2880, y: 0 }))
  it('asks Electron on Windows', () => expect(screenPoint(d, 0, 0, 'win32', (p) => ({ x: p.x * 3, y: p.y }))).toEqual({ x: 4320, y: 0 }))
  it('stays on the monitor at its far edge', () => expect(screenPoint(d, 1, 1, 'darwin')).toEqual({ x: 3360, y: 1080 }))
})

describe('helperCommand', () => {
  it('maps moves through the point function and drops empty scrolls', () => {
    const k = new KeyMapper()
    expect(helperCommand({ t: 'move', x: 0.5, y: 0.25 }, k, (x, y) => ({ x: x * 100, y: y * 100 }))).toEqual({ t: 'move', x: 50, y: 25 })
    expect(helperCommand({ t: 'scroll', x: 0, y: 0 }, k, () => ({ x: 0, y: 0 }))).toBeNull()
  })
})
