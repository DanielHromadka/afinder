import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { baseName } from '@shared/paths'
import { previewUrl } from '@shared/preview'
import type { FileEntry } from '@shared/types'
import { addCut, formatVideoTime, isUncut, keptSpans, MIN_SPAN, skipTarget, totalLength, type Span, type VideoCut } from '@shared/videoCut'
import { keys } from '../lib/keys'

type SaveState = { kind: 'idle' } | { kind: 'busy'; percent: number } | { kind: 'saved'; name: string } | { kind: 'error'; message: string }

/** What a pointer on the timeline is doing: moving one end, or selecting from where it went down. */
type Drag = { kind: 'start' | 'end' } | { kind: 'select'; anchor: number; x: number; moved: boolean }

interface Props {
  entry: FileEntry
  /** Leave the editor (back to the plain preview). */
  onExit(): void
  /** Unsaved cuts, so that closing Quick Look can ask first. */
  onDirtyChange(dirty: boolean): void
}

const keyOf = (edit: VideoCut): string => JSON.stringify(edit)

/**
 * Video cutter shown inside Quick Look: trim the start and end, cut out pieces in between, and save
 * the rest as a re-encoded copy next to the original (which stays untouched). Playback skips what
 * is cut away, so the preview plays the result.
 */
export default function VideoEditor({ entry, onExit, onDirtyChange }: Props): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [history, setHistory] = useState<{ steps: VideoCut[]; at: number } | null>(null)
  const [trimDraft, setTrimDraft] = useState<Span | null>(null)
  const [selection, setSelection] = useState<Span | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const savedKey = useRef('')
  const drag = useRef<Drag | null>(null)
  const exporting = useRef<AbortController | null>(null)

  const edit = history ? history.steps[history.at] : null
  const editRef = useRef(edit)
  editRef.current = edit
  const dirty = edit !== null && duration !== null && !isUncut(edit, duration) && keyOf(edit) !== savedKey.current
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  // Leaving mid-save stops the encoder and removes the half-written file.
  useEffect(() => () => exporting.current?.abort(), [])

  const push = (next: VideoCut): void => {
    setHistory((h) => {
      if (!h) return h
      const steps = [...h.steps.slice(0, h.at + 1), next].slice(-100)
      return { steps, at: steps.length - 1 }
    })
    setSave((s) => (s.kind === 'saved' || s.kind === 'error' ? { kind: 'idle' } : s))
  }
  const undo = (): void => setHistory((h) => (h && h.at > 0 ? { ...h, at: h.at - 1 } : h))
  const redo = (): void => setHistory((h) => (h && h.at < h.steps.length - 1 ? { ...h, at: h.at + 1 } : h))

  const loaded = useCallback((v: HTMLVideoElement): void => {
    const d = v.duration
    if (!Number.isFinite(d) || d <= 0) return setLoadError(true)
    setDuration((had) => had ?? d)
    setHistory((h) => h ?? { steps: [{ trim: { start: 0, end: d }, cuts: [] }], at: 0 })
  }, [])
  // The preview may have cached the video, so its metadata can be in before React listens for it.
  useEffect(() => {
    const v = videoRef.current
    if (v && v.readyState >= HTMLMediaElement.HAVE_METADATA) loaded(v)
  }, [loaded])

  const seek = useCallback((to: number): void => {
    const v = videoRef.current
    if (!v || !Number.isFinite(to)) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, to))
    setTime(v.currentTime)
  }, [])

  // While playing, follow the playhead every frame and jump over the parts that are cut away.
  useEffect(() => {
    if (!playing || duration === null) return
    let raf = 0
    const tick = (): void => {
      const v = videoRef.current
      const e = editRef.current
      if (!v || !e) return
      const jump = skipTarget(e, duration, v.currentTime)
      const kept = keptSpans(e, duration)
      if (jump !== null) v.currentTime = jump
      else if (kept.length === 0 || v.currentTime >= kept[kept.length - 1].end) {
        v.pause()
        v.currentTime = kept.length ? kept[kept.length - 1].end : v.currentTime
      }
      setTime(v.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  const togglePlay = (): void => {
    const v = videoRef.current
    if (!v || !edit || duration === null) return
    if (!v.paused) return v.pause()
    const kept = keptSpans(edit, duration)
    if (kept.length === 0) return
    // From the end (or a cut-away part), play the result from its beginning or the next kept part.
    if (v.currentTime >= kept[kept.length - 1].end - 0.05) v.currentTime = kept[0].start
    void v.play().catch(() => {})
  }

  const setStart = (): void => {
    if (edit && duration !== null && time < edit.trim.end - MIN_SPAN) push({ ...edit, trim: { start: time, end: edit.trim.end } })
  }
  const setEnd = (): void => {
    if (edit && duration !== null && time > edit.trim.start + MIN_SPAN) push({ ...edit, trim: { start: edit.trim.start, end: time } })
  }
  const cutSelection = (): void => {
    if (!edit || !selection || duration === null) return
    push({ ...edit, cuts: addCut(edit.cuts, selection, duration) })
    setSelection(null)
  }
  const restore = (cut: Span): void => {
    if (edit) push({ ...edit, cuts: edit.cuts.filter((c) => c !== cut) })
  }
  const reset = (): void => {
    if (duration !== null) push({ trim: { start: 0, end: duration }, cuts: [] })
    setSelection(null)
  }

  const doSave = async (): Promise<void> => {
    if (!edit || duration === null || exporting.current) return
    const spans = keptSpans(edit, duration)
    if (spans.length === 0) return setSave({ kind: 'error', message: t('videoEditor.nothingLeft') })
    videoRef.current?.pause()
    const ctrl = new AbortController()
    exporting.current = ctrl
    setSave({ kind: 'busy', percent: 0 })
    let shown = 0
    try {
      const { exportCut } = await import('../lib/videoExport')
      const saved = await exportCut(entry.path, spans, (fraction) => {
        const percent = Math.floor(fraction * 100)
        if (percent === shown) return
        shown = percent
        setSave({ kind: 'busy', percent })
      }, ctrl.signal)
      savedKey.current = keyOf(edit)
      setSave({ kind: 'saved', name: baseName(saved.path) })
    } catch (err) {
      setSave(ctrl.signal.aborted ? { kind: 'idle' } : { kind: 'error', message: (err as Error).message })
    } finally {
      exporting.current = null
    }
  }

  const exit = (): void => {
    if ((dirty || exporting.current) && !window.confirm(t('videoEditor.discard'))) return
    exporting.current?.abort()
    onExit()
  }

  // Own keys while editing: Quick Look steps aside, and the file list ignores keys under a modal.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e) => {
    const target = e.target as HTMLElement
    if (target.closest?.('input, textarea, select')) return
    const mod = keys.isMac ? e.metaKey : e.ctrlKey
    const k = e.key.toLowerCase()
    const busy = save.kind === 'busy'
    let handled = true
    if (e.key === 'Escape') selection ? setSelection(null) : exit()
    else if (busy) handled = mod && k === 's'
    else if (e.key === ' ' && !mod) togglePlay()
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') seek(time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 / 30 : 1))
    else if (e.key === 'Home' && edit) seek(edit.trim.start)
    else if (e.key === 'End' && edit) seek(edit.trim.end)
    else if (k === 'i' && !mod) setStart()
    else if (k === 'o' && !mod) setEnd()
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) cutSelection()
    else if (mod && k === 'z' && !e.shiftKey) undo()
    else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) redo()
    else if (mod && k === 's') void doSave()
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

  const timeAt = (clientX: number): number => {
    const r = barRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (duration ?? 0)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !edit || save.kind === 'busy') return
    e.currentTarget.setPointerCapture(e.pointerId)
    const handle = (e.target as HTMLElement).dataset.handle
    if (handle === 'start' || handle === 'end') {
      drag.current = { kind: handle }
      setTrimDraft(edit.trim)
      return
    }
    const at = timeAt(e.clientX)
    drag.current = { kind: 'select', anchor: at, x: e.clientX, moved: false }
    seek(at)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || !edit) return
    const at = timeAt(e.clientX)
    if (d.kind === 'select') {
      if (!d.moved && Math.abs(e.clientX - d.x) < 3) return
      d.moved = true
      setSelection({ start: Math.min(d.anchor, at), end: Math.max(d.anchor, at) })
    } else {
      setTrimDraft((tr) => {
        const cur = tr ?? edit.trim
        return d.kind === 'start' ? { start: Math.min(at, cur.end - MIN_SPAN), end: cur.end } : { start: cur.start, end: Math.max(at, cur.start + MIN_SPAN) }
      })
    }
    seek(at)
  }

  const onPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    if (!d || !edit) return
    if (d.kind === 'select') {
      if (!d.moved) setSelection(null)
      else setSelection((s) => (s && s.end - s.start >= MIN_SPAN ? s : null))
      return
    }
    if (trimDraft && keyOf({ ...edit, trim: trimDraft }) !== keyOf(edit)) push({ ...edit, trim: trimDraft })
    setTrimDraft(null)
  }

  if (loadError) return <p className="preview-note center error">{t('videoEditor.loadFailed')}</p>

  const shownEdit = edit && trimDraft ? { ...edit, trim: trimDraft } : edit
  const pct = (s: number): string => `${duration ? (s / duration) * 100 : 0}%`
  const kept = shownEdit && duration !== null ? keptSpans(shownEdit, duration) : []
  const busy = save.kind === 'busy'
  return (
    <div className="video-editor">
      <div className="preview-tools image-editor-tools">
        <button className="xp-button video-play" title={t('videoEditor.play')} disabled={!edit || busy} onClick={togglePlay}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="video-time">
          {formatVideoTime(time)} / {formatVideoTime(duration ?? 0)}
        </span>
        <span className="tool-sep" />
        <button className="xp-button" title={t('videoEditor.setStartTitle')} disabled={!edit || busy} onClick={setStart}>
          {t('videoEditor.setStart')}
        </button>
        <button className="xp-button" title={t('videoEditor.setEndTitle')} disabled={!edit || busy} onClick={setEnd}>
          {t('videoEditor.setEnd')}
        </button>
        <button className="xp-button" title={t('videoEditor.cutTitle')} disabled={!selection || busy} onClick={cutSelection}>
          ✂ {t('videoEditor.cut')}
        </button>
        <span className="tool-sep" />
        <button className="xp-button" title={`${t('imageEditor.undo')} (${keys.isMac ? '⌘Z' : 'Ctrl+Z'})`} disabled={!history || history.at === 0 || busy} onClick={undo}>↶</button>
        <button className="xp-button" title={`${t('imageEditor.redo')} (${keys.isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} disabled={!history || history.at >= history.steps.length - 1 || busy} onClick={redo}>↷</button>
        <button className="xp-button" disabled={!edit || duration === null || isUncut(edit, duration) || busy} onClick={reset}>
          {t('videoEditor.reset')}
        </button>
        <span className="toolbar-spacer" />
        <button className="xp-button" title={keys.isMac ? '⌘S' : 'Ctrl+S'} disabled={!edit || busy || duration === null || isUncut(edit, duration)} onClick={() => void doSave()}>
          {t('imageEditor.saveCopy')}
        </button>
        <button className="xp-button" onClick={exit}>
          {t('preview.done')}
        </button>
      </div>
      <div className="video-editor-stage">
        <video
          ref={videoRef}
          src={previewUrl(entry.path)}
          preload="auto"
          onClick={togglePlay}
          onLoadedMetadata={(e) => loaded(e.currentTarget)}
          onError={() => setLoadError(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
        />
      </div>
      <div className="video-editor-bottom">
        <div
          ref={barRef}
          className="video-timeline"
          role="slider"
          aria-label={t('videoEditor.timeline')}
          aria-valuemin={0}
          aria-valuemax={duration ?? 0}
          aria-valuenow={time}
          aria-valuetext={formatVideoTime(time)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {shownEdit && duration !== null && (
            <>
              {kept.map((s) => (
                <div key={`k${s.start}`} className="video-kept" style={{ left: pct(s.start), width: pct(s.end - s.start) }} />
              ))}
              <div className="video-trimmed" style={{ left: 0, width: pct(shownEdit.trim.start) }} />
              <div className="video-trimmed" style={{ left: pct(shownEdit.trim.end), right: 0 }} />
              {shownEdit.cuts.map((c) => (
                <div key={`c${c.start}`} className="video-cut" style={{ left: pct(c.start), width: pct(c.end - c.start) }}>
                  <button className="video-cut-restore" title={t('videoEditor.restore')} disabled={busy} onPointerDown={(e) => e.stopPropagation()} onClick={() => restore(c)}>
                    ✕
                  </button>
                </div>
              ))}
              {selection && <div className="video-selection" style={{ left: pct(selection.start), width: pct(selection.end - selection.start) }} />}
              <div className="video-handle" data-handle="start" title={t('videoEditor.trimStart')} style={{ left: pct(shownEdit.trim.start) }} />
              <div className="video-handle end" data-handle="end" title={t('videoEditor.trimEnd')} style={{ left: pct(shownEdit.trim.end) }} />
              <div className="video-playhead" style={{ left: pct(time) }} />
            </>
          )}
        </div>
        <p className={`preview-status video-editor-status${save.kind === 'error' ? ' error' : ''}`}>
          {save.kind === 'busy' ? (
            <>
              <progress max={100} value={save.percent} /> {t('videoEditor.saving', { percent: save.percent })}
              <button className="xp-button" onClick={() => exporting.current?.abort()}>
                {t('dialog.cancel')}
              </button>
            </>
          ) : save.kind === 'saved' ? (
            t('imageEditor.savedAs', { name: save.name })
          ) : save.kind === 'error' ? (
            save.message
          ) : edit && duration !== null && !isUncut(edit, duration) ? (
            `${t('videoEditor.result', { length: formatVideoTime(totalLength(kept)), total: formatVideoTime(duration) })} · ${t('videoEditor.copyNote')}`
          ) : (
            t('videoEditor.hint')
          )}
        </p>
      </div>
    </div>
  )
}
