import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { Settings } from '@shared/types'
import { WHISPER_MODELS, type WhisperModel } from '@shared/whisper'

/** Turns speech to text on, picks the model and downloads it (only from the button). */
export function TranscribeSettings({ settings, onChange }: { settings: Settings; onChange(p: Partial<Settings>): void }): React.JSX.Element {
  const [status, setStatus] = useState<Record<WhisperModel, boolean> | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.api.transcribe.status().then((s) => alive && setStatus(s), () => {})
    const off = window.api.transcribe.onProgress((p) => alive && setProgress(p))
    return () => {
      alive = false
      off()
    }
  }, [])
  const model = settings.transcribeModel
  const download = async (): Promise<void> => {
    setError('')
    setProgress(0)
    try {
      await window.api.transcribe.download(model)
      setStatus(await window.api.transcribe.status())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProgress(null)
    }
  }
  return (
    <fieldset>
      <legend>{t('transcribe.settingsTitle')}</legend>
      <label className="settings-check">
        <input type="checkbox" checked={settings.transcribeEnabled} onChange={(e) => onChange({ transcribeEnabled: e.target.checked })} />
        {t('transcribe.enable')}
      </label>
      <p className="settings-note">{t('transcribe.privacy')}</p>
      <label className="settings-check">
        {t('transcribe.model')}
        <select value={model} disabled={!settings.transcribeEnabled || progress !== null} onChange={(e) => onChange({ transcribeModel: e.target.value as WhisperModel })}>
          {(Object.keys(WHISPER_MODELS) as WhisperModel[]).map((m) => (
            <option key={m} value={m}>
              {t(`transcribe.model.${m}`, { mb: WHISPER_MODELS[m].megabytes })}
            </option>
          ))}
        </select>
      </label>
      <p>
        {status?.[model] ? t('transcribe.ready') : t('transcribe.missing')}
        {progress !== null ? ` · ${Math.round(progress)} %` : ''}
      </p>
      <div className="activity-actions">
        <button className="xp-button" disabled={!settings.transcribeEnabled || progress !== null || status?.[model] === true} onClick={() => void download()}>
          {t('transcribe.download', { mb: WHISPER_MODELS[model].megabytes })}
        </button>
      </div>
      {error && (
        <p role="alert" className="activity-error">
          {error}
        </p>
      )}
    </fieldset>
  )
}
