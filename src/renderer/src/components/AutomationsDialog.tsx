import { useEffect, useRef, useState } from 'react'
import { getLanguage, locale, t } from '@shared/i18n'
import { validateAutomationDraft, type Automation, type AutomationDraft, type AutomationTrigger } from '@shared/automation'
import { syncAutomation } from '@shared/automationSync'
import { resizeCursor, resizeDialog } from '@renderer/lib/dragDialog'
import { DialogTitleBar, useModalDialog } from './Dialog'

const api = window.api.automations
const active = (item?: Automation): boolean => item?.runs[0]?.status === 'running' || item?.runs[0]?.status === 'verifying'
const date = (value: number): string => new Date(value).toLocaleString(locale())
const triggerName = (trigger: AutomationTrigger): string =>
  trigger.kind === 'interval'
    ? `${t('automation.interval')} · ${trigger.minutes} min`
    : trigger.kind === 'daily'
      ? `${t('automation.daily')} · ${trigger.time}`
      : t(`automation.${trigger.kind}`)

export function AutomationsDialog({ cwd, onClose }: { cwd: string; onClose(): void }): React.JSX.Element {
  const modal = useModalDialog(() => close())
  const history = useRef<HTMLElement>(null)
  const mounted = useRef(true)
  const [items, setItems] = useState<Automation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<AutomationDraft | null>(null)
  const [baseline, setBaseline] = useState('null')
  const [request, setRequest] = useState('')
  const [composerOpen, setComposerOpen] = useState(true)
  const [questions, setQuestions] = useState<string[]>([])
  const [source, setSource] = useState(cwd)
  const [destination, setDestination] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const current = items.find((i) => i.id === selected)
  const running = active(current)
  const dirty = JSON.stringify(draft) !== baseline

  const refresh = async (): Promise<void> => {
    try {
      const all = await api.list()
      if (mounted.current) {
        setItems(all)
        setLoaded(true)
        setLoadError('')
      }
    } catch (e) {
      if (mounted.current) setLoadError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    mounted.current = true
    void refresh()
    const unsubscribe = api.onChanged(() => void refresh())
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [])

  const discard = (): boolean => !dirty || window.confirm(t('automation.discard'))
  const close = (): void => {
    if (discard()) onClose()
  }
  const select = (item: Automation | null): void => {
    if (!discard()) return
    const next = item ? validateAutomationDraft(item) : null
    setSelected(item?.id ?? null)
    setDraft(next)
    setBaseline(JSON.stringify(next))
    setRequest(item?.description ?? '')
    setComposerOpen(!item)
    setQuestions([])
    setError('')
    setNotice('')
  }
  const change = (patch: Partial<AutomationDraft>): void => {
    if (draft) setDraft({ ...draft, ...patch })
    setNotice('')
  }
  const action = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const generate = async (): Promise<void> => {
    if (dirty && !discard()) return
    setGenerating(true)
    setError('')
    setNotice('')
    setQuestions([])
    try {
      const result = await api.generate(request, cwd, getLanguage())
      if (!mounted.current) return
      if (result.kind === 'questions') setQuestions(result.questions)
      else {
        setDraft(result.draft)
        setComposerOpen(false)
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setGenerating(false)
    }
  }
  const template = (): void => {
    if (!discard()) return
    const absolute = (p: string): boolean => (window.api.platform === 'win32' ? /^(?:[a-z]:[\\/]|\\\\)/i.test(p) : p.startsWith('/'))
    if (!absolute(source.trim()) || !absolute(destination.trim()) || source.trim() === destination.trim()) {
      setError(t('automation.localPaths'))
      return
    }
    setDraft(syncAutomation(source.trim(), destination.trim(), minutes))
    setComposerOpen(false)
    setError('')
    setNotice('')
  }
  const save = (): void => {
    void action(async () => {
      const clean = validateAutomationDraft(draft ? { ...draft, workflow: draft.workflow.filter((step) => step.trim()) } : null)
      const id = await api.save(selected, clean)
      if (mounted.current) {
        setSelected(id)
        setDraft(clean)
        setBaseline(JSON.stringify(clean))
        setNotice(t('automation.saved'))
      }
    })
  }
  const blocked = busy || generating || !loaded || !!loadError

  return (
    <dialog
      ref={modal.ref}
      className="xp-window dialog automations-dialog"
      onPointerDown={resizeDialog}
      onPointerMove={resizeCursor}
      aria-labelledby="automations-title"
      onCancel={modal.onCancel}
    >
      <DialogTitleBar title={t('automation.title')} titleId="automations-title" onClose={close} />
      <div className="automation-layout">
        <aside className="automation-list" aria-label={t('automation.title')}>
          <button className="xp-button automation-new" disabled={blocked} onClick={() => select(null)}>
            + {t('automation.new')}
          </button>
          {!items.length && loaded && <p className="automation-note">{t('automation.empty')}</p>}
          {items.map((item) => (
            <button
              key={item.id}
              className={`automation-list-item${selected === item.id ? ' selected' : ''}`}
              aria-pressed={selected === item.id}
              disabled={generating || busy}
              onClick={() => select(item)}
            >
              <strong>{item.name}</strong>
              <span>{triggerName(item.trigger)}</span>
              <span className={`automation-state ${active(item) ? 'working' : item.enabled ? 'enabled' : ''}`}>
                {active(item) ? t(`automation.${item.runs[0].status}`) : item.enabled ? t('automation.enabled') : t('automation.paused')}
              </span>
            </button>
          ))}
          <p className="automation-note automation-schedule-note">{t('automation.scheduleNote')}</p>
        </aside>
        <main className="automation-detail">
          {loadError && (
            <div role="alert" className="automation-error">
              <strong>{t('automation.loadError')}</strong>
              <p>{loadError}</p>
              <button className="xp-button" onClick={() => void refresh()}>
                {t('automation.retry')}
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="automation-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="automation-notice">
              {notice}
            </p>
          )}
          {current?.runs[0] && (
            <div className={`automation-current-run ${current.runs[0].status}`}>
              <span role="status">{t(`automation.${current.runs[0].status}`)}</span>
              <button className="xp-button" onClick={() => history.current?.scrollIntoView({ block: 'start' })}>
                {t('automation.viewLog')}
              </button>
            </div>
          )}
          <details className="automation-composer" open={composerOpen} onToggle={(e) => setComposerOpen(e.currentTarget.open)}>
            <summary>{t('automation.request')}</summary>
            <p className="automation-note">{t('automation.hint')}</p>
            <label>
              <span className="sr-only">{t('automation.request')}</span>
              <textarea
                rows={4}
                maxLength={16000}
                value={request}
                disabled={generating}
                placeholder={t('automation.placeholder')}
                onChange={(e) => setRequest(e.target.value)}
              />
            </label>
            {questions.length > 0 && (
              <div className="automation-questions" role="status">
                <strong>{t('automation.questions')}</strong>
                <ul>
                  {questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            <button className="xp-button" disabled={blocked || !request.trim() || running} onClick={() => void generate()}>
              {generating ? t('automation.generating') : t('automation.generate')}
            </button>
            <p className="automation-note">{t('automation.agentNote')}</p>
            <details className="automation-template">
              <summary>{t('automation.template')}</summary>
              <div className="automation-fields">
                <label>
                  {t('automation.source')}
                  <input value={source} onChange={(e) => setSource(e.target.value)} />
                </label>
                <label>
                  {t('automation.destination')}
                  <input value={destination} onChange={(e) => setDestination(e.target.value)} />
                </label>
                <label>
                  {t('automation.minutes')}
                  <input type="number" min={1} max={525600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
                </label>
              </div>
              <p className="automation-note">{t('automation.templateHint')}</p>
              <button
                className="xp-button"
                disabled={blocked || running || !source.trim() || !destination.trim() || !Number.isInteger(minutes) || minutes < 1 || minutes > 525600}
                onClick={template}
              >
                {t('automation.useTemplate')}
              </button>
            </details>
          </details>
          {draft && (
            <section className="automation-editor">
              <fieldset disabled={blocked || running}>
                <div className="automation-fields">
                  <label>
                    {t('automation.name')}
                    <input value={draft.name} maxLength={120} onChange={(e) => change({ name: e.target.value })} />
                  </label>
                  <label>
                    {t('automation.trigger')}
                    <select
                      value={draft.trigger.kind}
                      onChange={(e) =>
                        change({
                          trigger:
                            e.target.value === 'interval'
                              ? { kind: 'interval', minutes: 60 }
                              : e.target.value === 'daily'
                                ? { kind: 'daily', time: '09:00' }
                                : { kind: e.target.value as 'manual' | 'startup' }
                        })
                      }
                    >
                      {(['manual', 'interval', 'daily', 'startup'] as const).map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`automation.${kind}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.trigger.kind === 'interval' && (
                    <label>
                      {t('automation.minutes')}
                      <input
                        type="number"
                        min={1}
                        max={525600}
                        value={draft.trigger.minutes}
                        onChange={(e) => change({ trigger: { kind: 'interval', minutes: Number(e.target.value) } })}
                      />
                    </label>
                  )}
                  {draft.trigger.kind === 'daily' && (
                    <label>
                      {t('automation.time')}
                      <input type="time" value={draft.trigger.time} onChange={(e) => change({ trigger: { kind: 'daily', time: e.target.value } })} />
                    </label>
                  )}
                  <label>
                    {t('automation.timeout')}
                    <input
                      type="number"
                      min={10}
                      max={86400}
                      value={draft.timeoutSeconds}
                      onChange={(e) => change({ timeoutSeconds: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <label>
                  {t('automation.description')}
                  <textarea rows={2} value={draft.description} onChange={(e) => change({ description: e.target.value })} />
                </label>
                <label>
                  {t('automation.workflow')}
                  <textarea rows={4} value={draft.workflow.join('\n')} onChange={(e) => change({ workflow: e.target.value.split('\n') })} />
                </label>
                <label>
                  {t('automation.outcome')}
                  <textarea rows={3} value={draft.outcome} onChange={(e) => change({ outcome: e.target.value })} />
                </label>
                <details className="automation-code">
                  <summary>{t('automation.code')}</summary>
                  <label>
                    {t('automation.script')}
                    <textarea spellCheck={false} rows={15} value={draft.script} onChange={(e) => change({ script: e.target.value })} />
                  </label>
                  <label>
                    {t('automation.verification')}
                    <textarea spellCheck={false} rows={12} value={draft.verificationScript} onChange={(e) => change({ verificationScript: e.target.value })} />
                  </label>
                </details>
              </fieldset>
              <p className="automation-note">{t('automation.permissions')}</p>
              {dirty && (
                <p className="automation-note" role="status">
                  {t('automation.unsaved')}
                </p>
              )}
              <div className="automation-actions">
                <button className="xp-button" disabled={blocked || running || !dirty} onClick={save}>
                  {t('automation.save')}
                </button>
                {current && (
                  <>
                    <button
                      className="xp-button"
                      disabled={blocked || (!running && dirty)}
                      onClick={() =>
                        void action(() => (running ? api.cancel(current.id) : api.run(current.id))).then(() =>
                          history.current?.scrollIntoView({ block: 'start' })
                        )
                      }
                    >
                      {running ? t('automation.stop') : t('automation.run')}
                    </button>
                    {current.trigger.kind !== 'manual' && (
                      <button className="xp-button" disabled={blocked || dirty} onClick={() => void action(() => api.enable(current.id, !current.enabled))}>
                        {current.enabled ? t('automation.pause') : t('automation.enable')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
          {current && (
            <section ref={history} className="automation-history">
              <div className="automation-history-heading">
                <h2>{t('automation.history')}</h2>
                <span className="automation-state">{current.enabled ? t('automation.enabled') : t('automation.paused')}</span>
              </div>
              {current.nextRunAt && <p className="automation-note">{t('automation.next', { time: date(current.nextRunAt) })}</p>}
              {!current.runs.length && <p className="automation-note">{t('automation.noRuns')}</p>}
              {current.runs.map((run, i) => (
                <details key={run.id} className={`automation-run ${run.status}`} open={i === 0 ? true : undefined}>
                  <summary>
                    <span>{t(`automation.${run.status}`)}</span>
                    <time dateTime={new Date(run.startedAt).toISOString()}>{date(run.startedAt)}</time>
                  </summary>
                  {run.error && <p className="automation-error">{run.error}</p>}
                  <pre aria-label={t('automation.history')}>{run.log || '…'}</pre>
                </details>
              ))}
              <button
                className="xp-button automation-remove"
                disabled={blocked || running}
                onClick={() => {
                  if (window.confirm(t('automation.confirmRemove')))
                    void action(async () => {
                      await api.remove(current.id)
                      setSelected(null)
                      setDraft(null)
                      setBaseline('null')
                      setComposerOpen(true)
                    })
                }}
              >
                {t('automation.remove')}
              </button>
            </section>
          )}
        </main>
      </div>
    </dialog>
  )
}
