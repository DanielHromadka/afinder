// doom.html, inside an iframe of the Games panel: receives the engine and the WAD as bytes, runs the frame
// loop and takes the keyboard while focused. Losing focus or a hidden panel pauses it behind a veil.

import { doomKey } from '@shared/doom'
import type { DoomFrameIn, DoomFrameOut } from './protocol'
import { startDoom, type Doom } from './runtime'
import { WasiExit } from './wasi'

const canvas = document.querySelector('canvas')!
const veil = document.getElementById('veil')!
const ctx = canvas.getContext('2d')!
let doom: Doom | null = null
let image: ImageData | null = null
let hidden = false
let last = 0
let frame = 0
let clickText = ''
const held = new Set<number>()

const post = (message: DoomFrameOut): void => window.parent.postMessage(message, '*')

const running = (): boolean => !!doom && !hidden && document.hasFocus()

function loop(now: number): void {
  frame = 0
  if (!doom || !running()) return
  try {
    doom.tick(now - last)
    last = now
    image!.data.set(doom.frame())
    ctx.putImageData(image!, 0, 0)
  } catch (e) {
    end(e)
    return
  }
  frame = requestAnimationFrame(loop)
}

function update(): void {
  const play = running()
  veil.hidden = play || !doom
  veil.textContent = clickText
  if (play && !frame) {
    last = performance.now()
    frame = requestAnimationFrame(loop)
  }
  if (!play) {
    // Keys held when focus left would stay down forever.
    for (const k of held) doom?.key(false, k)
    held.clear()
  }
}

function end(e: unknown): void {
  doom = null
  veil.hidden = true
  post({ type: 'ended', error: e instanceof WasiExit && e.code === 0 ? undefined : String(e instanceof Error ? e.message : e) })
}

window.addEventListener('message', async (e: MessageEvent<DoomFrameIn>) => {
  if (e.source !== window.parent) return
  const m = e.data
  if (m.type === 'start') {
    clickText = m.clickToPlay
    try {
      doom = await startDoom(m.wasm, new Uint8Array(m.wad))
      canvas.width = doom.width
      canvas.height = doom.height
      image = ctx.createImageData(doom.width, doom.height)
      post({ type: 'running' })
      window.focus()
    } catch (err) {
      end(err)
    }
  } else if (m.type === 'visible') hidden = !m.visible
  update()
})

const handle = (pressed: boolean) => (e: KeyboardEvent) => {
  // Cmd shortcuts belong to the app (close tab, quit…).
  if (!doom || e.metaKey) return
  const key = doomKey(e.code)
  if (!key) return
  e.preventDefault()
  if (pressed && e.repeat) return
  if (pressed) held.add(key)
  else held.delete(key)
  doom.key(pressed, key)
}
window.addEventListener('keydown', handle(true))
window.addEventListener('keyup', handle(false))
window.addEventListener('focus', update)
window.addEventListener('blur', update)
veil.addEventListener('pointerdown', () => window.focus())
post({ type: 'loaded' })
