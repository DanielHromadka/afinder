import { useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { FileEntry } from '@shared/types'
import { DEFAULT_GIF, type GifOptions } from '@shared/gif'
import { Dialog } from './Dialog'

const STORE = 'afinder.gif'

function loadOptions(): GifOptions {
  try {
    // The start is per video; only the size and the rate are remembered.
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<GifOptions>
    return { ...DEFAULT_GIF, ...saved, start: 0 }
  } catch {
    return DEFAULT_GIF
  }
}

/** Which stretch of the video, how wide and how many frames per second the GIF gets. */
export function GifDialog({ entry, onStart, onCancel }: { entry: FileEntry; onStart(o: GifOptions): void; onCancel(): void }): React.JSX.Element {
  const [o, setO] = useState(loadOptions)
  const first = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<GifOptions>): void => setO((prev) => ({ ...prev, ...patch }))
  const num = (v: string): number => Math.max(0, Number(v) || 0)
  const submit = (): void => {
    try {
      localStorage.setItem(STORE, JSON.stringify(o))
    } catch {
      /* not remembered */
    }
    onStart(o)
  }
  return (
    <Dialog title={t('gif.title', { name: entry.name })} className="batch-rename" onClose={onCancel} initialFocus={first} onSubmit={submit}>
      <div className="batch-form">
        <div className="batch-row">
          <label>
            <span>{t('gif.start')}</span>
            <input ref={first} type="number" min={0} step={0.1} value={o.start} onChange={(e) => set({ start: num(e.target.value) })} />
          </label>
          <label>
            <span>{t('gif.length')}</span>
            <input type="number" min={0.5} max={30} step={0.5} value={o.length} onChange={(e) => set({ length: Math.min(30, num(e.target.value)) })} />
          </label>
        </div>
        <div className="batch-row">
          <label>
            <span>{t('gif.width')}</span>
            <input type="number" min={16} max={1920} value={o.width} onChange={(e) => set({ width: Math.round(num(e.target.value)) })} />
          </label>
          <label>
            <span>{t('gif.fps')}</span>
            <input type="number" min={1} max={30} value={o.fps} onChange={(e) => set({ fps: Math.round(num(e.target.value)) })} />
          </label>
        </div>
        <p className="batch-hint">{t('gif.hint')}</p>
      </div>
      <div className="dialog-buttons right">
        <button type="submit" className="xp-button" disabled={o.length <= 0 || o.width < 16 || o.fps < 1}>
          {t('gif.create')}
        </button>
        <button type="button" className="xp-button" onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
