import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { previewUrl } from '@shared/preview'
import type { FileEntry } from '@shared/types'

export const SLIDE_INTERVALS = [2, 3, 5, 10, 20] as const
const INTERVAL_KEY = 'afinder.slideshow.interval'
const LOOP_KEY = 'afinder.slideshow.loop'
/** The controls fade out after the mouse has rested this long. */
const IDLE_MS = 2000

// Remembered per machine; storage may be unavailable, the defaults then apply.
function stored<T>(key: string, parse: (v: string) => T | null, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (parse(v) ?? fallback)
  } catch {
    return fallback
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // not remembered this time
  }
}

interface Props {
  images: FileEntry[]
  start: number
  onClose(): void
}

/**
 * Full-screen slideshow: images cross-fade on a timer. Space pauses, arrows step, Esc ends. The window
 * goes full screen through the HTML Fullscreen API and returns when the show ends.
 */
export function Slideshow({ images, start, onClose }: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(start)
  // The previous slide stays underneath while the new one fades in.
  const [previous, setPrevious] = useState<number | null>(null)
  const [playing, setPlaying] = useState(true)
  const [interval, setIntervalSec] = useState(() => stored(INTERVAL_KEY, (v) => (SLIDE_INTERVALS as readonly number[]).includes(Number(v)) ? Number(v) : null, 5))
  const [loop, setLoop] = useState(() => stored(LOOP_KEY, (v) => v === '1', true))
  const [idle, setIdle] = useState(false)
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const last = images.length - 1
  const go = (next: number): void => {
    const target = next > last ? (loop ? 0 : last) : next < 0 ? (loop ? last : 0) : next
    if (target === index) return
    setPrevious(index)
    setIndex(target)
  }
  const goRef = useRef(go)
  goRef.current = go

  // Advance on the timer; at the end without looping the show pauses on the last slide.
  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      if (index === last && !loop) setPlaying(false)
      else goRef.current(index + 1)
    }, interval * 1000)
    return () => clearTimeout(timer)
  }, [playing, index, interval, loop, last])

  const close = useRef(onClose)
  close.current = onClose
  // Full screen while it runs; leaving full screen (the green button, the OS) ends the show too.
  useEffect(() => {
    const el = root.current!
    el.requestFullscreen?.().catch(() => {})
    const onChange = (): void => {
      if (!document.fullscreenElement) close.current()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e) => {
    if ((e.target as HTMLElement).closest?.('select')) return
    let handled = true
    if (e.key === 'Escape') onClose()
    else if (e.key === ' ') setPlaying((p) => !p)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') go(index + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') go(index - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(last)
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => keyRef.current(e)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const wake = (): void => {
    setIdle(false)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
  }
  useEffect(() => {
    wake()
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [])

  const entry = images[index]
  const next = images[index === last ? 0 : index + 1]
  const slide = (i: number, cls: string): React.JSX.Element => {
    const e = images[i]
    return failed.has(e.path) ? (
      <div key={`${cls}${e.path}`} className={`slide ${cls} slide-failed`}>{t('slideshow.failed', { name: e.name })}</div>
    ) : (
      <img
        key={`${cls}${e.path}`}
        className={`slide ${cls}`}
        src={previewUrl(e.path)}
        alt={e.name}
        draggable={false}
        onError={() => setFailed((f) => new Set(f).add(e.path))}
        onAnimationEnd={() => cls === 'current' && setPrevious(null)}
      />
    )
  }

  return (
    // modal-backdrop: the file list ignores keys while the show is open.
    <div ref={root} className={`modal-backdrop slideshow${idle ? ' idle' : ''}`} role="dialog" aria-label={t('slideshow.title')} onMouseMove={wake} onClick={wake}>
      {previous !== null && previous !== index && slide(previous, 'previous')}
      {slide(index, 'current')}
      {/* Decoded in the background, so the next fade does not wait for the disk. */}
      {next && next !== entry && <link rel="preload" as="image" href={previewUrl(next.path)} />}
      <div className="slideshow-bar" onMouseMove={(e) => e.stopPropagation()}>
        <button className="slideshow-btn" title={`${t('preview.prev')} (←)`} disabled={!loop && index === 0} onClick={() => go(index - 1)}>
          ◀
        </button>
        <button className="slideshow-btn" title={`${t(playing ? 'slideshow.pause' : 'slideshow.play')} (␣)`} onClick={() => setPlaying((p) => !p)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="slideshow-btn" title={`${t('preview.next')} (→)`} disabled={!loop && index === last} onClick={() => go(index + 1)}>
          ▶▶
        </button>
        <span className="slideshow-name" title={entry.path}>{entry.name}</span>
        <span className="slideshow-count">
          {index + 1} / {images.length}
        </span>
        <label className="slideshow-field">
          {t('slideshow.interval')}
          <select
            value={interval}
            onChange={(e) => {
              setIntervalSec(Number(e.target.value))
              store(INTERVAL_KEY, e.target.value)
            }}
          >
            {SLIDE_INTERVALS.map((s) => (
              <option key={s} value={s}>
                {t('slideshow.seconds', { n: s })}
              </option>
            ))}
          </select>
        </label>
        <label className="slideshow-field">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => {
              setLoop(e.target.checked)
              store(LOOP_KEY, e.target.checked ? '1' : '0')
            }}
          />
          {t('slideshow.loop')}
        </label>
        <button className="slideshow-btn" title={`${t('slideshow.end')} (Esc)`} onClick={onClose}>
          ✕
        </button>
      </div>
      {playing && <div key={`${index}-${interval}`} className="slideshow-progress" style={{ animationDuration: `${interval}s` }} />}
    </div>
  )
}
