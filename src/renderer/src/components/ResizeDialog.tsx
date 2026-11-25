import { useRef, useState } from 'react'
import { plural, t } from '@shared/i18n'
import { canOverwrite, DEFAULT_RESIZE, type ResizeFormat, type ResizeOptions } from '@shared/resize'
import type { FileEntry } from '@shared/types'
import { Dialog } from './Dialog'

const STORE = 'afinder.resize'

function loadOptions(): ResizeOptions {
  try {
    return { ...DEFAULT_RESIZE, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<ResizeOptions>) }
  } catch {
    return DEFAULT_RESIZE
  }
}

const num = (v: string, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(Number(v) || 0)))

/** Size, format and quality for resizing the chosen images; the last choices are remembered. */
export function ResizeDialog({ entries, onStart, onCancel }: { entries: FileEntry[]; onStart(o: ResizeOptions): void; onCancel(): void }): React.JSX.Element {
  const [o, setO] = useState(loadOptions)
  const first = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<ResizeOptions>): void => setO((prev) => ({ ...prev, ...patch }))
  const overwriteOk = entries.every((e) => canOverwrite(e.name, o.format))
  const lossy = o.format !== 'png' && !(o.format === 'keep' && entries.every((e) => /\.png$/i.test(e.name)))
  const submit = (): void => {
    const options = { ...o, overwrite: o.overwrite && overwriteOk }
    try {
      localStorage.setItem(STORE, JSON.stringify(options))
    } catch {
      /* not remembered */
    }
    onStart(options)
  }

  return (
    <Dialog title={t('resize.title')} className="batch-rename" onClose={onCancel} initialFocus={first} onSubmit={submit}>
      <div className="batch-form">
        <label>
          <span>{t('resize.mode')}</span>
          <select value={o.mode} onChange={(e) => set({ mode: e.target.value as ResizeOptions['mode'] })}>
            <option value="fit">{t('resize.mode.fit')}</option>
            <option value="percent">{t('resize.mode.percent')}</option>
          </select>
        </label>
        {o.mode === 'fit' ? (
          <div className="batch-row">
            <label>
              <span>{t('resize.maxWidth')}</span>
              <input ref={first} type="number" min={0} value={o.maxWidth} onChange={(e) => set({ maxWidth: num(e.target.value, 0, 100000) })} />
            </label>
            <label>
              <span>{t('resize.maxHeight')}</span>
              <input type="number" min={0} value={o.maxHeight} onChange={(e) => set({ maxHeight: num(e.target.value, 0, 100000) })} />
            </label>
          </div>
        ) : (
          <label>
            <span>{t('resize.percent')}</span>
            <input ref={first} type="number" min={1} max={100} value={o.percent} onChange={(e) => set({ percent: num(e.target.value, 1, 100) })} />
          </label>
        )}
        <label>
          <span>{t('resize.format')}</span>
          <select value={o.format} onChange={(e) => set({ format: e.target.value as ResizeFormat })}>
            <option value="keep">{t('resize.format.keep')}</option>
            <option value="jpg">{t('convert.format.jpg')}</option>
            <option value="webp">{t('convert.format.webp')}</option>
            <option value="png">{t('convert.format.png')}</option>
          </select>
        </label>
        <div className="batch-row">
          <label>
            <span>{t('resize.quality')}</span>
            <input type="number" min={1} max={100} disabled={!lossy} value={o.quality} onChange={(e) => set({ quality: num(e.target.value, 1, 100) })} />
          </label>
          <label>
            <span>{t('resize.targetKb')}</span>
            <input type="number" min={0} disabled={!lossy} value={o.targetKb} onChange={(e) => set({ targetKb: num(e.target.value, 0, 1000000) })} />
          </label>
        </div>
        <p className="batch-hint">{t('resize.hint')}</p>
        <div className="batch-checks">
          <label>
            <input type="checkbox" checked={o.keepMetadata} onChange={(e) => set({ keepMetadata: e.target.checked })} />
            {t('resize.keepMetadata')}
          </label>
          <label>
            <input type="checkbox" disabled={!o.keepMetadata} checked={o.keepGps} onChange={(e) => set({ keepGps: e.target.checked })} />
            {t('resize.keepGps')}
          </label>
        </div>
        <div className="batch-checks">
          <label title={overwriteOk ? undefined : t('resize.overwriteNo')}>
            <input type="checkbox" disabled={!overwriteOk} checked={o.overwrite && overwriteOk} onChange={(e) => set({ overwrite: e.target.checked })} />
            {t('resize.overwrite')}
          </label>
        </div>
      </div>
      <div className="dialog-buttons right">
        <span className="batch-summary">{plural('count.items', entries.length)}</span>
        <button type="submit" className="xp-button">
          {t('resize.start')}
        </button>
        <button type="button" className="xp-button" onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
