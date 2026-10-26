import { useEffect, useState } from 'react'
import { t, type MessageKey } from '@shared/i18n'
import { useBest } from './engine'

const LEVELS = {
  easy: { cols: 9, rows: 9, mines: 10 },
  medium: { cols: 16, rows: 16, mines: 40 },
  hard: { cols: 30, rows: 16, mines: 99 }
} as const
type Level = keyof typeof LEVELS

interface Cell {
  mine: boolean
  open: boolean
  flag: boolean
  around: number
}

type Phase = 'ready' | 'playing' | 'won' | 'lost'

const blank = (n: number): Cell[] => Array.from({ length: n }, () => ({ mine: false, open: false, flag: false, around: 0 }))

function neighbours(i: number, cols: number, rows: number): number[] {
  const x = i % cols
  const y = Math.floor(i / cols)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push(ny * cols + nx)
    }
  return out
}

/** Lays the mines after the first click, keeping that cell and its neighbours clear. */
function layMines(cells: Cell[], first: number, cols: number, rows: number, mines: number): void {
  const safe = new Set([first, ...neighbours(first, cols, rows)])
  const spots = cells.map((_, i) => i).filter((i) => !safe.has(i))
  for (let k = 0; k < mines && spots.length; k++) cells[spots.splice(Math.floor(Math.random() * spots.length), 1)[0]].mine = true
  cells.forEach((c, i) => (c.around = neighbours(i, cols, rows).filter((n) => cells[n].mine).length))
}

const COLORS = ['', '#1c7ed6', '#2f9e44', '#e03131', '#5f3dc4', '#a61e4d', '#0b7285', '#000', '#868e96']

/** Classic Minesweeper: the first click is safe, right click flags, clicking a satisfied number opens around it. */
export function Minesweeper(): React.JSX.Element {
  const [level, setLevel] = useState<Level>('easy')
  const { cols, rows, mines } = LEVELS[level]
  const [cells, setCells] = useState(() => blank(cols * rows))
  const [phase, setPhase] = useState<Phase>('ready')
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const [best, offerBest] = useBest(`mines.${level}`, true)

  const restart = (l: Level = level): void => {
    setLevel(l)
    setCells(blank(LEVELS[l].cols * LEVELS[l].rows))
    setPhase('ready')
    setNow(0)
  }

  useEffect(() => {
    if (phase !== 'playing') return
    const timer = setInterval(() => setNow(Math.floor((Date.now() - started) / 1000)), 250)
    return () => clearInterval(timer)
  }, [phase, started])

  /** Opens cells (flood-filling zeros) on a copy; returns whether a mine went off. */
  const open = (next: Cell[], start: number[]): boolean => {
    const todo = [...start]
    let boom = false
    while (todo.length) {
      const i = todo.pop()!
      const c = next[i]
      if (c.open || c.flag) continue
      c.open = true
      if (c.mine) boom = true
      else if (c.around === 0) todo.push(...neighbours(i, cols, rows))
    }
    return boom
  }

  const finish = (next: Cell[], boom: boolean, since = started): void => {
    if (boom) {
      next.forEach((c) => c.mine && !c.flag && (c.open = true))
      setPhase('lost')
    } else if (next.every((c) => c.mine || c.open)) {
      next.forEach((c) => c.mine && (c.flag = true))
      setPhase('won')
      offerBest(Math.max(1, Math.round((Date.now() - since) / 1000)))
    }
    setCells(next)
  }

  const click = (i: number): void => {
    if (phase === 'won' || phase === 'lost') return
    const next = cells.map((c) => ({ ...c }))
    const since = phase === 'ready' ? Date.now() : started
    if (phase === 'ready') {
      layMines(next, i, cols, rows, mines)
      setPhase('playing')
      setStarted(since)
    }
    const c = next[i]
    if (c.flag) return
    // Chord: a number whose flags are all placed opens the rest around it.
    if (c.open) {
      const around = neighbours(i, cols, rows)
      if (c.around === 0 || around.filter((n) => next[n].flag).length !== c.around) return
      return finish(next, open(next, around), since)
    }
    finish(next, open(next, [i]), since)
  }

  const flag = (i: number, e: React.MouseEvent): void => {
    e.preventDefault()
    if (phase !== 'playing' || cells[i].open) return
    setCells(cells.map((c, k) => (k === i ? { ...c, flag: !c.flag } : c)))
  }

  const flags = cells.filter((c) => c.flag).length
  const face = phase === 'won' ? '😎' : phase === 'lost' ? '😵' : '🙂'

  return (
    <div className="game mines">
      <div className="game-scores">
        <select value={level} onChange={(e) => restart(e.target.value as Level)}>
          {(Object.keys(LEVELS) as Level[]).map((l) => (
            <option key={l} value={l}>
              {t(`games.mines.${l}` as MessageKey)}
            </option>
          ))}
        </select>
        <span>💣 {mines - flags}</span>
        <button className="mines-face" title={t('games.restart')} onClick={() => restart()}>
          {face}
        </button>
        <span>⏱ {now}</span>
        <span>{t('games.bestTime', { n: best || '–' })}</span>
      </div>
      <div className="game-stage">
        <div className="mines-grid" style={{ gridTemplateColumns: `repeat(${cols}, 20px)` }} onContextMenu={(e) => e.preventDefault()}>
          {cells.map((c, i) => (
            <button
              key={i}
              className={`mines-cell${c.open ? ' open' : ''}${c.open && c.mine ? ' boom' : ''}`}
              style={c.open && c.around && !c.mine ? { color: COLORS[c.around] } : undefined}
              onClick={() => click(i)}
              onContextMenu={(e) => flag(i, e)}
            >
              {c.open ? (c.mine ? '💣' : c.around || '') : c.flag ? '🚩' : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="game-hint">{t('games.hint.mines')}</div>
    </div>
  )
}
