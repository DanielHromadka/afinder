import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { dragRect, filterString, imageOutput, isNeutral, JPEG_QUALITY, NEUTRAL, rotatedSize, scaledSize, type Adjustments, type Rect } from '@shared/imageEdit'
import { baseName } from '@shared/paths'
import { previewUrl } from '@shared/preview'
import type { FileEntry } from '@shared/types'
import { keys } from '../lib/keys'

const api = window.api

type Tool = 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'highlight' | 'text' | 'crop' | 'pixelate'
const TOOLS: Tool[] = ['arrow', 'line', 'rect', 'ellipse', 'pen', 'highlight', 'text', 'crop', 'pixelate']
const SWATCHES = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#000000', '#ffffff']

type Box = { type: 'rect' | 'ellipse' | 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number; stroke: string; fill: string | null; width: number }
type Stroke = { type: 'pen' | 'highlight'; points: [number, number][]; stroke: string; width: number }
type Label = { type: 'text'; x: number; y: number; text: string; color: string; size: number }
type Shape = Box | Stroke | Label
// Unions of literals do not narrow by `===` reliably, so the kinds are told apart by their fields.
const isStroke = (s: Shape): s is Stroke => 'points' in s
const isLabel = (s: Shape): s is Label => s.type === 'text'

/** One undo step. Raster edits make a new base canvas, so earlier ones stay untouched and can be shared. */
interface Snapshot {
  base: HTMLCanvasElement
  shapes: Shape[]
  adjust: Adjustments
}

type SaveState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'saved'; name?: string } | { kind: 'conflict' } | { kind: 'error'; message: string }

interface Props {
  entry: FileEntry
  /** Leave the editor (back to the plain preview). */
  onExit(): void
  /** Unsaved edits, so that closing Quick Look can ask first. */
  onDirtyChange(dirty: boolean): void
  /** Start with the crop tool (a whole-display screenshot waiting to be cut down). */
  startWithCrop?: boolean
}

/**
 * Image editor shown inside Quick Look: shapes and text drawn as vectors over the picture, colour
 * adjustments as a canvas filter, and raster edits (crop, rotate, flip, resize, pixelate) that first
 * flatten everything into a new base. Saving encodes the result in the original format when the
 * browser can, otherwise as a PNG copy.
 */
export default function ImageEditor({ entry, onExit, onDirtyChange, startWithCrop }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [history, setHistory] = useState<{ steps: Snapshot[]; at: number } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>(startWithCrop ? 'crop' : 'arrow')
  const [color, setColor] = useState(SWATCHES[0])
  const [fill, setFill] = useState<string | null>(null)
  const [width, setWidth] = useState(4)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; left: number; top: number; value: string } | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [resizeWidth, setResizeWidth] = useState('')
  const savedAt = useRef(0) // history position that matches the file on disk
  const modified = useRef(entry.modified)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const current = history ? history.steps[history.at] : null
  const dirty = history !== null && history.at !== savedAt.current
  const out = imageOutput(entry.name)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  // Load through fetch + a blob URL: the canvas stays untainted, and <img> applies the EXIF orientation.
  useEffect(() => {
    let live = true
    let url = ''
    fetch(previewUrl(entry.path))
      .then((r) => r.blob())
      .then((blob) => {
        url = URL.createObjectURL(blob)
        const img = new Image()
        img.src = url
        return img.decode().then(() => img)
      })
      .then((img) => {
        if (!live) return
        const base = canvasOf(img.naturalWidth, img.naturalHeight)
        base.getContext('2d')!.drawImage(img, 0, 0)
        setHistory({ steps: [{ base, shapes: [], adjust: NEUTRAL }], at: 0 })
        setWidth(Math.max(2, Math.round(Math.max(base.width, base.height) / 300)))
        setResizeWidth(String(base.width))
      })
      .catch(() => live && setLoadError(t('imageEditor.loadFailed')))
      .finally(() => url && URL.revokeObjectURL(url))
    return () => {
      live = false
    }
  }, [entry.path])

  // The base with the colour adjustments applied, cached so that drawing a shape does not refilter the photo.
  const adjusted = useMemo(() => {
    if (!current) return null
    if (isNeutral(current.adjust)) return current.base
    const c = canvasOf(current.base.width, current.base.height)
    const ctx = c.getContext('2d')!
    ctx.filter = filterString(current.adjust)
    ctx.drawImage(current.base, 0, 0)
    return c
  }, [current])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !current || !adjusted) return
    canvas.width = adjusted.width
    canvas.height = adjusted.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(adjusted, 0, 0)
    for (const s of current.shapes) drawShape(ctx, s)
    if (draft) drawShape(ctx, draft)
    if (selection) drawSelection(ctx, selection, tool === 'crop')
  }, [current, adjusted, draft, selection, tool])

  const push = (next: Partial<Snapshot>): void => {
    if (!history) return
    const steps = [...history.steps.slice(0, history.at + 1), { ...history.steps[history.at], ...next }]
    const dropped = Math.max(0, steps.length - 60)
    // The saved state is gone when it was redone away or fell off the start; -1 never matches.
    savedAt.current = savedAt.current > history.at || savedAt.current - dropped < 0 ? -1 : savedAt.current - dropped
    setHistory({ steps: steps.slice(dropped), at: steps.length - 1 - dropped })
    setSave((s) => (s.kind === 'saved' ? { kind: 'idle' } : s))
  }

  const undo = (): void => setHistory((h) => (h && h.at > 0 ? { ...h, at: h.at - 1 } : h))
  const redo = (): void => setHistory((h) => (h && h.at < h.steps.length - 1 ? { ...h, at: h.at + 1 } : h))

  /** Everything burned into one canvas: adjusted photo plus shapes. */
  const flatten = useCallback((): HTMLCanvasElement | null => {
    if (!current || !adjusted) return null
    const c = canvasOf(adjusted.width, adjusted.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(adjusted, 0, 0)
    for (const s of current.shapes) drawShape(ctx, s)
    return c
  }, [current, adjusted])

  /** A raster edit: flatten, transform into a new base, and start with clean shapes and adjustments. */
  const raster = (transform: (src: HTMLCanvasElement) => HTMLCanvasElement): void => {
    const flat = flatten()
    if (!flat) return
    const base = transform(flat)
    push({ base, shapes: [], adjust: NEUTRAL })
    setSelection(null)
    setResizeWidth(String(base.width))
  }

  const rotate = (turns: 1 | -1): void =>
    raster((src) => {
      const size = rotatedSize(src.width, src.height, turns)
      const c = canvasOf(size.width, size.height)
      const ctx = c.getContext('2d')!
      ctx.translate(size.width / 2, size.height / 2)
      ctx.rotate((turns * Math.PI) / 2)
      ctx.drawImage(src, -src.width / 2, -src.height / 2)
      return c
    })

  const flip = (horizontal: boolean): void =>
    raster((src) => {
      const c = canvasOf(src.width, src.height)
      const ctx = c.getContext('2d')!
      ctx.translate(horizontal ? src.width : 0, horizontal ? 0 : src.height)
      ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1)
      ctx.drawImage(src, 0, 0)
      return c
    })

  const crop = (): void => {
    const r = selection
    if (!r || r.width < 2 || r.height < 2) return
    raster((src) => {
      const c = canvasOf(r.width, r.height)
      c.getContext('2d')!.drawImage(src, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
      return c
    })
  }

  const pixelate = (r: Rect): void => {
    if (r.width < 2 || r.height < 2) return
    raster((src) => {
      const c = canvasOf(src.width, src.height)
      const ctx = c.getContext('2d')!
      ctx.drawImage(src, 0, 0)
      const block = Math.max(6, Math.round(Math.max(src.width, src.height) / 120))
      const small = canvasOf(Math.max(1, Math.ceil(r.width / block)), Math.max(1, Math.ceil(r.height / block)))
      small.getContext('2d')!.drawImage(src, r.x, r.y, r.width, r.height, 0, 0, small.width, small.height)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.width, r.height)
      return c
    })
  }

  const resize = (): void => {
    const target = Number(resizeWidth)
    if (!current || !Number.isFinite(target) || target < 1 || target > 20000 || target === current.base.width) return
    raster((src) => {
      const size = scaledSize(src.width, src.height, target)
      const c = canvasOf(size.width, size.height)
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, 0, 0, size.width, size.height)
      return c
    })
  }

  const setAdjust = (patch: Partial<Adjustments>): void => {
    if (current) push({ adjust: { ...current.adjust, ...patch } })
  }

  const doSave = async (copy: boolean, force = false): Promise<void> => {
    const flat = flatten()
    if (!flat || !history) return
    setSave({ kind: 'busy' })
    try {
      const blob = await new Promise<Blob | null>((resolve) => flat.toBlob(resolve, out.mime, JPEG_QUALITY))
      if (!blob) throw new Error(t('imageEditor.encodeFailed'))
      const data = new Uint8Array(await blob.arrayBuffer())
      const saved = await api.preview.saveImage(entry.path, data, { modified: modified.current, force, copy })
      if (copy) setSave({ kind: 'saved', name: baseName(saved.path) })
      else {
        modified.current = saved.modified
        savedAt.current = history.at
        setSave({ kind: 'saved' })
      }
    } catch (err) {
      const message = (err as Error).message
      setSave(message === t('preview.changedOnDisk') ? { kind: 'conflict' } : { kind: 'error', message })
    }
  }

  const exit = (): void => {
    if (dirty && !window.confirm(t('imageEditor.discard'))) return
    onExit()
  }

  // Own keys while editing: Quick Look steps aside, and the file list ignores keys under a modal.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e) => {
    const target = e.target as HTMLElement
    if (target.closest?.('input, textarea, select')) return
    const mod = keys.isMac ? e.metaKey : e.ctrlKey
    const k = e.key.toLowerCase()
    let handled = true
    if (e.key === 'Escape') selection ? setSelection(null) : exit()
    else if (mod && k === 'z' && !e.shiftKey) undo()
    else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) redo()
    else if (mod && k === 's') void doSave(e.shiftKey || !out.overwrite)
    else if (e.key === 'Enter' && tool === 'crop' && selection) crop()
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

  const toImage = (e: React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 || !current) return
    commitText()
    const p = toImage(e)
    if (tool === 'text') {
      e.preventDefault() // keep the mousedown that follows from taking focus away from the new field
      const host = e.currentTarget.parentElement!.getBoundingClientRect()
      setTextDraft({ x: p.x, y: p.y, left: e.clientX - host.left, top: e.clientY - host.top, value: '' })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = p
    if (tool === 'crop' || tool === 'pixelate') setSelection({ x: Math.round(p.x), y: Math.round(p.y), width: 0, height: 0 })
    else if (tool === 'pen' || tool === 'highlight') setDraft({ type: tool, points: [[p.x, p.y]], stroke: color, width: tool === 'highlight' ? width * 4 : width })
    else setDraft({ type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: color, fill: tool === 'line' || tool === 'arrow' ? null : fill, width })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const start = drag.current
    if (!start || !current) return
    const p = toImage(e)
    if (tool === 'crop' || tool === 'pixelate') return setSelection(dragRect(start.x, start.y, p.x, p.y, current.base.width, current.base.height))
    setDraft((d) => {
      if (!d || isLabel(d)) return d
      if (isStroke(d)) return { ...d, points: [...d.points, [p.x, p.y]] }
      // Shift keeps lines at 45° steps and boxes square.
      if (e.shiftKey) {
        const dx = p.x - d.x1
        const dy = p.y - d.y1
        if (d.type === 'line' || d.type === 'arrow') {
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
          const len = Math.hypot(dx, dy)
          return { ...d, x2: d.x1 + Math.cos(angle) * len, y2: d.y1 + Math.sin(angle) * len }
        }
        const side = Math.max(Math.abs(dx), Math.abs(dy))
        return { ...d, x2: d.x1 + Math.sign(dx || 1) * side, y2: d.y1 + Math.sign(dy || 1) * side }
      }
      return { ...d, x2: p.x, y2: p.y }
    })
  }

  const onPointerUp = (): void => {
    if (!drag.current) return
    drag.current = null
    if (tool === 'pixelate' && selection) return pixelate(selection)
    if (draft && current && !tinyShape(draft)) push({ shapes: [...current.shapes, draft] })
    setDraft(null)
  }

  const commitText = (): void => {
    if (!textDraft || !current) return setTextDraft(null)
    const text = textDraft.value.trim()
    if (text) push({ shapes: [...current.shapes, { type: 'text', x: textDraft.x, y: textDraft.y, text, color, size: Math.round(Math.max(width * 8, Math.max(current.base.width, current.base.height) / 30)) }] })
    setTextDraft(null)
  }

  if (loadError) return <p className="preview-note center error">{loadError}</p>
  if (!current) return <p className="preview-note center">{t('preview.loading')}</p>

  const maxWidth = Math.max(20, Math.round(Math.max(current.base.width, current.base.height) / 25))
  const a = current.adjust
  const saveLabel = `${t('preview.save')} (${keys.isMac ? '⌘S' : 'Ctrl+S'})`
  return (
    <div className="image-editor">
      <div className="preview-tools image-editor-tools">
        <div className="image-editor-group" role="radiogroup" aria-label={t('imageEditor.tools')}>
          {TOOLS.map((id) => (
            <button key={id} className={`xp-button tool-${id}${tool === id ? ' pressed' : ''}`} title={t(`imageEditor.tool.${id}`)} aria-pressed={tool === id} onClick={() => { commitText(); setSelection(null); setTool(id) }}>
              {TOOL_GLYPHS[id]}
            </button>
          ))}
        </div>
        <span className="tool-sep" />
        <div className="image-editor-group">
          {SWATCHES.map((c) => (
            <button key={c} className={`image-swatch${c === color ? ' active' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />
          ))}
          <input type="color" value={color} title={t('imageEditor.color')} onChange={(e) => setColor(e.target.value)} />
        </div>
        <label className="image-editor-field" title={t('imageEditor.fillTitle')}>
          <input type="checkbox" checked={fill !== null} onChange={(e) => setFill(e.target.checked ? color : null)} />
          {t('imageEditor.fill')}
          {fill !== null && <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} />}
        </label>
        <label className="image-editor-field">
          {t('imageEditor.width')}
          <input type="range" min={1} max={maxWidth} value={Math.min(width, maxWidth)} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <span className="tool-sep" />
        <button className="xp-button" title={`${t('imageEditor.undo')} (${keys.isMac ? '⌘Z' : 'Ctrl+Z'})`} disabled={!history || history.at === 0} onClick={undo}>↶</button>
        <button className="xp-button" title={`${t('imageEditor.redo')} (${keys.isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} disabled={!history || history.at >= history.steps.length - 1} onClick={redo}>↷</button>
        <span className="toolbar-spacer" />
        {out.overwrite && (
          <button className="xp-button" title={saveLabel} disabled={!dirty || save.kind === 'busy'} onClick={() => void doSave(false)}>
            {t('preview.save')}
          </button>
        )}
        <button className="xp-button" title={out.overwrite ? `${keys.isMac ? '⇧⌘S' : 'Ctrl+Shift+S'}` : t('imageEditor.copyOnly')} disabled={save.kind === 'busy'} onClick={() => void doSave(true)}>
          {t('imageEditor.saveCopy')}
        </button>
        <button className="xp-button" onClick={exit}>
          {t('preview.done')}
        </button>
      </div>
      <div className="image-editor-body">
        <div className={`image-editor-stage tool-${tool}`}>
          <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          {textDraft && (
            <input
              className="image-editor-text"
              style={{ left: textDraft.left, top: textDraft.top, color }}
              autoFocus
              value={textDraft.value}
              placeholder={t('imageEditor.textPlaceholder')}
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText()
                else if (e.key === 'Escape') setTextDraft(null)
                else return
                e.preventDefault()
                e.stopPropagation()
              }}
              onBlur={commitText}
            />
          )}
        </div>
        <aside className="image-editor-side">
          <fieldset>
            <legend>{t('imageEditor.adjust')}</legend>
            <Slider label={t('imageEditor.brightness')} value={a.brightness} min={0} max={200} onChange={(v) => setAdjust({ brightness: v })} />
            <Slider label={t('imageEditor.contrast')} value={a.contrast} min={0} max={200} onChange={(v) => setAdjust({ contrast: v })} />
            <Slider label={t('imageEditor.saturation')} value={a.saturation} min={0} max={200} onChange={(v) => setAdjust({ saturation: v })} />
            <Slider label={t('imageEditor.hue')} value={a.hue} min={-180} max={180} onChange={(v) => setAdjust({ hue: v })} />
            <label><input type="checkbox" checked={a.grayscale} onChange={(e) => setAdjust({ grayscale: e.target.checked })} /> {t('imageEditor.grayscale')}</label>
            <label><input type="checkbox" checked={a.sepia} onChange={(e) => setAdjust({ sepia: e.target.checked })} /> {t('imageEditor.sepia')}</label>
            <label><input type="checkbox" checked={a.invert} onChange={(e) => setAdjust({ invert: e.target.checked })} /> {t('imageEditor.invert')}</label>
            <button className="xp-button" disabled={isNeutral(a)} onClick={() => push({ adjust: NEUTRAL })}>{t('imageEditor.reset')}</button>
          </fieldset>
          <fieldset>
            <legend>{t('imageEditor.transform')}</legend>
            <div className="image-editor-row">
              <button className="xp-button" title={t('imageEditor.rotateLeft')} onClick={() => rotate(-1)}>⟲</button>
              <button className="xp-button" title={t('imageEditor.rotateRight')} onClick={() => rotate(1)}>⟳</button>
              <button className="xp-button" title={t('imageEditor.flipH')} onClick={() => flip(true)}>⇋</button>
              <button className="xp-button" title={t('imageEditor.flipV')} onClick={() => flip(false)}>⇵</button>
            </div>
            {tool === 'crop' && (
              <button className="xp-button" disabled={!selection || selection.width < 2 || selection.height < 2} onClick={crop}>
                {t('imageEditor.applyCrop')}
              </button>
            )}
            <label className="image-editor-row">
              {t('imageEditor.resize')}
              <input type="number" min={1} max={20000} value={resizeWidth} onChange={(e) => setResizeWidth(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && resize()} />
              px
            </label>
            <button className="xp-button" disabled={Number(resizeWidth) === current.base.width} onClick={resize}>
              {t('imageEditor.applyResize')}
            </button>
          </fieldset>
          <p className="preview-caption">{t('preview.dimensions', { width: current.base.width, height: current.base.height })}</p>
          <p className={`preview-status${save.kind === 'conflict' || save.kind === 'error' ? ' error' : ''}`}>
            {save.kind === 'conflict'
              ? t('preview.changedOnDisk')
              : save.kind === 'error'
                ? save.message
                : save.kind === 'saved'
                  ? save.name ? t('imageEditor.savedAs', { name: save.name }) : t('preview.saved')
                  : dirty
                    ? t('preview.unsaved')
                    : !out.overwrite
                      ? t('imageEditor.copyOnly')
                      : ''}
          </p>
          {save.kind === 'conflict' && (
            <button className="xp-button" onClick={() => void doSave(false, true)}>
              {t('preview.overwrite')}
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}

const TOOL_GLYPHS: Record<Tool, string> = { arrow: '↗', line: '╱', rect: '▭', ellipse: '◯', pen: '✎', highlight: '▮', text: 'T', crop: '⛶', pixelate: '▦' }

function Slider(p: { label: string; value: number; min: number; max: number; onChange(v: number): void }): React.JSX.Element {
  // Committed on release, so that one drag is one undo step.
  const [live, setLive] = useState(p.value)
  useEffect(() => setLive(p.value), [p.value])
  const commit = (): void => {
    if (live !== p.value) p.onChange(live)
  }
  return (
    <label className="image-editor-slider">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} value={live} onChange={(e) => setLive(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <output>{live}</output>
    </label>
  )
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function tinyShape(s: Shape): boolean {
  if (isStroke(s)) return s.points.length < 2
  if (isLabel(s)) return !s.text
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 3
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (isLabel(s)) {
    ctx.fillStyle = s.color
    ctx.font = `600 ${s.size}px system-ui, sans-serif`
    ctx.textBaseline = 'top'
    // A thin outline in the opposite tone keeps the text readable on any background.
    ctx.lineWidth = Math.max(1, s.size / 12)
    ctx.strokeStyle = luminanceOf(s.color) > 0.5 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)'
    ctx.strokeText(s.text, s.x, s.y)
    ctx.fillText(s.text, s.x, s.y)
  } else if (isStroke(s)) {
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = s.width
    if (s.type === 'highlight') {
      ctx.globalAlpha = 0.35
      ctx.lineCap = 'square'
    }
    ctx.beginPath()
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.stroke()
  } else {
    ctx.strokeStyle = s.stroke
    ctx.fillStyle = s.fill ?? 'transparent'
    ctx.lineWidth = s.width
    ctx.beginPath()
    if (s.type === 'rect') ctx.rect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))
    else if (s.type === 'ellipse') ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2)
    else {
      ctx.moveTo(s.x1, s.y1)
      ctx.lineTo(s.x2, s.y2)
    }
    if (s.fill) ctx.fill()
    ctx.stroke()
    if (s.type === 'arrow') {
      const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      const head = Math.max(10, s.width * 4)
      ctx.fillStyle = s.stroke
      ctx.beginPath()
      ctx.moveTo(s.x2 + Math.cos(angle) * s.width, s.y2 + Math.sin(angle) * s.width)
      ctx.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 7), s.y2 - head * Math.sin(angle - Math.PI / 7))
      ctx.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 7), s.y2 - head * Math.sin(angle + Math.PI / 7))
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Dashed frame around the selection; for a crop, the area outside is dimmed. */
function drawSelection(ctx: CanvasRenderingContext2D, r: Rect, dim: boolean): void {
  const { width, height } = ctx.canvas
  const line = Math.max(1, Math.round(Math.max(width, height) / 600))
  ctx.save()
  if (dim) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.rect(r.x, r.y, r.width, r.height)
    ctx.fill('evenodd')
  }
  ctx.lineWidth = line
  ctx.setLineDash([line * 6, line * 4])
  ctx.strokeStyle = '#fff'
  ctx.strokeRect(r.x, r.y, r.width, r.height)
  ctx.lineDashOffset = line * 5
  ctx.strokeStyle = '#000'
  ctx.strokeRect(r.x, r.y, r.width, r.height)
  ctx.restore()
}

function luminanceOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}
