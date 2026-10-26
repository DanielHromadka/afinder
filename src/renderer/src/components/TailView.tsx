import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { TailInfo } from '@shared/types'
import { formatSize } from '../lib/format'
import { Icon } from './Icon'

const api = window.api

/** The view keeps only the newest bytes; older ones scroll out like in a terminal. */
const MAX_BYTES = 512 * 1024
/** The hex dump shows only the newest bytes – 16 per line gets long fast. */
const MAX_HEX_BYTES = 32 * 1024

type Mode = 'text' | 'hex'
type State = { kind: 'starting' } | { kind: 'live'; info: TailInfo } | { kind: 'ended' } | { kind: 'error'; message: string }

interface Props {
  path: string
  name: string
  onClose(): void
}

/** Live tail of a file or byte stream in the preview pane. */
export function TailView({ path, name, onClose }: Props): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'starting' })
  const [mode, setMode] = useState<Mode>('text')
  const [paused, setPaused] = useState(false)
  const [follow, setFollow] = useState(true)
  const [total, setTotal] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  /** Newest bytes, and how many came before them (for hex offsets). */
  const buffer = useRef<{ bytes: Uint8Array; offset: number }>({ bytes: new Uint8Array(), offset: 0 })
  const [version, setVersion] = useState(0)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const scroller = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let id: string | null = null
    let live = true
    let queued = false
    const repaint = (): void => {
      if (queued || pausedRef.current) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        if (live) setVersion((v) => v + 1)
      })
    }
    const unsubscribe = api.tail.onData((chunk) => {
      if (chunk.id !== id) return
      if (chunk.error) return setState({ kind: 'error', message: chunk.error })
      if (chunk.ended) return setState({ kind: 'ended' })
      const b = buffer.current
      if (chunk.reset) {
        b.bytes = new Uint8Array()
        b.offset = 0
        setNotice(t('tail.reset'))
      }
      const joined = new Uint8Array(b.bytes.length + chunk.data.length)
      joined.set(b.bytes)
      joined.set(chunk.data, b.bytes.length)
      const drop = Math.max(0, joined.length - MAX_BYTES)
      b.bytes = drop ? joined.subarray(drop) : joined
      b.offset += drop
      setTotal((n) => (chunk.reset ? 0 : n) + chunk.data.length)
      repaint()
    })
    api.tail.start(path).then(
      (info) => {
        if (!live) return api.tail.stop(info.id)
        id = info.id
        setState({ kind: 'live', info })
      },
      (err: Error) => live && setState({ kind: 'error', message: err.message })
    )
    return () => {
      live = false
      unsubscribe()
      if (id) api.tail.stop(id)
    }
  }, [path])

  // Resuming shows what arrived while paused.
  useEffect(() => {
    if (!paused) setVersion((v) => v + 1)
  }, [paused])

  // Only a repaint (or a mode switch) redraws, so a paused view stays as it was while bytes keep coming.
  const text = useMemo(() => (mode === 'text' ? renderText(buffer.current.bytes) : renderHex(buffer.current)), [version, mode])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [version, mode, follow])

  // Scrolling up stops following, like a terminal; scrolling back to the bottom resumes it.
  const onScroll = (): void => {
    const el = scroller.current
    if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  const clear = (): void => {
    buffer.current = { bytes: new Uint8Array(), offset: buffer.current.offset + buffer.current.bytes.length }
    setNotice(null)
    setVersion((v) => v + 1)
  }

  const status =
    state.kind === 'error'
      ? state.message
      : state.kind === 'ended'
        ? t('tail.ended')
        : state.kind === 'starting'
          ? t('preview.loading')
          : `${t(state.info.kind === 'file' ? 'tail.following' : 'tail.streaming')} · ${formatSize(total)}`

  return (
    <div className="preview pane tail">
      <div className="preview-head">
        <Icon name="text" size={32} />
        <div className="preview-title">
          <strong title={path}>{name}</strong>
          <span className={state.kind === 'error' ? 'error' : undefined}>{status}</span>
          {notice && <span>{notice}</span>}
        </div>
      </div>
      <div className="preview-tools">
        <button className={`xp-button${paused ? ' pressed' : ''}`} disabled={state.kind !== 'live'} onClick={() => setPaused((p) => !p)}>
          {t(paused ? 'tail.resume' : 'tail.pause')}
        </button>
        <button className="xp-button" onClick={clear}>
          {t('tail.clear')}
        </button>
        <button className={`xp-button${mode === 'hex' ? ' pressed' : ''}`} title={t('tail.hexTitle')} onClick={() => setMode((m) => (m === 'text' ? 'hex' : 'text'))}>
          {t('tail.hex')}
        </button>
        <span className="preview-status" />
        {!follow && (
          <button className="xp-button" onClick={() => setFollow(true)}>
            {t('tail.follow')}
          </button>
        )}
        <button className="xp-button" onClick={onClose}>
          {t('tail.close')}
        </button>
      </div>
      <pre ref={scroller} className="tail-output" tabIndex={0} onScroll={onScroll}>
        {text || <span className="tail-waiting">{state.kind === 'live' ? t('tail.waiting') : ''}</span>}
      </pre>
    </div>
  )
}

const decoder = new TextDecoder('utf-8')

/** UTF-8 with colour codes removed and other control bytes shown as dots, so binary noise stays readable. */
function renderText(bytes: Uint8Array): string {
  return decoder
    .decode(bytes)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '·')
}

function renderHex({ bytes, offset }: { bytes: Uint8Array; offset: number }): string {
  const skip = Math.max(0, bytes.length - MAX_HEX_BYTES)
  // Keep the 16-byte grid aligned to absolute offsets.
  const start = skip + ((16 - ((offset + skip) % 16)) % 16)
  const lines: string[] = []
  for (let i = start; i < bytes.length; i += 16) {
    const row = bytes.subarray(i, i + 16)
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${(offset + i).toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`)
  }
  return lines.join('\n')
}
