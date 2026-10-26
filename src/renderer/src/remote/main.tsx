// The remote desktop window: the other computer's screen, a small toolbar, and (with control) the mouse
// and keyboard sent to it. Input is captured only while the pointer or focus is on the screen, so the
// toolbar keeps working; in full screen the keyboard is locked, so shortcuts like Cmd+Tab go across too.

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setLanguage, setOs, t, isLanguageSetting, type Language } from '@shared/i18n'
import { Mod, swapCmdCtrl, type InputEvent } from '@shared/companion/input'
import type { RemoteDesktopInit } from '@shared/types'
import { api, messageOf, Viewer, type ViewerState } from './viewer'
import './remote.css'

/** Wheel pixels per notch: a mouse wheel click is about 100, trackpads send many small deltas. */
const NOTCH_PX = 50

const mods = (e: KeyboardEvent | PointerEvent | WheelEvent): number => (e.shiftKey ? Mod.Shift : 0) | (e.ctrlKey ? Mod.Ctrl : 0) | (e.altKey ? Mod.Alt : 0) | (e.metaKey ? Mod.Meta : 0)
const BUTTONS = ['left', 'middle', 'right'] as const

/** Where the video's picture is inside the element (object-fit: contain leaves bars). */
function pictureRect(v: HTMLVideoElement): DOMRect {
  const r = v.getBoundingClientRect()
  if (!v.videoWidth || !v.videoHeight) return r
  const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
  const w = v.videoWidth * scale
  const h = v.videoHeight * scale
  return new DOMRect(r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h)
}

function endText(s: Extract<ViewerState, { kind: 'ended' }>, name: string): string {
  if (s.limit) return t('remoteDesktop.limit', s.limit)
  if (s.restMinutes) return t('remoteDesktop.rest', { minutes: s.restMinutes })
  if (s.reason === 'error') return s.message ?? t('remoteDesktop.end.failed')
  return t(`remoteDesktop.end.${s.reason}`, { name })
}

function App(): React.JSX.Element {
  const [init, setInit] = useState<RemoteDesktopInit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<ViewerState>({ kind: 'connecting' })
  const [display, setDisplay] = useState<string | null>(null)
  const [wantControl, setWantControl] = useState(true)
  const [fit, setFit] = useState(true)
  const [swap, setSwap] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const viewer = useRef<Viewer | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const swapRef = useRef(swap)
  swapRef.current = swap

  useEffect(() => {
    api.init().then(
      (i) => {
        if (isLanguageSetting(i.language)) setLanguage(i.language as Language)
        setOs(i.platform)
        document.title = t('remoteDesktop.title', { name: i.name })
        // A Mac keyboard on Windows or Linux (or the other way): Cmd+C should copy there too.
        setSwap((i.platform === 'darwin') !== (i.info.platform === 'darwin'))
        setDisplay(i.displays.find((d) => d.primary)?.id ?? i.displays[0]?.id ?? null)
        setInit(i)
      },
      (err) => setError(messageOf(err))
    )
  }, [])

  // A new session whenever the monitor, control or a retry asks for one.
  useEffect(() => {
    if (!init?.info.screen) return
    const v = new Viewer(setState)
    viewer.current = v
    setState({ kind: 'connecting' })
    void v.start(display, wantControl && !!init.info.control)
    return () => v.finish()
  }, [init, display, wantControl, attempt])

  useEffect(() => {
    if (video.current && state.kind === 'live' && video.current.srcObject !== state.stream) video.current.srcObject = state.stream
  }, [state])

  const control = state.kind === 'live' && state.control
  const send = useCallback((e: InputEvent) => viewer.current?.send(e), [])

  // Keyboard: while the screen has focus. Everything goes across, nothing reaches this window.
  useEffect(() => {
    if (!control) return
    const el = stage.current!
    const key = (down: boolean) => (e: KeyboardEvent) => {
      e.preventDefault()
      const ev: Extract<InputEvent, { t: 'key' }> = { t: 'key', code: e.code, key: e.key, d: down, m: mods(e) }
      send(swapRef.current ? swapCmdCtrl(ev) : ev)
    }
    const down = key(true)
    const up = key(false)
    const release = (): void => send({ t: 'release' })
    el.addEventListener('keydown', down)
    el.addEventListener('keyup', up)
    el.addEventListener('blur', release)
    window.addEventListener('blur', release)
    el.focus()
    return () => {
      el.removeEventListener('keydown', down)
      el.removeEventListener('keyup', up)
      el.removeEventListener('blur', release)
      window.removeEventListener('blur', release)
      release()
    }
  }, [control, send])

  // Mouse: positions relative to the picture, one move per frame at most.
  const pending = useRef<{ x: number; y: number } | null>(null)
  const wheel = useRef({ x: 0, y: 0 })
  const position = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const r = video.current && pictureRect(video.current)
    if (!r || !r.width || !r.height) return null
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    return x < 0 || y < 0 || x > 1 || y > 1 ? null : { x, y }
  }
  const move = (e: React.PointerEvent): void => {
    if (!control) return
    const p = position(e)
    if (!p) return
    if (!pending.current) requestAnimationFrame(() => {
      if (pending.current) send({ t: 'move', ...pending.current })
      pending.current = null
    })
    pending.current = p
  }
  const button = (down: boolean) => (e: React.PointerEvent): void => {
    if (!control) return
    stage.current?.focus()
    const b = BUTTONS[e.button]
    const p = position(e)
    if (!b || (down && !p)) return
    e.preventDefault()
    if (down) stage.current?.setPointerCapture(e.pointerId)
    if (p) send({ t: 'move', ...p })
    send({ t: 'button', b, d: down })
  }
  useEffect(() => {
    const el = stage.current
    if (!el || !control) return
    // Not a React handler: it must be non-passive to keep the window itself from scrolling.
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? NOTCH_PX : e.deltaMode === 2 ? NOTCH_PX * 10 : 1
      wheel.current.x += e.deltaX * unit
      wheel.current.y += e.deltaY * unit
      const x = Math.trunc(wheel.current.x / NOTCH_PX)
      const y = Math.trunc(wheel.current.y / NOTCH_PX)
      if (!x && !y) return
      wheel.current.x -= x * NOTCH_PX
      wheel.current.y -= y * NOTCH_PX
      send({ t: 'scroll', x, y })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [control, send])

  const fullScreen = async (): Promise<void> => {
    if (document.fullscreenElement) return void (await document.exitFullscreen())
    await document.documentElement.requestFullscreen()
    // Chromium lets a full-screen page take system shortcuts (Cmd+Tab, Alt+Tab, Esc held to leave).
    await (navigator as Navigator & { keyboard?: { lock(): Promise<void> } }).keyboard?.lock().catch(() => {})
    stage.current?.focus()
  }

  const clip = (direction: 'send' | 'fetch'): void => {
    setNote(null)
    api.clipboard(direction).then(
      () => setNote(direction === 'send' ? t('remoteDesktop.clipboardSent') : t('remoteDesktop.clipboardFetched')),
      (err) => setNote(messageOf(err))
    )
  }

  const name = init?.name ?? ''
  let message: string | null = error
  if (!message && init && !init.info.screen) message = t('remoteDesktop.noScreen', { name })
  else if (!message && state.kind === 'ended') message = endText(state, name)
  else if (!message && state.kind === 'connecting') message = init ? t('remoteDesktop.connecting') : t('remoteDesktop.loading')
  const controlNote =
    state.kind === 'live' && wantControl && !state.control
      ? state.controlError
        ? t(`remoteDesktop.controlError.${state.controlError}`)
        : init && !init.info.control
          ? t('remoteDesktop.controlNotAllowed')
          : null
      : null
  const relayMinutes = state.kind === 'live' && state.relayEndsAt ? Math.max(1, Math.round((state.relayEndsAt - Date.now()) / 60_000)) : null

  return (
    <div className="rd">
      <div className="rd-bar">
        {init && init.displays.length > 1 && (
          <select value={display ?? ''} onChange={(e) => setDisplay(e.target.value)} aria-label={t('remoteDesktop.display')}>
            {init.displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.width}×{d.height})
              </option>
            ))}
          </select>
        )}
        {init?.info.control && (
          <label>
            <input type="checkbox" checked={wantControl} onChange={(e) => setWantControl(e.target.checked)} />
            {t('remoteDesktop.control')}
          </label>
        )}
        {control && (
          <label title={t('remoteDesktop.swapHint')}>
            <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
            {t('remoteDesktop.swap')}
          </label>
        )}
        <button onClick={() => setFit(!fit)}>{fit ? t('remoteDesktop.actual') : t('remoteDesktop.fit')}</button>
        <button onClick={() => void fullScreen()}>{t('remoteDesktop.fullScreen')}</button>
        {control && (
          <>
            <button onClick={() => clip('send')}>{t('remoteDesktop.clipboardSend')}</button>
            <button onClick={() => clip('fetch')}>{t('remoteDesktop.clipboardFetch')}</button>
          </>
        )}
        {state.kind === 'ended' && init?.info.screen && <button onClick={() => setAttempt((n) => n + 1)}>{t('remoteDesktop.reconnect')}</button>}
        <span className="rd-status" role="status">
          {[controlNote, relayMinutes && t('remoteDesktop.relay', { minutes: relayMinutes }), note].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div
        ref={stage}
        className={`rd-stage${fit ? ' fit' : ''}${control ? ' control' : ''}`}
        tabIndex={0}
        onPointerMove={move}
        onPointerDown={button(true)}
        onPointerUp={button(false)}
        onContextMenu={(e) => control && e.preventDefault()}
      >
        <video ref={video} autoPlay muted playsInline hidden={state.kind !== 'live'} style={fit || !video.current ? undefined : { width: video.current.videoWidth / devicePixelRatio, height: video.current.videoHeight / devicePixelRatio }} />
        {message && <p className="rd-message">{message}</p>}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
