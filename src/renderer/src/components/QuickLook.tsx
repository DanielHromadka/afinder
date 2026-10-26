import { dragDialog } from '@renderer/lib/dragDialog'
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import { canEditImage } from '@shared/imageEdit'
import { previewKind } from '@shared/preview'
import type { FileEntry, SizeUpdate, ThemeId } from '@shared/types'
import { formatSize } from '../lib/format'
import { kindLabel } from '../lib/kinds'
import { Icon } from './Icon'
import { Preview } from './Preview'

// Loaded on first use, like Monaco and three.js.
const ImageEditor = lazy(() => import('./ImageEditor'))

interface Props {
  entry: FileEntry
  size?: SizeUpdate
  theme: ThemeId
  position: { index: number; count: number }
  onStep(delta: number): void
  onOpen(): void
  onClose(): void
  onError(err: unknown): void
  readOnly: boolean
  /** The image editor is open instead of the preview. */
  editing: boolean
  /** Open the editor with the crop tool (screenshots of a whole display). */
  editCrop?: boolean
  onEditingChange(editing: boolean): void
}

/** Whether Quick Look offers the image editor for this entry. */
export function imageEditable(entry: FileEntry, readOnly: boolean): boolean {
  return !readOnly && !entry.isDir && previewKind(entry.name) === 'image' && canEditImage(entry.name)
}

/** Space-bar preview in a large window, like Quick Look: Space or Esc closes, arrows walk the list. */
export function QuickLook({ entry, size, theme, position, onStep, onOpen, onClose, onError, readOnly, editing, editCrop, onEditingChange }: Props): React.JSX.Element {
  const dirty = useRef(false)
  const onDirtyChange = useCallback((d: boolean) => void (dirty.current = d), [])
  const close = (): void => {
    if (editing && dirty.current && !window.confirm(t('imageEditor.discard'))) return
    onClose()
  }

  useEffect(() => {
    if (editing) return // the editor handles its own keys
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      // The text viewer and media controls keep their own arrows and Space.
      const inViewer = !!target.closest?.('.preview-editor, video, audio')
      let handled = true
      if (e.key === 'Escape' || (e.key === ' ' && !inViewer)) onClose()
      else if (!inViewer && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) onStep(-1)
      else if (!inViewer && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) onStep(1)
      else if (e.key === 'Enter' && !inViewer) onOpen()
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onStep, onOpen, onClose, editing])

  const bytes = entry.size ?? size?.size
  return (
    <div className="modal-backdrop quicklook-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="xp-window quicklook" role="dialog" aria-label={entry.name}>
        <div className="titlebar" onPointerDown={dragDialog}>
          <Icon name={entry.kind} size={16} />
          <span className="titlebar-text">{entry.name}</span>
          <div className="titlebar-buttons">
            <button className="tb-btn tb-close" title={t('preview.close')} onClick={close}>
              <span className="glyph-close">✕</span>
            </button>
          </div>
        </div>
        <div className="quicklook-bar">
          <button className="xp-button" title={t('preview.prev')} disabled={editing || position.index <= 0} onClick={() => onStep(-1)}>
            ◀
          </button>
          <button className="xp-button" title={t('preview.next')} disabled={editing || position.index >= position.count - 1} onClick={() => onStep(1)}>
            ▶
          </button>
          <span className="quicklook-meta">
            {kindLabel(entry)}
            {bytes != null ? ` · ${formatSize(bytes)}` : ''} · {position.index + 1} / {position.count}
          </span>
          {imageEditable(entry, readOnly) && !editing && (
            <button className="xp-button" onClick={() => onEditingChange(true)}>
              {t('preview.edit')}
            </button>
          )}
          <button className="xp-button" disabled={editing} onClick={onOpen}>
            {t('action.open')}
          </button>
        </div>
        <div className="quicklook-body">
          {editing && imageEditable(entry, readOnly) ? (
            <Suspense fallback={<p className="preview-note center">{t('preview.loading')}</p>}>
              <ImageEditor key={entry.path} entry={entry} onExit={() => onEditingChange(false)} onDirtyChange={onDirtyChange} startWithCrop={editCrop} />
            </Suspense>
          ) : (
            <Preview entry={entry} size={size} theme={theme} mode="overlay" readOnly={readOnly} onError={onError} />
          )}
        </div>
      </div>
    </div>
  )
}
