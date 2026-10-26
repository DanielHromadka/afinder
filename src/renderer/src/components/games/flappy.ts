import type { CanvasGame } from './engine'

const W = 288
const H = 384
const GROUND = H - 24
const BIRD_X = 70
const R = 9
const PIPE_W = 44
const GAP = 108
const SPACING = 160

interface State {
  y: number
  vy: number
  pipes: { x: number; top: number; passed: boolean }[]
  passed: number
  t: number
}

const newPipe = (x: number): State['pipes'][number] => ({ x, top: 40 + Math.random() * (GROUND - GAP - 80), passed: false })
const flap = (s: State): void => void (s.vy = -5.2)

export const flappy: CanvasGame<State> = {
  width: W,
  height: H,
  tick: 16,
  init: () => ({ y: H / 2 - 40, vy: -3, pipes: [newPipe(W + 40), newPipe(W + 40 + SPACING)], passed: 0, t: 0 }),
  key(s, code) {
    if (code !== 'Space' && code !== 'ArrowUp' && code !== 'KeyW') return false
    flap(s)
    return true
  },
  pointer: flap,
  step(s) {
    s.t++
    s.vy = Math.min(s.vy + 0.32, 7)
    s.y += s.vy
    for (const p of s.pipes) {
      p.x -= 2
      if (!p.passed && p.x + PIPE_W < BIRD_X - R) (p.passed = true), s.passed++
    }
    if (s.pipes[0].x < -PIPE_W) s.pipes.shift(), s.pipes.push(newPipe(s.pipes[s.pipes.length - 1].x + SPACING))
    if (s.y + R >= GROUND || s.y - R <= 0) return false
    // Circle against the two rectangles of each pipe, via the nearest point.
    return !s.pipes.some((p) => {
      const nx = Math.max(p.x, Math.min(BIRD_X, p.x + PIPE_W))
      if ((nx - BIRD_X) ** 2 >= R * R) return false
      return s.y - R < p.top || s.y + R > p.top + GAP
    })
  },
  draw(ctx, s, c) {
    ctx.fillStyle = '#4caf50'
    for (const p of s.pipes) {
      ctx.fillRect(p.x, 0, PIPE_W, p.top)
      ctx.fillRect(p.x, p.top + GAP, PIPE_W, GROUND - p.top - GAP)
    }
    ctx.fillStyle = c.line
    ctx.fillRect(0, GROUND, W, H - GROUND)
    ctx.save()
    ctx.translate(BIRD_X, s.y)
    ctx.rotate(Math.max(-0.5, Math.min(1, s.vy / 8)))
    ctx.fillStyle = '#fab005'
    ctx.beginPath()
    ctx.ellipse(0, 0, R + 2, R, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(5, -3, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#000'
    ctx.fillRect(6, -4, 2, 2)
    ctx.fillStyle = '#f76707'
    ctx.fillRect(R - 1, 0, 7, 3)
    ctx.restore()
  },
  score: (s) => s.passed
}
