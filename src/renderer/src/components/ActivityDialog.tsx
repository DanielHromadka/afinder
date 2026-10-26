import { useEffect, useRef, useState } from 'react'
import { t, locale, type MessageKey } from '@shared/i18n'
import { ACTIVITY_ACTIONS, type ActivityAction, type ActivityPage, type ActivityQuery, type ActivityStatus } from '@shared/activity'
import { resizeCursor, resizeDialog } from '@renderer/lib/dragDialog'
import { DialogTitleBar, useModalDialog } from './Dialog'

export function ActivityDialog({ cwd, onClose, onOpenFolder }: { cwd: string; onClose(): void; onOpenFolder(folder: string): void }): React.JSX.Element {
  const modal = useModalDialog(onClose)
  const [status, setStatus] = useState<ActivityStatus | null>(null)
  const [query, setQuery] = useState<ActivityQuery>({ mode: 'text', text: '', action: '', folder: '' })
  const applied = useRef<ActivityQuery>({})
  const request = useRef(0)
  const [page, setPage] = useState<ActivityPage>({ events: [], total: 0, partial: false })
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [folder, setFolder] = useState(cwd)
  const load = async (q: ActivityQuery, start = 0): Promise<void> => {
    const id = ++request.current
    setBusy(true)
    setError('')
    applied.current = q
    try {
      const result = await window.api.activity.query({ ...q, offset: start, limit: 50 })
      if (id === request.current) {
        setPage(result)
        setOffset(start)
      }
    } catch (e) {
      if (id === request.current) setError(String(e))
    } finally {
      if (id === request.current) setBusy(false)
    }
  }
  useEffect(() => {
    void load({})
    let alive = true
    const refresh = (): void => {
      void window.api.activity.status().then(
        (s) => {
          if (alive) setStatus(s)
        },
        (e) => {
          if (alive) setError(String(e))
        }
      )
    }
    refresh()
    const stop = window.api.activity.onChanged(refresh)
    return () => {
      alive = false
      request.current++
      stop()
    }
  }, [])
  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.api.activity.note(folder, label, note)
      setNote('')
      setLabel('')
      await load(applied.current)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }
  const clear = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.activity.clear()
      setConfirmClear(false)
      await load({})
      setQuery({ mode: 'text' })
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={modal.ref}
      className="xp-window dialog activity-dialog"
      onPointerDown={resizeDialog}
      onPointerMove={resizeCursor}
      aria-labelledby="activity-title"
      onCancel={modal.onCancel}
    >
      <DialogTitleBar title={t('activity.title')} titleId="activity-title" onClose={onClose} />
      <div className="activity-content">
        {!status?.enabled && <p className="settings-note">{t('activity.off')}</p>}
        <form
          className="activity-search"
          onSubmit={(e) => {
            e.preventDefault()
            void load(query)
          }}
        >
          <input
            aria-label={t('activity.search')}
            placeholder={t('activity.search')}
            value={query.text ?? ''}
            maxLength={500}
            onChange={(e) => setQuery({ ...query, text: e.target.value })}
          />
          <select
            aria-label={t('activity.semantic')}
            value={query.mode ?? 'text'}
            onChange={(e) => setQuery({ ...query, mode: e.target.value as ActivityQuery['mode'] })}
          >
            <option value="text">{t('activity.text')}</option>
            <option value="semantic" disabled={!status?.enabled || !status.semanticEnabled || !status.modelReady}>
              {t('activity.meaning')}
            </option>
          </select>
          <select aria-label={t('activity.all')} value={query.action ?? ''} onChange={(e) => setQuery({ ...query, action: e.target.value as ActivityAction })}>
            <option value="">{t('activity.all')}</option>
            {ACTIVITY_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`activity.action.${a}` as MessageKey)}
              </option>
            ))}
          </select>
          <input
            aria-label={t('activity.folder')}
            placeholder={t('activity.folder')}
            value={query.folder ?? ''}
            onChange={(e) => setQuery({ ...query, folder: e.target.value })}
          />
          <button className="xp-button" disabled={busy}>
            {t('activity.find')}
          </button>
        </form>
        {error && (
          <p className="activity-error" role="alert">
            {error}
          </p>
        )}
        {page.partial && <p role="status">{t('activity.partial')}</p>}
        <div className="activity-events" aria-busy={busy}>
          {!page.events.length && <p className="settings-note">{t('activity.empty')}</p>}
          {page.events.map((event) => (
            <article className="activity-event" key={event.id}>
              <div className="activity-event-heading">
                <strong>{event.label || t(`activity.action.${event.action}` as MessageKey)}</strong>
                <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString(locale())}</time>
              </div>
              <div className={`activity-outcome ${event.outcome}`}>
                {t(`activity.action.${event.action}` as MessageKey)} · {t(`activity.${event.outcome}` as MessageKey)}
                {event.errorCode ? ` (${event.errorCode})` : ''}
                {event.count ? ` · ${event.count}` : ''}
              </div>
              {event.folder && (
                <button className="link-button activity-path" onClick={() => onOpenFolder(event.folder!)}>
                  {event.folder}
                </button>
              )}
              {event.paths.map((p, i) => (
                <div className="activity-path" key={`${i}:${p}`}>
                  {p}
                  {event.destinations[i] ? ` → ${event.destinations[i]}` : ''}
                </div>
              ))}
              {!event.paths.length &&
                event.destinations.map((p) => (
                  <div className="activity-path" key={p}>
                    → {p}
                  </div>
                ))}
              {event.note && <p className="activity-fragment">{event.note}</p>}
            </article>
          ))}
        </div>
        <div className="activity-actions">
          <button className="xp-button" disabled={busy || !offset} onClick={() => void load(applied.current, Math.max(0, offset - 50))}>
            {t('activity.previous')}
          </button>
          <span>{page.total ? `${offset + 1}–${Math.min(offset + 50, page.total)} / ${page.total}` : '0'}</span>
          <button className="xp-button" disabled={busy || offset + 50 >= page.total} onClick={() => void load(applied.current, offset + 50)}>
            {t('activity.next')}
          </button>
        </div>
        <details>
          <summary>{t('activity.fragment')}</summary>
          <form
            className="activity-note"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <input required aria-label={t('activity.folder')} value={folder} onChange={(e) => setFolder(e.target.value)} />
            <input
              aria-label={t('activity.label')}
              placeholder={t('activity.label')}
              value={label}
              maxLength={300}
              onChange={(e) => setLabel(e.target.value)}
            />
            <textarea
              required
              aria-label={t('activity.content')}
              placeholder={t('activity.content')}
              value={note}
              maxLength={8000}
              rows={4}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="xp-button" disabled={busy || !status?.enabled || !note.trim()}>
              {t('activity.fragment')}
            </button>
          </form>
        </details>
        <div className="activity-actions">
          <button className="xp-button" disabled={busy} onClick={() => void window.api.activity.export({}).catch((e) => setError(String(e)))}>
            {t('activity.export')}
          </button>
          <button className="xp-button" disabled={busy || (!page.total && !status?.total)} onClick={() => setConfirmClear(true)}>
            {t('activity.clear')}
          </button>
        </div>
        {confirmClear && (
          <div role="alert">
            <p>{t('activity.confirm')}</p>
            <button className="xp-button" disabled={busy} onClick={() => void clear()}>
              {t('activity.clear')}
            </button>
            <button className="xp-button" onClick={() => setConfirmClear(false)}>
              {t('window.close')}
            </button>
          </div>
        )}
      </div>
      <div className="dialog-buttons">
        <button className="xp-button" onClick={onClose}>
          {t('window.close')}
        </button>
      </div>
    </dialog>
  )
}
