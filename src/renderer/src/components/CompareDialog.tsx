import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { diffPixels } from '@shared/imageDiff'
import type { FileEntry } from '@shared/types'
import { formatSize, numberFormat } from '../lib/format'
import { decodeImage } from '../lib/imageConvert'
import { Dialog } from './Dialog'

type Mode = 'side' | 'slider' | 'blend' | 'diff'
const MODES: Mode[] = ['side', 'slider', 'blend', 'diff']
/** The difference is computed at most this wide (a 50 MP pair would take seconds and 400 MB). */
const DIFF_WIDTH = 1600

interface Loaded {
  urls: [string, string]
  sizes: [{ width: number; height: number }, { width: number; height: number }]
  diff: { url: string; changed: number } | null
}

/** Two images side by side, under a slider, blended, or as a map of the pixels that differ. */
export function CompareDialog({ entries, onClose, onError }: { entries: [FileEntry, FileEntry]; onClose(): void; onError(err: unknown): void }): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('slider')
  const [split, setSplit] = useState(50)
  const [blend, setBlend] = useState(50)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    const made: string[] = []
    void (async () => {
      try {
        const bitmaps = await Promise.all(entries.map((e) => decodeImage(e.path)))
        const url = async (canvas: OffscreenCanvas): Promise<string> => {
          const u = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
          made.push(u)
          return u
        }
        // Both drawn at the first image's size, so the slider and the blend line up.
        const [w, h] = [bitmaps[0].width, bitmaps[0].height]
        const draw = (b: ImageBitmap, dw: number, dh: number): OffscreenCanvas => {
          const c = new OffscreenCanvas(dw, dh)
          c.getContext('2d')!.drawImage(b, 0, 0, dw, dh)
          return c
        }
        const urls: [string, string] = [await url(draw(bitmaps[0], w, h)), await url(draw(bitmaps[1], w, h))]
        const scale = Math.min(1, DIFF_WIDTH / w)
        const [dw, dh] = [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]
        const [a, b] = [draw(bitmaps[0], dw, dh), draw(bitmaps[1], dw, dh)].map((c) => c.getContext('2d')!.getImageData(0, 0, dw, dh).data)
        const { image, changed } = diffPixels(a, b)
        const out = new OffscreenCanvas(dw, dh)
        out.getContext('2d')!.putImageData(new ImageData(image as Uint8ClampedArray<ArrayBuffer>, dw, dh), 0, 0)
        const sizes = bitmaps.map((x) => ({ width: x.width, height: x.height })) as Loaded['sizes']
        for (const x of bitmaps) x.close()
        const diffUrl = await url(out)
        if (live) setLoaded({ urls, sizes, diff: { url: diffUrl, changed } })
      } catch (err) {
        if (live) onError(err)
        onClose()
      }
    })()
    return () => {
      live = false
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [])

  const dragSplit = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (mode !== 'slider' || (e.buttons & 1) === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    setSplit(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)))
  }

  const caption = (i: 0 | 1): string => {
    const e = entries[i]
    const s = loaded?.sizes[i]
    return [e.name, s && t('preview.dimensions', s), e.size !== null && formatSize(e.size)].filter(Boolean).join(' · ')
  }

  return (
    <Dialog title={t('compare.title')} className="compare-dialog" onClose={onClose} resizable>
      <div className="compare-bar">
        {MODES.map((m) => (
          <label key={m}>
            <input type="radio" name="compare-mode" checked={mode === m} onChange={() => setMode(m)} />
            {t(`compare.mode.${m}`)}
          </label>
        ))}
        {mode === 'blend' && <input type="range" min={0} max={100} value={blend} aria-label={t('compare.mode.blend')} onChange={(e) => setBlend(Number(e.target.value))} />}
        {mode === 'diff' && loaded?.diff && (
          <span className="compare-changed">{t('compare.changed', { percent: numberFormat(loaded.diff.changed < 0.01 ? 2 : 1).format(loaded.diff.changed * 100) })}</span>
        )}
      </div>
      {!loaded ? (
        <p className="preview-note center">{t('preview.loading')}</p>
      ) : mode === 'side' ? (
        <div className="compare-side">
          {([0, 1] as const).map((i) => (
            <figure key={i}>
              <img src={loaded.urls[i]} alt={entries[i].name} draggable={false} />
              <figcaption>{caption(i)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="compare-stage-wrap">
          <div ref={stage} className={`compare-stage${mode === 'slider' ? ' slider' : ''}`} onPointerDown={dragSplit} onPointerMove={dragSplit}>
            {mode === 'diff' ? (
              <img src={loaded.diff!.url} alt="" draggable={false} />
            ) : (
              <>
                <img src={loaded.urls[0]} alt={entries[0].name} draggable={false} />
                <img
                  className="compare-top"
                  src={loaded.urls[1]}
                  alt={entries[1].name}
                  draggable={false}
                  style={mode === 'slider' ? { clipPath: `inset(0 0 0 ${split}%)` } : { opacity: blend / 100 }}
                />
                {mode === 'slider' && <div className="compare-handle" style={{ left: `${split}%` }} />}
              </>
            )}
          </div>
          <div className="compare-captions">
            <span>◀ {caption(0)}</span>
            <span>{caption(1)} ▶</span>
          </div>
        </div>
      )}
    </Dialog>
  )
}
