import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { useStored } from './common'

/** "1:02:03.4" (tenths only for the stopwatch). */
function clock(ms: number, tenths = false): string {
  const total = Math.max(0, ms)
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const base = `${h ? `${h}:` : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`
  return tenths ? `${base}.${Math.floor((total % 1000) / 100)}` : base
}

/** A short tone and a system notification; both work while the window is in the background. */
function alarm(body: string): void {
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.35)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.25)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.35)
      osc.stop(ctx.currentTime + i * 0.35 + 0.3)
    }
    setTimeout(() => void ctx.close(), 1500)
  } catch {
    // no audio device
  }
  try {
    new Notification('aFinder', { body })
  } catch {
    // notifications off
  }
}

/** Re-renders every `ms` while `on`. */
function useTick(on: boolean, ms: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [on, ms])
  return now
}

function Stopwatch(): React.JSX.Element {
  // Running: started at `since` with `acc` ms from earlier runs; times are wall clock, so sleeping is fine.
  const [since, setSince] = useState<number | null>(null)
  const [acc, setAcc] = useState(0)
  const [laps, setLaps] = useState<number[]>([])
  const now = useTick(since !== null, 100)
  const elapsed = acc + (since !== null ? now - since : 0)
  return (
    <div className="tool">
      <div className="timer-face">{clock(elapsed, true)}</div>
      <div className="tool-row">
        <button className="todo-btn" onClick={() => (since === null ? setSince(Date.now()) : (setAcc(elapsed), setSince(null)))}>
          {since === null ? t('tools.start') : t('tools.pause')}
        </button>
        <button className="todo-btn" disabled={since === null} onClick={() => setLaps([elapsed, ...laps])}>
          {t('tools.lap')}
        </button>
        <button className="todo-btn" onClick={() => (setSince(null), setAcc(0), setLaps([]))}>
          {t('tools.reset')}
        </button>
      </div>
      {laps.map((l, i) => (
        <div key={i} className="tool-row mono">
          <span className="tool-muted">#{laps.length - i}</span> {clock(l, true)}
          {i < laps.length - 1 && <span className="tool-muted">+{clock(l - laps[i + 1], true)}</span>}
        </div>
      ))}
    </div>
  )
}

function Countdown(): React.JSX.Element {
  const [minutes, setMinutes] = useStored('timer.minutes', 5)
  const [end, setEnd] = useState<number | null>(null)
  const [left, setLeft] = useState(minutes * 60_000)
  const now = useTick(end !== null, 250)
  const remaining = end !== null ? end - now : left
  useEffect(() => {
    if (end !== null && remaining <= 0) {
      setEnd(null)
      setLeft(minutes * 60_000)
      alarm(t('tools.timerDone'))
    }
  }, [end, remaining, minutes])
  return (
    <div className="tool">
      <div className="timer-face">{clock(remaining)}</div>
      <div className="tool-row">
        <input
          className="tool-input small"
          type="number"
          min={1}
          max={600}
          value={minutes}
          disabled={end !== null}
          onChange={(e) => {
            const m = Math.min(600, Math.max(1, Number(e.target.value) || 1))
            setMinutes(m)
            setLeft(m * 60_000)
          }}
        />
        <span>{t('tools.minutes')}</span>
        <button className="todo-btn" onClick={() => (end === null ? setEnd(Date.now() + left) : (setLeft(end - Date.now()), setEnd(null)))}>
          {end === null ? t('tools.start') : t('tools.pause')}
        </button>
        <button className="todo-btn" onClick={() => (setEnd(null), setLeft(minutes * 60_000))}>
          {t('tools.reset')}
        </button>
      </div>
    </div>
  )
}

const FOCUS_MIN = 25
const BREAK_MIN = 5
const LONG_BREAK_MIN = 15

function Pomodoro(): React.JSX.Element {
  const [phase, setPhase] = useState<'focus' | 'break'>('focus')
  const [done, setDone] = useState(0)
  const [end, setEnd] = useState<number | null>(null)
  const length = (phase === 'focus' ? FOCUS_MIN : (done % 4 === 0 ? LONG_BREAK_MIN : BREAK_MIN)) * 60_000
  const now = useTick(end !== null, 250)
  const remaining = end !== null ? end - now : length
  useEffect(() => {
    if (end === null || remaining > 0) return
    // Every fourth break is a long one.
    const next = phase === 'focus' ? 'break' : 'focus'
    const finished = phase === 'focus' ? done + 1 : done
    setDone(finished)
    setPhase(next)
    const nextLength = (next === 'focus' ? FOCUS_MIN : finished % 4 === 0 ? LONG_BREAK_MIN : BREAK_MIN) * 60_000
    setEnd(Date.now() + nextLength)
    alarm(t(next === 'focus' ? 'tools.pomodoroFocus' : 'tools.pomodoroBreak'))
  }, [end, remaining, phase, done])
  return (
    <div className="tool">
      <div className={`timer-face pomodoro-${phase}`}>{clock(remaining)}</div>
      <p className="tool-muted">
        {t(phase === 'focus' ? 'tools.pomodoroFocusing' : 'tools.pomodoroResting')} · 🍅 × {done}
      </p>
      <div className="tool-row">
        <button className="todo-btn" onClick={() => setEnd(end === null ? Date.now() + remaining : null)}>
          {end === null ? t('tools.start') : t('tools.pause')}
        </button>
        <button className="todo-btn" onClick={() => (setEnd(null), setPhase('focus'), setDone(0))}>
          {t('tools.reset')}
        </button>
      </div>
    </div>
  )
}

/** Stopwatch, countdown and pomodoro; they keep running while another tool or area is shown. */
export default function Timers(): React.JSX.Element {
  const [tab, setTab] = useStored<'stopwatch' | 'timer' | 'pomodoro'>('timers.tab', 'stopwatch')
  return (
    <div className="tool">
      <div className="todo-seg">
        {(['stopwatch', 'timer', 'pomodoro'] as const).map((k) => (
          <button key={k} className={k === tab ? 'on' : ''} onClick={() => setTab(k)}>
            {t(k === 'timer' ? 'tools.countdown' : `tools.${k}`)}
          </button>
        ))}
      </div>
      <div hidden={tab !== 'stopwatch'}>
        <Stopwatch />
      </div>
      <div hidden={tab !== 'timer'}>
        <Countdown />
      </div>
      <div hidden={tab !== 'pomodoro'}>
        <Pomodoro />
      </div>
    </div>
  )
}
