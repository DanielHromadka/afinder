import { useRef, useState } from 'react'
import { plural, t } from '@shared/i18n'
import { DEFAULT_SHEET, sheetCapacity, type SheetOptions } from '@shared/contactSheet'
import type { FileEntry } from '@shared/types'
import { Dialog } from './Dialog'

const STORE = 'afinder.contactSheet'

function loadOptions(): SheetOptions {
  try {
    return { ...DEFAULT_SHEET, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<SheetOptions>) }
  } catch {
    return DEFAULT_SHEET
  }
}

/** Columns, picture size, names and format of the contact sheet. */
export function ContactSheetDialog({ entries, onStart, onCancel }: { entries: FileEntry[]; onStart(o: SheetOptions): void; onCancel(): void }): React.JSX.Element {
  const [o, setO] = useState(loadOptions)
  const first = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<SheetOptions>): void => setO((prev) => ({ ...prev, ...patch }))
  const capacity = sheetCapacity(o)
  const submit = (): void => {
    if (entries.length > capacity) return
    try {
      localStorage.setItem(STORE, JSON.stringify(o))
    } catch {
      /* not remembered */
    }
    onStart(o)
  }
  return (
    <Dialog title={t('contact.title')} className="batch-rename" onClose={onCancel} initialFocus={first} onSubmit={submit}>
      <div className="batch-form">
        <div className="batch-row">
          <label>
            <span>{t('contact.columns')}</span>
            <input ref={first} type="number" min={1} max={20} value={o.columns} onChange={(e) => set({ columns: Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))) })} />
          </label>
          <label>
            <span>{t('contact.thumbWidth')}</span>
            <input type="number" min={64} max={1024} value={o.thumbWidth} onChange={(e) => set({ thumbWidth: Math.max(64, Math.min(1024, Math.round(Number(e.target.value) || 64))) })} />
          </label>
        </div>
        <label>
          <span>{t('resize.format')}</span>
          <select value={o.format} onChange={(e) => set({ format: e.target.value as SheetOptions['format'] })}>
            <option value="jpg">{t('convert.format.jpg')}</option>
            <option value="png">{t('convert.format.png')}</option>
          </select>
        </label>
        <div className="batch-checks">
          <label>
            <input type="checkbox" checked={o.names} onChange={(e) => set({ names: e.target.checked })} />
            {t('contact.names')}
          </label>
        </div>
        {entries.length > capacity && <p className="batch-hint error">{t('contact.tooMany', { n: capacity })}</p>}
      </div>
      <div className="dialog-buttons right">
        <span className="batch-summary">{plural('count.items', entries.length)}</span>
        <button type="submit" className="xp-button" disabled={entries.length > capacity}>
          {t('contact.create')}
        </button>
        <button type="button" className="xp-button" onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
