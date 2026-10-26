// A tiny fixed-step engine shared by the canvas games: start/pause/game over, keyboard focus, scaling to
// the area, theme colours and the best score. Games are plain objects with mutable state, so the loop
// never re-renders React except when the score or the phase changes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'

export interface Palette {
  bg: string
  fg: string
  accent: string
  muted: string
  line: string
}

/** What a game sees of the keyboard: keys held down right now (KeyboardEvent.code). */
export type Held = ReadonlySet<string>

export interface CanvasGame<S> {
  width: number
  height: number
  /** Milliseconds per step. */
  tick: number
  init(): S
  /** One step; returns false when the game is over. */
  step(s: S, held: Held): boolean
  draw(ctx: CanvasRenderingContext2D, s: S, c: Palette): void
  /** A key pressed while playing; true when the game used it. */
  key?(s: S, code: string): boolean
  /** A click or tap on the board while playing. */
  pointer?(s: S): void
  score(s: S): number
  /** Extra line under the board (lives, level…). */
  status?(s: S): string
}

const read = (key: string): number => {
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}
const write = (key: string, value: number): void => {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Private window or blocked storage: the best score lives for this run only.
  }
}

/** Best result kept in this browser profile; `lower` for times. */
export function useBest(id: string, lower = false): [number, (value: number) => void] {
  const key = `afinder.games.best.${id}`
  const [best, setBest] = useState(() => read(key))
  useEffect(() => setBest(read(key)), [key])
  const offer = useCallback(
    (value: number) =>
      setBest((b) => {
        const better = lower ? value > 0 && (b === 0 || value < b) : value > b
        if (!better) return b
        write(key, value)
        return value
      }),
    [key, lower]
  )
  return [best, offer]
}

/** Theme colours from the CSS variables of `el`, so the boards follow the theme. */
export function paletteOf(el: Element): Palette {
  const css = getComputedStyle(el)
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback
  return { bg: v('--list-bg', '#fff'), fg: v('--text', '#000'), accent: v('--selection', '#316ac5'), muted: v('--muted', '#7f7f7f'), line: v('--face-dark', '#aca899') }
}

type Phase = 'ready' | 'playing' | 'paused' | 'over'

const START_KEYS = new Set(['Space', 'Enter', 'NumpadEnter'])
/** Keys the games use; the page must not scroll or act on them. */
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyZ', 'KeyP'])

/** Runs one canvas game inside the Games area. */
export function GameCanvas<S>({ id, game, active, hint }: { id: string; game: CanvasGame<S>; active: boolean; hint: string }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<S>(game.init())
  const held = useRef(new Set<string>())
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState(0)
  const [status, setStatus] = useState('')
  const [best, offerBest] = useBest(id)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const draw = useCallback(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const c = paletteOf(el)
    ctx.fillStyle = c.bg
    ctx.fillRect(0, 0, game.width, game.height)
    game.draw(ctx, state.current, c)
  }, [game])

  const sync = useCallback(() => {
    setScore(game.score(state.current))
    setStatus(game.status?.(state.current) ?? '')
  }, [game])

  const start = (): void => {
    if (phaseRef.current === 'paused') return setPhase('playing')
    state.current = game.init()
    sync()
    setPhase('playing')
  }

  // The fixed-step loop runs only while playing.
  useEffect(() => {
    if (phase !== 'playing') return draw()
    let raf = 0
    let last = performance.now()
    let acc = 0
    const frame = (now: number): void => {
      acc += Math.min(now - last, 250)
      last = now
      while (acc >= game.tick) {
        acc -= game.tick
        if (!game.step(state.current, held.current)) {
          sync()
          offerBest(game.score(state.current))
          draw()
          return setPhase('over')
        }
      }
      sync()
      draw()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [phase, game, draw, sync, offerBest])

  // Hidden area or lost focus: pause, so nobody loses a game while looking at files.
  useEffect(() => {
    if (!active && phaseRef.current === 'playing') setPhase('paused')
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Keys typed into the game belong to it, not to the file list behind.
    e.stopPropagation()
    if (GAME_KEYS.has(e.code)) e.preventDefault()
    held.current.add(e.code)
    const p = phaseRef.current
    if (p === 'playing') {
      if (e.code === 'KeyP' || e.code === 'Escape') return setPhase('paused')
      if (game.key?.(state.current, e.code)) draw()
    } else if (START_KEYS.has(e.code) || (p === 'paused' && e.code === 'KeyP')) start()
  }

  const overlay = phase === 'ready' ? t('games.pressStart') : phase === 'paused' ? t('games.paused') : phase === 'over' ? t('games.over') : null

  return (
    <div className="game">
      <div className="game-scores">
        <span>{t('games.score', { n: score })}</span>
        <span>{t('games.best', { n: best })}</span>
        {status && <span>{status}</span>}
      </div>
      <div className="game-stage">
        <canvas
          ref={canvas}
          className="game-board"
          width={game.width}
          height={game.height}
          tabIndex={0}
          style={{ aspectRatio: `${game.width} / ${game.height}` }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => held.current.delete(e.code)}
          onBlur={() => (held.current.clear(), phaseRef.current === 'playing' && setPhase('paused'))}
          onMouseDown={(e) => {
            e.currentTarget.focus()
            e.preventDefault()
            if (phaseRef.current === 'playing') game.pointer?.(state.current)
            else start()
          }}
        />
        {overlay && <div className="game-overlay">{overlay}</div>}
      </div>
      <div className="game-hint">{hint}</div>
    </div>
  )
}
