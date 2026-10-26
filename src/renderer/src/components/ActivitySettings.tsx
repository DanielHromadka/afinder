import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { ACTIVITY_RETENTION, type ActivityStatus } from '@shared/activity'
import type { Settings } from '@shared/types'

export function ActivitySettings({ settings, onChange, onOpen }: { settings: Settings; onChange(patch: Partial<Settings>): void; onOpen(): void }): React.JSX.Element {
  const [status, setStatus] = useState<ActivityStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const refresh = (): void => { void window.api.activity.status().then((s) => { if (alive) setStatus(s) }, (e) => { if (alive) setError(String(e)) }) }
    refresh()
    const stop = window.api.activity.onChanged(refresh)
    return () => { alive = false; stop() }
  }, [])
  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await work(); setStatus(await window.api.activity.status()) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const enabled = settings.activityEnabled && settings.semanticEnabled
  return <fieldset>
    <legend>{t('activity.title')}</legend>
    <label className="settings-check"><input type="checkbox" checked={settings.activityEnabled} onChange={(e) => onChange({ activityEnabled: e.target.checked })} />{t('activity.enable')}</label>
    <p className="settings-note">{t('activity.privacy')}</p>
    <label className="settings-field"><span>{t('activity.retention')}</span><select value={settings.activityRetentionDays} onChange={(e) => onChange({ activityRetentionDays: Number(e.target.value) })}>{ACTIVITY_RETENTION.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    <label className="settings-check"><input type="checkbox" disabled={!settings.activityEnabled} checked={settings.semanticEnabled} onChange={(e) => onChange({ semanticEnabled: e.target.checked })} />{t('activity.semantic')}</label>
    <p className="settings-note">{t('activity.modelHint')}</p>
    {enabled && <>
      <p className="settings-note">{status?.model} · {t('activity.stats', { indexed: status?.indexed ?? 0, total: status?.total ?? 0 })}{status?.downloading ? ` · ${Math.round(status.downloadProgress)}%` : ''}</p>
      <div className="activity-actions">
        <button className="xp-button" disabled={busy || status?.downloading} onClick={() => void run(() => window.api.activity.download())}>{t('activity.download')}</button>
        <button className="xp-button" disabled={busy || !status?.modelReady || status.downloading} onClick={() => void run(() => window.api.activity.check())}>{t('activity.check')}</button>
        <button className="xp-button" disabled={busy || !status?.modelReady || status.downloading} onClick={() => void run(() => window.api.activity.rebuild())}>{t('activity.rebuild')}</button>
      </div>
    </>}
    {(error || status?.error) && <p role="alert" className="activity-error">{error || status?.error}</p>}
    <p><button className="xp-button" onClick={onOpen}>{t('activity.title')}</button></p>
  </fieldset>
}
