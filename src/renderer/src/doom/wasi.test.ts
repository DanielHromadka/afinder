import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { doomKey, DOOM_WAD } from '@shared/doom'
import { resolvePath, Wasi, WasiExit } from './wasi'
import { startDoom } from './runtime'

type Fn = (...args: unknown[]) => number

/** Calls the shim the way wasm would: arguments are pointers into `memory`. */
function host(): { wasi: Wasi; mem: Uint8Array; view: DataView; call(name: string, ...args: unknown[]): number; str(at: number, s: string): number } {
  const wasi = new Wasi()
  const memory = new WebAssembly.Memory({ initial: 1 })
  wasi.bind(memory)
  const mem = new Uint8Array(memory.buffer)
  return {
    wasi,
    mem,
    view: new DataView(memory.buffer),
    call: (name, ...args) => (wasi.imports[name] as unknown as Fn)(...args),
    str: (at, s) => (mem.set(new TextEncoder().encode(s), at), s.length)
  }
}

describe('wasi shim', () => {
  it('resolves paths inside the preopen only', () => {
    expect(resolvePath('', './a/b/../c.wad')).toBe('a/c.wad')
    expect(resolvePath('saves', 'x.dsg')).toBe('saves/x.dsg')
    expect(resolvePath('', '../etc/passwd')).toBeNull()
  })

  it('writes, seeks and reads back a file', () => {
    const h = host()
    const len = h.str(100, 'save.dsg')
    expect(h.call('path_open', 3, 0, 100, len, 1 | 8, 1n << 6n, 0n, 0, 200)).toBe(0)
    const fd = h.view.getUint32(200, true)
    h.str(300, 'hello')
    h.view.setUint32(400, 300, true)
    h.view.setUint32(404, 5, true)
    expect(h.call('fd_write', fd, 400, 1, 500)).toBe(0)
    expect(h.view.getUint32(500, true)).toBe(5)
    expect(h.call('fd_seek', fd, 1n, 0, 600)).toBe(0)
    h.view.setUint32(404, 10, true)
    h.view.setUint32(400, 700, true)
    expect(h.call('fd_read', fd, 400, 1, 500)).toBe(0)
    expect(h.view.getUint32(500, true)).toBe(4)
    expect(new TextDecoder().decode(h.mem.subarray(700, 704))).toBe('ello')
    expect(h.call('fd_close', fd)).toBe(0)
    expect(new TextDecoder().decode(h.wasi.files.get('save.dsg'))).toBe('hello')
  })

  it('keeps added files read-only and reports missing ones', () => {
    const h = host()
    h.wasi.addFile('game.wad', new Uint8Array([1, 2, 3]))
    let len = h.str(100, 'game.wad')
    expect(h.call('path_open', 3, 0, 100, len, 8, 1n << 6n, 0n, 0, 200)).toBe(2)
    expect(h.call('path_unlink_file', 3, 100, len)).toBe(2)
    len = h.str(100, 'none.cfg')
    expect(h.call('path_open', 3, 0, 100, len, 0, 0n, 0n, 0, 200)).toBe(44)
  })

  it('holds the clock at the host time but lets a busy-wait finish', () => {
    const h = host()
    const read = (): bigint => (h.call('clock_time_get', 1, 0n, 800), h.view.getBigUint64(800, true))
    h.wasi.setTime(40)
    expect(read()).toBe(40_000_000n)
    expect(read()).toBe(40_000_000n)
    for (let i = 0; i < 2000; i++) read()
    expect(read()).toBeGreaterThan(40_000_000n)
    expect(() => h.call('proc_exit', 3)).toThrow(WasiExit)
  })

  it('maps keyboard codes to Doom keys', () => {
    expect(doomKey('ArrowUp')).toBe(0xad)
    expect(doomKey('ControlLeft')).toBe(0xa3)
    expect(doomKey('KeyY')).toBe(121)
    expect(doomKey('Digit3')).toBe(51)
    expect(doomKey('MetaLeft')).toBe(0)
  })
})

// AFINDER_DOOM_DIR=doom/out runs the real engine with Freedoom for a few seconds of game time.
const dir = process.env.AFINDER_DOOM_DIR
describe.runIf(dir && existsSync(path.join(dir, 'doom.wasm')))('doom.wasm', () => {
  it('boots Freedoom and draws frames', async () => {
    const lines: string[] = []
    const doom = await startDoom(readFileSync(path.join(dir!, 'doom.wasm')), readFileSync(path.join(dir!, DOOM_WAD)), (l) => lines.push(l))
    let lit = 0
    for (let i = 0; i < 200; i++) {
      doom.tick(1000 / 35)
      lit = doom.frame().reduce((n, px, j) => (j % 4 === 3 ? n : n + (px > 0 ? 1 : 0)), 0)
    }
    expect(lines.join('\n')).toMatch(/Freedoom/)
    expect(lit).toBeGreaterThan(1000)
    expect(doom.width * doom.height).toBe(64000)
  }, 60000)
})
