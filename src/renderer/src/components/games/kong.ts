import { t } from '@shared/i18n'
import type { CanvasGame, Held } from './engine'

// A small Donkey Kong: flat girders joined by ladders, barrels rolling down from the top, jump over them
// and climb to the top girder.

const W = 320
const H = 360

/** Girders bottom-up: the y of their top surface and their span. Barrels roll right on even ones. */
const FLOORS = [
  { y: 344, from: 0, to: 320 },
  { y: 284, from: 20, to: 320 },
  { y: 224, from: 0, to: 300 },
  { y: 164, from: 20, to: 320 },
  { y: 104, from: 0, to: 300 },
  { y: 50, from: 120, to: 200 }
]
/** Ladders as [lower girder index, x]; each reaches the girder above. */
const LADDERS: [number, number][] = [
  [0, 250], [0, 120],
  [1, 70], [1, 200],
  [2, 260], [2, 140],
  [3, 60], [3, 230],
  [4, 180]
]
const TOP = FLOORS.length - 1

interface Barrel {
  x: number
  y: number
  floor: number
  mode: 'roll' | 'fall' | 'ladder'
  vy: number
  scored: boolean
  /** The ladder it already decided about, so it does not roll the dice every step on it. */
  passed: number
}

interface State {
  x: number
  y: number
  vy: number
  floor: number
  climbing: number | null
  air: boolean
  barrels: Barrel[]
  spawn: number
  lives: number
  level: number
  points: number
  /** Steps of invulnerable pause after losing a life. */
  hurt: number
}

const rollsRight = (floor: number): boolean => floor % 2 === 0
const near = (a: number, b: number, d: number): boolean => Math.abs(a - b) <= d

function reset(s: State): void {
  Object.assign(s, { x: 30, y: FLOORS[0].y, vy: 0, floor: 0, climbing: null, air: false, barrels: [], spawn: 60 })
}

function ladderAt(x: number, floor: number, up: boolean): number | null {
  const i = LADDERS.findIndex(([f, lx]) => f === (up ? floor : floor - 1) && near(x, lx, 6))
  return i < 0 ? null : i
}

function movePlayer(s: State, held: Held): void {
  const left = held.has('ArrowLeft') || held.has('KeyA')
  const right = held.has('ArrowRight') || held.has('KeyD')
  const up = held.has('ArrowUp') || held.has('KeyW')
  const down = held.has('ArrowDown') || held.has('KeyS')
  if (s.climbing !== null) {
    const [lower, lx] = LADDERS[s.climbing]
    s.x = lx
    if (up) s.y -= 1.3
    if (down) s.y += 1.3
    if (s.y <= FLOORS[lower + 1].y) (s.y = FLOORS[lower + 1].y), (s.floor = lower + 1), (s.climbing = null)
    else if (s.y >= FLOORS[lower].y) (s.y = FLOORS[lower].y), (s.floor = lower), (s.climbing = null)
    return
  }
  const f = FLOORS[s.floor]
  if (left) s.x -= 1.6
  if (right) s.x += 1.6
  s.x = Math.max(f.from + 6, Math.min(f.to - 6, s.x))
  if (s.air) {
    s.vy += 0.2
    s.y += s.vy
    if (s.y >= f.y) (s.y = f.y), (s.air = false), (s.vy = 0)
    return
  }
  const ladder = up ? ladderAt(s.x, s.floor, true) : down ? ladderAt(s.x, s.floor, false) : null
  if (ladder !== null) s.climbing = ladder
}

function moveBarrel(b: Barrel, speed: number): boolean {
  if (b.mode === 'fall') {
    b.vy += 0.2
    b.y += b.vy
    if (b.y >= FLOORS[b.floor].y) (b.y = FLOORS[b.floor].y), (b.mode = 'roll'), (b.vy = 0)
    return true
  }
  if (b.mode === 'ladder') {
    b.y += 1.4
    if (b.y >= FLOORS[b.floor].y) (b.y = FLOORS[b.floor].y), (b.mode = 'roll')
    return true
  }
  const f = FLOORS[b.floor]
  b.x += rollsRight(b.floor) ? speed : -speed
  // Now and then a barrel takes a ladder down instead of rolling past it.
  const ladder = LADDERS.findIndex(([lower, lx]) => lower === b.floor - 1 && near(b.x, lx, speed))
  if (ladder >= 0 && ladder !== b.passed) {
    b.passed = ladder
    if (Math.random() < 0.25) return (b.floor--, (b.mode = 'ladder')), true
  }
  if (b.x < f.from - 4 || b.x > f.to + 4) {
    if (b.floor === 0) return false
    b.floor--
    b.mode = 'fall'
  }
  return true
}

export const kong: CanvasGame<State> = {
  width: W,
  height: H,
  tick: 16,
  init() {
    const s = { lives: 3, level: 1, points: 0, hurt: 0 } as State
    reset(s)
    return s
  },
  key(s, code) {
    if ((code === 'Space' || code === 'KeyX' || code === 'KeyZ') && !s.air && s.climbing === null) {
      s.air = true
      s.vy = -3.4
      return true
    }
    return false
  },
  step(s, held) {
    if (s.hurt > 0) return s.hurt--, true
    movePlayer(s, held)
    if (s.floor === TOP && s.climbing === null) {
      s.points += 1000
      s.level++
      reset(s)
      return true
    }
    if (--s.spawn <= 0) {
      s.barrels.push({ x: 50, y: FLOORS[4].y, floor: 4, mode: 'roll', vy: 0, scored: false, passed: -1 })
      s.spawn = Math.max(50, 150 - s.level * 15) + Math.floor(Math.random() * 60)
    }
    const speed = 1.2 + s.level * 0.15
    s.barrels = s.barrels.filter((b) => moveBarrel(b, speed))
    for (const b of s.barrels) {
      // Feet at s.y, 14 px tall; barrels are 12 px round, sitting on b.y.
      if (near(s.x, b.x, 9) && near(s.y - 7, b.y - 6, 11)) {
        if (--s.lives <= 0) return false
        reset(s)
        s.hurt = 50
        return true
      }
      if (!b.scored && s.air && b.floor === s.floor && near(s.x, b.x, 6)) (b.scored = true), (s.points += 100)
    }
    return true
  },
  draw(ctx, s, c) {
    ctx.lineWidth = 2
    for (const [lower, x] of LADDERS) {
      const y1 = FLOORS[lower].y
      const y2 = FLOORS[lower + 1].y
      ctx.strokeStyle = c.muted
      ctx.beginPath()
      ctx.moveTo(x - 6, y1)
      ctx.lineTo(x - 6, y2)
      ctx.moveTo(x + 6, y1)
      ctx.lineTo(x + 6, y2)
      for (let y = y1 - 6; y > y2; y -= 8) ctx.moveTo(x - 6, y), ctx.lineTo(x + 6, y)
      ctx.stroke()
    }
    ctx.fillStyle = '#e5484d'
    for (const f of FLOORS) ctx.fillRect(f.from, f.y, f.to - f.from, 5)
    // Kong and the one to rescue.
    ctx.fillStyle = '#8b5a2b'
    ctx.fillRect(14, FLOORS[4].y - 30, 30, 30)
    ctx.fillStyle = '#f2c094'
    ctx.fillRect(22, FLOORS[4].y - 24, 14, 10)
    ctx.fillStyle = '#e64980'
    ctx.fillRect(150, FLOORS[TOP].y - 18, 10, 18)
    for (const b of s.barrels) {
      ctx.fillStyle = '#b5651d'
      ctx.beginPath()
      ctx.arc(b.x, b.y - 6, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    if (s.hurt % 10 < 5) {
      ctx.fillStyle = c.accent
      ctx.fillRect(s.x - 5, s.y - 14, 10, 14)
      ctx.fillStyle = c.fg
      ctx.fillRect(s.x - 5, s.y - 14, 10, 4)
    }
  },
  score: (s) => s.points,
  status: (s) => `${t('games.lives', { n: s.lives })} · ${t('games.level', { n: s.level })}`
}
