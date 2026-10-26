import type { CanvasGame } from './engine'

const COLS = 24
const ROWS = 18
const CELL = 16

type Point = { x: number; y: number }
const DIRS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 }
}

interface State {
  body: Point[]
  dir: Point
  /** Turns typed between two steps, so a quick "up, left" is not lost or reversed. */
  queue: Point[]
  food: Point
  eaten: number
  wait: number
}

function placeFood(body: Point[]): Point {
  for (;;) {
    const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }
    if (!body.some((b) => b.x === p.x && b.y === p.y)) return p
  }
}

/** Steps every 120 ms at first, a little faster with every 5 bites. */
const speed = (eaten: number): number => Math.max(3, 8 - Math.floor(eaten / 5))

export const snake: CanvasGame<State> = {
  width: COLS * CELL,
  height: ROWS * CELL,
  tick: 15,
  init() {
    const body = [{ x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }]
    return { body, dir: { x: 1, y: 0 }, queue: [], food: placeFood(body), eaten: 0, wait: 0 }
  },
  key(s, code) {
    const d = DIRS[code]
    if (!d) return false
    const last = s.queue.at(-1) ?? s.dir
    if (d.x !== -last.x || d.y !== -last.y) s.queue.push(d)
    return true
  },
  step(s) {
    if (++s.wait < speed(s.eaten)) return true
    s.wait = 0
    s.dir = s.queue.shift() ?? s.dir
    const head = { x: s.body[0].x + s.dir.x, y: s.body[0].y + s.dir.y }
    const grows = head.x === s.food.x && head.y === s.food.y
    // The tail moves away this step unless the snake grows, so it is not in the way.
    const rest = grows ? s.body : s.body.slice(0, -1)
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS || rest.some((b) => b.x === head.x && b.y === head.y)) return false
    s.body = [head, ...rest]
    if (grows) {
      s.eaten++
      s.food = placeFood(s.body)
    }
    return true
  },
  draw(ctx, s, c) {
    ctx.fillStyle = '#e5484d'
    ctx.beginPath()
    ctx.arc(s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2)
    ctx.fill()
    s.body.forEach((b, i) => {
      ctx.fillStyle = i === 0 ? c.fg : c.accent
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + 1, CELL - 2, CELL - 2)
    })
  },
  score: (s) => s.eaten
}
