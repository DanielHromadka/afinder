import { useState } from 'react'
import { t } from '@shared/i18n'
import { baseName, dirOf } from '@shared/paths'
import { previewUrl } from '@shared/preview'
import { api, ToolError, useStored } from './common'

type Format = 'png' | 'jpeg' | 'webp'
const MIME: Record<Format, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const EXT: Record<Format, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' }

/** Chromium decodes most formats itself; HEIC, TIFF and the like go through the system (main). */
async function decode(path: string): Promise<ImageBitmap> {
  try {
    const res = await fetch(previewUrl(path))
    if (!res.ok) throw new Error(String(res.status))
    return await createImageBitmap(await res.blob())
  } catch {
    const png = await api.tools.decodeImage(path)
    return createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
  }
}

/** Fits w×h into the limits (0 = no limit), keeping the aspect ratio and never enlarging. */
function fit(w: number, h: number, maxW: number, maxH: number): [number, number] {
  const scale = Math.min(1, maxW > 0 ? maxW / w : 1, maxH > 0 ? maxH / h : 1)
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]
}

/** Resizes and converts images; the results go next to the originals under a free name. */
export default function ImageConvert(): React.JSX.Element {
  const [files, setFiles] = useState<string[]>([])
  const [format, setFormat] = useStored<Format>('image.format', 'jpeg')
  const [maxW, setMaxW] = useStored('image.maxW', 1920)
  const [maxH, setMaxH] = useStored('image.maxH', 0)
  const [quality, setQuality] = useStored('image.quality', 85)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ from: string; to?: string; error?: string }[]>([])

  const convert = async (): Promise<void> => {
    setBusy(true)
    setDone([])
    for (const file of files) {
      try {
        const bitmap = await decode(file)
        const [w, h] = fit(bitmap.width, bitmap.height, maxW, maxH)
        const canvas = new OffscreenCanvas(w, h)
        const ctx = canvas.getContext('2d')!
        // JPEG has no transparency: white instead of black.
        if (format === 'jpeg') {
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, w, h)
        }
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(bitmap, 0, 0, w, h)
        bitmap.close()
        const blob = await canvas.convertToBlob({ type: MIME[format], quality: quality / 100 })
        const name = `${baseName(file).replace(/\.[^.]+$/, '')}.${EXT[format]}`
        const to = await api.tools.saveImage(dirOf(file), name, new Uint8Array(await blob.arrayBuffer()))
        setDone((d) => [...d, { from: file, to }])
      } catch (err) {
        setDone((d) => [...d, { from: file, error: (err as Error).message }])
      }
    }
    setBusy(false)
  }

  return (
    <div className="tool">
      <div className="tool-row">
        <button className="todo-btn" onClick={() => void api.tools.pick('image', true).then((p) => p.length && setFiles(p))}>
          {t('tools.chooseImages')}
        </button>
        <span className="tool-muted">{files.length ? t('tools.imagesChosen', { count: files.length }) : t('tools.noImages')}</span>
      </div>
      {files.length > 0 && (
        <ul className="tool-list">
          {files.map((f) => (
            <li key={f} title={f}>
              {baseName(f)}
            </li>
          ))}
        </ul>
      )}
      <div className="tool-grid">
        <label>{t('tools.format')}</label>
        <div className="todo-seg">
          {(['jpeg', 'png', 'webp'] as const).map((f) => (
            <button key={f} className={f === format ? 'on' : ''} onClick={() => setFormat(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <label>{t('tools.maxWidth')}</label>
        <input className="tool-input small" type="number" min={0} value={maxW} onChange={(e) => setMaxW(Math.max(0, Number(e.target.value) || 0))} />
        <label>{t('tools.maxHeight')}</label>
        <input className="tool-input small" type="number" min={0} value={maxH} onChange={(e) => setMaxH(Math.max(0, Number(e.target.value) || 0))} />
        {format !== 'png' && (
          <>
            <label>{t('tools.quality')}</label>
            <div className="tool-row">
              <input type="range" min={30} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              <span>{quality} %</span>
            </div>
          </>
        )}
      </div>
      <p className="tool-muted">{t('tools.imageHint')}</p>
      <div className="tool-row">
        <button className="todo-btn" disabled={!files.length || busy} onClick={() => void convert()}>
          {busy ? t('tools.working') : t('tools.convert')}
        </button>
      </div>
      {done.map((d) => (d.error ? <ToolError key={d.from} text={`${baseName(d.from)}: ${d.error}`} /> : (
        <div key={d.from} className="tool-row">
          <span className="tool-ok">✓</span>
          <button className="link-button" onClick={() => void api.reveal(d.to!)}>
            {baseName(d.to!)}
          </button>
        </div>
      )))}
    </div>
  )
}
