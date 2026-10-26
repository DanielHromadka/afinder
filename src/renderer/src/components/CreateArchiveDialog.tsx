import { useEffect, useRef, useState } from 'react'
import { CREATE_FORMATS, levelsFor, withArchiveExtension, type ArchiveFormat, type CompressionLevel } from '@shared/archive'
import { plural, t } from '@shared/i18n'
import type { ArchiveRequest } from '@shared/types'
import { Dialog } from './Dialog'

interface Props {
  sources: string[]
  /** Suggested file name without an extension. */
  name: string
  dest: string
  onCreate(request: ArchiveRequest): void
  onCancel(): void
}

const STORAGE_KEY = 'afinder.archive'

/** The last format and level, remembered per browser profile as a convenience. */
function remembered(): { format: ArchiveFormat; level: CompressionLevel } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { format?: ArchiveFormat; level?: CompressionLevel } | null
    if (saved?.format && (CREATE_FORMATS as readonly string[]).includes(saved.format)) return { format: saved.format, level: saved.level ?? 'normal' }
  } catch {
    /* storage unavailable */
  }
  return { format: 'zip', level: 'normal' }
}

/** Name, format, compression level and target folder of a new archive. */
export function CreateArchiveDialog({ sources, name, dest, onCreate, onCancel }: Props): React.JSX.Element {
  const initial = useRef(remembered()).current
  const [format, setFormat] = useState<ArchiveFormat>(initial.format)
  const levels = levelsFor(format)
  const [level, setLevel] = useState<CompressionLevel>(initial.level)
  const shownLevel = levels.includes(level) ? level : 'normal'
  const [fileName, setFileName] = useState(withArchiveExtension(name, initial.format))
  const [folder, setFolder] = useState(dest)
  const nameInput = useRef<HTMLInputElement>(null)

  // Select the name without its extension, like a rename.
  useEffect(() => {
    const input = nameInput.current
    if (!input) return
    input.focus()
    input.setSelectionRange(0, withArchiveExtension(name, initial.format).length - withArchiveExtension('', initial.format).length)
  }, [name, initial.format])

  const changeFormat = (next: ArchiveFormat): void => {
    setFormat(next)
    setFileName((current) => withArchiveExtension(current, next))
  }

  const submit = (): void => {
    if (!fileName.trim() || !folder.trim()) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ format, level: shownLevel }))
    } catch {
      /* storage unavailable */
    }
    onCreate({ sources, dest: folder.trim(), name: fileName.trim(), format, level: shownLevel })
  }

  return (
    <Dialog title={t('archive.title')} className="create-archive" onClose={onCancel} resizable onSubmit={() => submit()}>

        <div className="batch-form">
          <label>
            <span>{t('archive.name')}</span>
            <input ref={nameInput} value={fileName} spellCheck={false} onChange={(e) => setFileName(e.target.value)} />
          </label>
          <label>
            <span>{t('archive.format')}</span>
            <select value={format} onChange={(e) => changeFormat(e.target.value as ArchiveFormat)}>
              {CREATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`archive.format.${f}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('archive.level')}</span>
            <select value={levels.length ? shownLevel : ''} disabled={levels.length === 0} onChange={(e) => setLevel(e.target.value as CompressionLevel)}>
              {levels.length === 0 && <option value="">{t('archive.level.none')}</option>}
              {levels.map((l) => (
                <option key={l} value={l}>
                  {t(`archive.level.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('archive.dest')}</span>
            <span className="remote-pick">
              <input value={folder} spellCheck={false} onChange={(e) => setFolder(e.target.value)} />
              <button type="button" className="xp-button" onClick={() => void window.api.fileAssistant.pickFolder().then((p) => p && setFolder(p))}>
                {t('remote.browse')}
              </button>
            </span>
          </label>
        </div>

        <div className="dialog-buttons right">
          <span className="batch-summary">{plural('count.items', sources.length)}</span>
          <button type="submit" className="xp-button" disabled={!fileName.trim() || !folder.trim()}>
            {t('archive.create')}
          </button>
          <button type="button" className="xp-button" onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
        </div>
    </Dialog>
  )
}
