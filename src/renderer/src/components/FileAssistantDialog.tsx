import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import {
  ASSISTANT_MODES,
  ASSISTANT_CATEGORIES,
  type AssistantMode,
  type AssistantPlan,
  type AssistantEdit,
  type AssistantApplied,
  type AssistantStatus
} from '@shared/fileAssistant'
import { resizeCursor, resizeDialog } from '@renderer/lib/dragDialog'
import { DialogTitleBar, useModalDialog } from './Dialog'
interface Props {
  folder: string
  paths: string[]
  initialMode: AssistantMode
  onClose(): void
  onSelect(paths: string[]): void
  onApplied(): void
}
export function FileAssistantDialog({ folder, paths, initialMode, onClose, onSelect, onApplied }: Props): React.JSX.Element {
  const alive = useRef(true)
  const modal = useModalDialog(() => {
    if (!busy) onClose()
  })
  const [mode, setMode] = useState(initialMode),
    [goal, setGoal] = useState(''),
    [candidates, setCandidates] = useState('')
  const [categories, setCategories] = useState(ASSISTANT_CATEGORIES.map((c) => t(`assistant.category.${c}`)).join(', '))
  const [plan, setPlan] = useState<AssistantPlan | null>(null),
    [edits, setEdits] = useState<AssistantEdit[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<AssistantApplied | null>(null)
  const [status, setStatus] = useState<AssistantStatus | null>(null),
    [copy, setCopy] = useState(false),
    [destination, setDestination] = useState('')
  useEffect(() => {
    alive.current = true
    const refresh = (): void => {
      void window.api.fileAssistant
        .status()
        .then((s) => {
          if (alive.current) setStatus(s)
        })
        .catch(() => {})
    }
    refresh()
    const off = window.api.fileAssistant.onChanged(refresh)
    return () => {
      alive.current = false
      off()
      void window.api.fileAssistant.cancel()
    }
  }, [])
  const invalidate = (): void => {
    setPlan(null)
    setResult(null)
    setError('')
  }
  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      if (alive.current) setError(String(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const analyze = (): void => {
    void run(async () => {
      setPlan(null)
      setResult(null)
      const next = await window.api.fileAssistant.analyze({
        folder,
        paths,
        mode,
        goal,
        candidates: candidates
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        categories: categories
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      })
      if (!alive.current) return
      setPlan(next)
      setEdits(next.rows.map((r) => ({ path: r.path, choice: r.choice, selected: !r.review && !['skip', 'exclude', 'fits'].includes(r.choice) })))
    })
  }
  const browse = (handoff = false): void => {
    void run(async () => {
      const p = await window.api.fileAssistant.pickFolder()
      if (p && alive.current) {
        if (handoff) setDestination(p)
        else {
          invalidate()
          setCandidates((s) => (s ? `${s}\n${p}` : p))
        }
      }
    })
  }
  const apply = (): void => {
    void run(async () => {
      if (!plan) return
      if (mode === 'search' || mode === 'placement') {
        onSelect(edits.filter((e) => e.selected).map((e) => e.path))
        onClose()
        return
      }
      const applied = await window.api.fileAssistant.apply({
        planId: plan.id,
        edits,
        operation: mode === 'tags' ? 'tags' : mode === 'application' ? 'open' : mode === 'handoff' || copy ? 'copy' : 'move',
        destination
      })
      if (!alive.current) return
      setResult(applied)
      setPlan(null)
      onApplied()
    })
  }
  return (
    <dialog
      ref={modal.ref}
      className="xp-window dialog file-assistant-dialog"
      onPointerDown={resizeDialog}
      onPointerMove={resizeCursor}
      onCancel={modal.onCancel}
      aria-labelledby="assistant-title"
    >
      <DialogTitleBar title={t('assistant.title')} titleId="assistant-title" onClose={onClose} closeDisabled={busy} />
      <div className="assistant-content">
        <p className="settings-note">
          {paths.length ? t('assistant.scope', { n: paths.length }) : t('assistant.scopeFolder')} · {folder}
        </p>
        <label className="settings-field">
          <span>{t('assistant.mode')}</span>
          <select
            disabled={busy}
            value={mode}
            onChange={(e) => {
              invalidate()
              setMode(e.target.value as AssistantMode)
            }}
          >
            {ASSISTANT_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`assistant.mode.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="assistant-field">
          {t('assistant.goal')}
          <textarea
            rows={2}
            maxLength={1000}
            disabled={busy}
            value={goal}
            placeholder={t('assistant.goalHint')}
            onChange={(e) => {
              invalidate()
              setGoal(e.target.value)
            }}
          />
        </label>
        {['destination', 'project'].includes(mode) && (
          <label className="assistant-field">
            {t('assistant.candidates')}
            <textarea
              rows={3}
              disabled={busy}
              value={candidates}
              onChange={(e) => {
                invalidate()
                setCandidates(e.target.value)
              }}
            />
            <button className="xp-button" disabled={busy} onClick={() => browse()}>
              {t('assistant.browse')}
            </button>
          </label>
        )}
        {['organize', 'tags'].includes(mode) && (
          <label className="assistant-field">
            {t('assistant.categories')}
            <input
              disabled={busy}
              value={categories}
              onChange={(e) => {
                invalidate()
                setCategories(e.target.value)
              }}
            />
          </label>
        )}
        <p className="settings-note">
          {t('assistant.scoreHint')} {t('assistant.noChanges')}
        </p>
        {!status?.ready && <p>{t('assistant.missing')}</p>}
        <div className="activity-actions">
          <button className="xp-button" disabled={busy || !status?.ready || !status.enabled} onClick={analyze}>
            {t('assistant.analyze')}
          </button>
          {busy && (
            <button className="xp-button" onClick={() => void window.api.fileAssistant.cancel()}>
              {t('assistant.cancel')} {status?.done}/{status?.total}
            </button>
          )}
        </div>
        {plan && (
          <>
            <h3>{t('assistant.preview')}</h3>
            <div className="assistant-results">
              {plan.rows.map((row, i) => (
                <div className="assistant-row" key={row.path}>
                  <input
                    aria-label={`${t('assistant.selected')}: ${row.path}`}
                    type="checkbox"
                    disabled={busy}
                    checked={edits[i].selected}
                    onChange={(e) => setEdits((s) => s.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))}
                  />
                  <div className="assistant-file">
                    <strong>{row.path.split(/[\\/]/).pop()}</strong>
                    <small>{row.path}</small>
                    <small>
                      {t(`assistant.${row.content}`)}
                      {row.tags.length ? ` · ${row.tags.join(', ')}` : ''}
                    </small>
                    {row.review && (
                      <small className="assistant-review">
                        {t('assistant.review')}
                        {row.truncated ? ` · ${t('assistant.truncated')}` : ''}
                      </small>
                    )}
                  </div>
                  <div className="assistant-choice">
                    <select
                      aria-label={`${t('assistant.proposal')}: ${row.path}`}
                      disabled={busy}
                      value={edits[i].choice}
                      onChange={(e) => setEdits((s) => s.map((x, j) => (j === i ? { ...x, choice: e.target.value } : x)))}
                    >
                      {plan.choices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {['skip', 'include', 'exclude', 'fits', 'misplaced', 'review'].includes(c.id) ? t(`assistant.${c.id}` as 'assistant.skip') : c.label}
                        </option>
                      ))}
                    </select>
                    {plan.choices.find((c) => c.id === edits[i].choice)?.destination && (
                      <small>{plan.choices.find((c) => c.id === edits[i].choice)!.destination}</small>
                    )}
                  </div>
                  <span title={t('assistant.scoreHint')}>{Math.round(row.score * 100)}%</span>
                </div>
              ))}
            </div>
            {plan.omitted > 0 && <p>{t('assistant.omitted', { n: plan.omitted })}</p>}
            {['destination', 'project', 'organize'].includes(mode) && (
              <label>
                <input type="checkbox" checked={copy} disabled={busy} onChange={(e) => setCopy(e.target.checked)} />
                {t('assistant.copy')}
              </label>
            )}
            {mode === 'handoff' && (
              <div className="activity-actions">
                <input aria-label={t('assistant.handoffFolder')} readOnly value={destination} />
                <button className="xp-button" disabled={busy} onClick={() => browse(true)}>
                  {t('assistant.handoffFolder')}
                </button>
              </div>
            )}
            <p>
              <button
                className="xp-button"
                disabled={busy || !edits.some((e) => e.selected && e.choice !== 'skip') || (mode === 'handoff' && !destination)}
                onClick={apply}
              >
                {t(
                  mode === 'tags'
                    ? 'assistant.saveTags'
                    : mode === 'application'
                      ? 'assistant.open'
                      : mode === 'search' || mode === 'placement'
                        ? 'assistant.select'
                        : mode === 'handoff' || copy
                          ? 'assistant.copy'
                          : 'assistant.move'
                )}
              </button>
            </p>
          </>
        )}
        {result && (
          <div role="status">
            <p>{t('assistant.done', { n: result.completed.length, failed: result.failed.length })}</p>
            {result.completed.map((r) => (
              <small className="assistant-result-path" key={r.path}>
                {r.destination ?? r.path}
                {r.tags ? ` · ${r.tags.join(', ')}` : ''}
              </small>
            ))}
            {result.failed.map((r) => (
              <p className="activity-error" key={r.path}>
                {r.path}: {r.error}
              </p>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="activity-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  )
}
