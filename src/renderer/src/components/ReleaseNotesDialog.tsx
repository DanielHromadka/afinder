import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { ReleaseNote } from '@shared/releaseNotes'
import { dateFormat } from '@renderer/lib/format'
import { Dialog } from './Dialog'

const RELEASES_URL = 'https://github.com/DanielHromadka/afinder-downloads/releases'

/** "What's new": the notes bundled with this build, newest first, this version marked. */
export function ReleaseNotesDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null)
  const close = useRef<HTMLButtonElement>(null)
  const current = window.api.about.version
  useEffect(() => {
    window.api.releaseNotes.list().then(setNotes, () => setNotes([]))
  }, [])
  const date = (iso: string): string => {
    const ms = Date.parse(iso)
    return Number.isNaN(ms) ? '' : dateFormat('day', { day: 'numeric', month: 'long', year: 'numeric' }).format(ms)
  }
  return (
    <Dialog title={t('releaseNotes.title')} className="release-notes" onClose={onClose} closeOnBackdrop initialFocus={close}>
        <div className="release-notes-body">
          {notes === null ? null : notes.length === 0 ? (
            <p className="tool-muted">{t('releaseNotes.none')}</p>
          ) : (
            notes.map((n) => (
              <section key={n.version} className={n.version === current ? 'current' : ''}>
                <h4>
                  aFinder {n.version}
                  {n.version === current && <span className="release-notes-badge">{t('releaseNotes.installed')}</span>}
                  <span className="release-notes-date">{date(n.date)}</span>
                </h4>
                <ul>
                  {n.notes.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="dialog-buttons right">
          <a className="release-notes-link" href={RELEASES_URL} target="_blank" rel="noreferrer">
            {t('releaseNotes.all')}
          </a>
          <button ref={close} className="xp-button" onClick={onClose}>
            {t('dialog.ok')}
          </button>
        </div>
    </Dialog>
  )
}
