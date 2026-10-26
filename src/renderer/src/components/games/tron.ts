import { t } from '@shared/i18n'
import type { CanvasGame } from './engine'

const COLS = 64
const ROWS = 48
const CELL = 6

type Dir = { x: number; y: number }
const KEYS: Record<string, Dir> = {
  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 }
}

interface Cycle {
  x: number
  y: number
  dir: Dir
}

interface State {
  /** 0 empty, 1 player trail, 2 computer trail. */
  grid: Uint8Array
  you: Cycle
  cpu: Cycle
  queue: Dir[]
  wins: number
  wait: number
  /** Steps of pause after a won round, so the new one does not start under the player's fingers. */
  breather: number
}

const free = (s: State, x: number, y: number): boolean => x >= 0 && y >= 0 && x < COLS && y < ROWS && s.grid[y * COLS + x] === 0

/** Free cells reachable from (x, y), up to `limit`: how much room a direction leaves. */
function room(s: State, x: number, y: number, limit = 300): number {
  if (!free(s, x, y)) return 0
  const seen = new Set([y * COLS + x])
  const todo = [[x, y]]
  while (todo.length && seen.size < limit) {
    const [cx, cy] = todo.pop()!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx
      const ny = cy + dy
      if (free(s, nx, ny) && !seen.has(ny * COLS + nx)) seen.add(ny * COLS + nx), todo.push([nx, ny])
    }
  }
  return seen.size
}

/** The computer keeps going while the way is open, otherwise (and now and then) takes the roomiest turn. */
function steer(s: State): void {
  const c = s.cpu
  const options = [c.dir, { x: c.dir.y, y: -c.dir.x }, { x: -c.dir.y, y: c.dir.x }]
  const ahead = free(s, c.x + c.dir.x, c.y + c.dir.y) && free(s, c.x + 2 * c.dir.x, c.y + 2 * c.dir.y)
  if (ahead && Math.random() > 0.06) return
  let best = c.dir
  let bestRoom = -1
  for (const d of options) {
    const r = room(s, c.x + d.x, c.y + d.y)
    if (r > bestRoom) (best = d), (bestRoom = r)
  }
  c.dir = best
}

function round(wins: number): State {
  const s: State = {
    grid: new Uint8Array(COLS * ROWS),
    you: { x: 12, y: ROWS / 2, dir: { x: 1, y: 0 } },
    cpu: { x: COLS - 13, y: ROWS / 2, dir: { x: -1, y: 0 } },
    queue: [],
    wins,
    wait: 0,
    breather: 40
  }
  s.grid[s.you.y * COLS + s.you.x] = 1
  s.grid[s.cpu.y * COLS + s.cpu.x] = 2
  return s
}

export const tron: CanvasGame<State> = {
  width: COLS * CELL,
  height: ROWS * CELL,
  tick: 16,
  init: () => round(0),
  key(s, code) {
    const d = KEYS[code]
    if (!d) return false
    const last = s.queue.at(-1) ?? s.you.dir
    if (d.x !== -last.x || d.y !== -last.y) s.queue.push(d)
    return true
  },
  step(s) {
    if (s.breather > 0) return s.breather--, true
    if (++s.wait < 4) return true
    s.wait = 0
    s.you.dir = s.queue.shift() ?? s.you.dir
    steer(s)
    const yx = s.you.x + s.you.dir.x
    const yy = s.you.y + s.you.dir.y
    const cx = s.cpu.x + s.cpu.dir.x
    const cy = s.cpu.y + s.cpu.dir.y
    const youDie = !free(s, yx, yy) || (yx === cx && yy === cy)
    const cpuDie = !free(s, cx, cy) || (yx === cx && yy === cy)
    if (youDie) return false
    s.you.x = yx
    s.you.y = yy
    s.grid[yy * COLS + yx] = 1
    if (cpuDie) {
      Object.assign(s, round(s.wins + 1))
      return true
    }
    s.cpu.x = cx
    s.cpu.y = cy
    s.grid[cy * COLS + cx] = 2
    return true
  },
  draw(ctx, s, c) {
    for (let i = 0; i < s.grid.length; i++) {
      if (!s.grid[i]) continue
      ctx.fillStyle = s.grid[i] === 1 ? c.accent : '#f76707'
      ctx.fillRect((i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL)
    }
    ctx.fillStyle = c.fg
    for (const p of [s.you, s.cpu]) ctx.fillRect(p.x * CELL - 1, p.y * CELL - 1, CELL + 2, CELL + 2)
    ctx.strokeStyle = c.line
    ctx.strokeRect(0.5, 0.5, COLS * CELL - 1, ROWS * CELL - 1)
  },
  score: (s) => s.wins,
  status: (s) => t('games.rounds', { n: s.wins })
}
