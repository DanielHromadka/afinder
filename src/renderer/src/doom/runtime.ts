// Runs doom.wasm on the WASI shim: game time only moves while the host ticks it, a tick happens only when a
// Doom tic (1/35 s) is due, and the XRGB frame is converted to RGBA for a canvas. No DOM here.

import { DOOM_WAD } from '@shared/doom'
import { Wasi } from './wasi'

const TIC_MS = 1000 / 35
/** A hitch (a hidden window, a long frame) plays at most this much game time instead of fast-forwarding. */
const MAX_STEP_MS = 100

interface Exports {
  memory: WebAssembly.Memory
  _initialize(): void
  dg_start(): void
  dg_tick(): void
  dg_key(pressed: number, key: number): void
  dg_screen(): number
  dg_width(): number
  dg_height(): number
}

export interface Doom {
  width: number
  height: number
  /** Advances the game by `elapsed` real milliseconds. */
  tick(elapsed: number): void
  key(pressed: boolean, key: number): void
  /** The current frame as RGBA, reused between calls. */
  frame(): Uint8ClampedArray
}

export async function startDoom(wasm: BufferSource, wad: Uint8Array, log?: (line: string) => void): Promise<Doom> {
  const wasi = new Wasi(log)
  wasi.addFile(DOOM_WAD, wad)
  const { instance } = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi.imports as WebAssembly.ModuleImports })
  const x = instance.exports as unknown as Exports
  wasi.bind(x.memory)
  x._initialize()
  x.dg_start()
  const width = x.dg_width(), height = x.dg_height()
  const rgba = new Uint8ClampedArray(width * height * 4)
  let time = 0, tic = 0
  return {
    width,
    height,
    tick(elapsed) {
      time += Math.min(Math.max(0, elapsed), MAX_STEP_MS)
      const due = Math.floor(time / TIC_MS)
      if (due <= tic) return
      tic = due
      wasi.setTime(time)
      x.dg_tick()
    },
    key: (pressed, key) => key && x.dg_key(pressed ? 1 : 0, key),
    frame() {
      // The memory may have grown since the last frame, so the view is taken fresh.
      const src = new Uint8Array(x.memory.buffer, x.dg_screen(), width * height * 4)
      for (let i = 0; i < src.length; i += 4) {
        rgba[i] = src[i + 2]
        rgba[i + 1] = src[i + 1]
        rgba[i + 2] = src[i]
        rgba[i + 3] = 255
      }
      return rgba
    }
  }
}
