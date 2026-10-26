import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { Settings } from '@shared/types'
import type { AssistantStatus } from '@shared/fileAssistant'
export function FileAssistantSettings({ settings, onChange }: { settings: Settings; onChange(p: Partial<Settings>): void }): React.JSX.Element {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const refresh = (): void => { void window.api.fileAssistant.status().then(s => { if (alive) setStatus(s) }, e => { if (alive) setError(String(e)) }) }
    refresh(); const off = window.api.fileAssistant.onChanged(refresh)
    return () => { alive = false; off() }
  }, [])
  const run = (work: () => Promise<unknown>): void => { setError(''); void work().catch(e => setError(String(e))) }
  return <fieldset><legend>{t('assistant.title')}</legend>
    <label className="settings-check"><input type="checkbox" checked={settings.fileAssistantEnabled} onChange={e => onChange({ fileAssistantEnabled: e.target.checked })}/>{t('assistant.enable')}</label>
    <p className="settings-note">{t('assistant.privacy')}</p>
    <label className="settings-check"><input type="checkbox" disabled={!settings.fileAssistantEnabled} checked={settings.fileAssistantReadContent} onChange={e => onChange({ fileAssistantReadContent: e.target.checked })}/>{t('assistant.readContent')}</label>
    <p className="settings-note">{t('assistant.contentHint')}</p><p className="settings-note">{t('assistant.modelHint')}</p>
    <p>{status?.ready ? t('assistant.ready') : t('assistant.missing')}{status?.downloading ? ` · ${Math.round(status.progress)}%` : ''}</p>
    <div className="activity-actions"><button className="xp-button" disabled={!settings.fileAssistantEnabled || status?.busy} onClick={() => run(() => window.api.fileAssistant.download())}>{t('assistant.download')}</button>
    {status?.busy && <button className="xp-button" onClick={() => run(() => window.api.fileAssistant.cancel())}>{t('assistant.cancel')}</button>}
    <button className="xp-button" disabled={status?.busy} onClick={() => { if (window.confirm(t('assistant.confirmClear'))) run(() => window.api.fileAssistant.clearTags()) }}>{t('assistant.clearTags')}</button></div>
    {(error || status?.error) && <p role="alert" className="activity-error">{error || status?.error}</p>}
  </fieldset>
}
