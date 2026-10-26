import { t } from '@shared/i18n'
import type { CanvasGame } from './engine'

const COLS = 10
const ROWS = 20
const CELL = 16
const SIDE = 6 * CELL

/** The seven tetrominoes as 4×4 masks of their spawn rotation, with their usual colours. */
const SHAPES: { cells: [number, number][]; color: string }[] = [
  { cells: [[0, 1], [1, 1], [2, 1], [3, 1]], color: '#22b8cf' },
  { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: '#4263eb' },
  { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: '#f08c00' },
  { cells: [[1, 0], [2, 0], [1, 1], [2, 1]], color: '#fab005' },
  { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: '#40c057' },
  { cells: [[1, 0], [0, 1], [1, 1], [2, 1]], color: '#ae3ec9' },
  { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: '#fa5252' }
]

interface Piece {
  kind: number
  cells: [number, number][]
  x: number
  y: number
}

interface State {
  board: (string | null)[][]
  piece: Piece
  next: number
  bag: number[]
  lines: number
  points: number
  fall: number
}

const level = (s: State): number => 1 + Math.floor(s.lines / 10)
/** Steps (16 ms) per row: 48 at level 1, down to 3. */
const gravity = (s: State): number => Math.max(3, 48 - (level(s) - 1) * 5)

function draw7(s: State): number {
  if (s.bag.length === 0) s.bag = [0, 1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5)
  return s.bag.pop()!
}

const spawn = (kind: number): Piece => ({ kind, cells: SHAPES[kind].cells.map(([x, y]) => [x, y] as [number, number]), x: 3, y: 0 })

function fits(s: State, cells: [number, number][], x: number, y: number): boolean {
  return cells.every(([cx, cy]) => {
    const bx = x + cx
    const by = y + cy
    return bx >= 0 && bx < COLS && by < ROWS && (by < 0 || !s.board[by][bx])
  })
}

/** Rotates clockwise inside the 4×4 box (the O piece stays put); tries small kicks off walls. */
function rotate(s: State): void {
  const p = s.piece
  if (p.kind === 3) return
  const size = p.kind === 0 ? 4 : 3
  const cells = p.cells.map(([x, y]) => [size - 1 - y, x] as [number, number])
  for (const dx of [0, -1, 1, -2, 2]) {
    if (fits(s, cells, p.x + dx, p.y)) {
      p.cells = cells
      p.x += dx
      return
    }
  }
}

/** Locks the piece, clears lines, spawns the next; false when the next one has no room. */
function lock(s: State): boolean {
  const p = s.piece
  for (const [x, y] of p.cells) if (p.y + y >= 0) s.board[p.y + y][p.x + x] = SHAPES[p.kind].color
  const kept = s.board.filter((row) => row.some((c) => !c))
  const cleared = ROWS - kept.length
  if (cleared) {
    s.points += [0, 100, 300, 500, 800][cleared] * level(s)
    s.lines += cleared
    s.board = [...Array.from({ length: cleared }, () => Array<string | null>(COLS).fill(null)), ...kept]
  }
  s.piece = spawn(s.next)
  s.next = draw7(s)
  return fits(s, s.piece.cells, s.piece.x, s.piece.y)
}

function cell(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2)
}

export const tetris: CanvasGame<State> = {
  width: COLS * CELL + SIDE,
  height: ROWS * CELL,
  tick: 16,
  init() {
    const s = { board: Array.from({ length: ROWS }, () => Array<string | null>(COLS).fill(null)), bag: [], lines: 0, points: 0, fall: 0 } as unknown as State
    s.piece = spawn(draw7(s))
    s.next = draw7(s)
    return s
  },
  key(s, code) {
    const p = s.piece
    if (code === 'ArrowLeft' || code === 'KeyA') return fits(s, p.cells, p.x - 1, p.y) && p.x--, true
    if (code === 'ArrowRight' || code === 'KeyD') return fits(s, p.cells, p.x + 1, p.y) && p.x++, true
    if (code === 'ArrowUp' || code === 'KeyW' || code === 'KeyX') return rotate(s), true
    if (code === 'ArrowDown' || code === 'KeyS') {
      if (fits(s, p.cells, p.x, p.y + 1)) (p.y++, (s.points += 1))
      s.fall = 0
      return true
    }
    if (code === 'Space') {
      while (fits(s, p.cells, p.x, p.y + 1)) (p.y++, (s.points += 2))
      s.fall = gravity(s)
      return true
    }
    return false
  },
  step(s) {
    if (++s.fall < gravity(s)) return true
    s.fall = 0
    const p = s.piece
    if (fits(s, p.cells, p.x, p.y + 1)) return p.y++, true
    return lock(s)
  },
  draw(ctx, s, c) {
    s.board.forEach((row, y) => row.forEach((color, x) => color && cell(ctx, x * CELL, y * CELL, color)))
    // Ghost: where a hard drop would land.
    const p = s.piece
    let gy = p.y
    while (fits(s, p.cells, p.x, gy + 1)) gy++
    ctx.globalAlpha = 0.25
    for (const [x, y] of p.cells) cell(ctx, (p.x + x) * CELL, (gy + y) * CELL, SHAPES[p.kind].color)
    ctx.globalAlpha = 1
    for (const [x, y] of p.cells) if (p.y + y >= 0) cell(ctx, (p.x + x) * CELL, (p.y + y) * CELL, SHAPES[p.kind].color)
    ctx.fillStyle = c.line
    ctx.fillRect(COLS * CELL, 0, 1, ROWS * CELL)
    ctx.fillStyle = c.muted
    ctx.font = '11px sans-serif'
    ctx.fillText(t('games.next'), COLS * CELL + 12, 18)
    for (const [x, y] of SHAPES[s.next].cells) cell(ctx, COLS * CELL + 12 + x * CELL, 28 + y * CELL, SHAPES[s.next].color)
  },
  score: (s) => s.points,
  status: (s) => `${t('games.level', { n: level(s) })} · ${t('games.lines', { n: s.lines })}`
}
