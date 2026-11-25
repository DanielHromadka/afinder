import { useEffect, useRef, useState } from 'react'
import { locale, plural, t } from '@shared/i18n'
import type { FileEntry, Settings } from '@shared/types'
import { TRANSCRIBE_LANGUAGES, WHISPER_MODELS } from '@shared/whisper'
import type { TranscribeOptions } from '../lib/transcribe'
import { Dialog } from './Dialog'

const STORE = 'afinder.transcribe'

/** Language and output of a transcription; offers the model download when it is not on disk yet. */
export function TranscribeDialog({ entries, settings, onStart, onCancel }: { entries: FileEntry[]; settings: Settings; onStart(o: TranscribeOptions): void; onCancel(): void }): React.JSX.Element {
  const [language, setLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem(`${STORE}.language`) ?? ''
    } catch {
      return ''
    }
  })
  const [format, setFormat] = useState<'srt' | 'txt'>('srt')
  const [ready, setReady] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const first = useRef<HTMLSelectElement>(null)
  const model = settings.transcribeModel

  useEffect(() => {
    let alive = true
    void window.api.transcribe.status().then((s) => alive && setReady(s[model]), () => alive && setReady(false))
    const off = window.api.transcribe.onProgress((p) => alive && setProgress(p))
    return () => {
      alive = false
      off()
    }
  }, [model])

  const download = async (): Promise<void> => {
    setError('')
    setProgress(0)
    try {
      await window.api.transcribe.download(model)
      setReady(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProgress(null)
    }
  }
  const submit = (): void => {
    if (!ready) return
    try {
      localStorage.setItem(`${STORE}.language`, language)
    } catch {
      /* not remembered */
    }
    onStart({ model, language: language || null, format })
  }

  return (
    <Dialog title={t('transcribe.title')} className="batch-rename" onClose={onCancel} initialFocus={first} onSubmit={submit}>
      <div className="batch-form">
        <label>
          <span>{t('transcribe.language')}</span>
          <select ref={first} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{t('transcribe.language.auto')}</option>
            {TRANSCRIBE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {new Intl.DisplayNames([locale()], { type: 'language' }).of(code) ?? code}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('transcribe.format')}</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as 'srt' | 'txt')}>
            <option value="srt">{t('transcribe.format.srt')}</option>
            <option value="txt">{t('transcribe.format.txt')}</option>
          </select>
        </label>
        <p className="batch-hint">{t(`transcribe.model.${model}`, { mb: WHISPER_MODELS[model].megabytes })}</p>
        {ready === false && (
          <div className="batch-hint">
            <p>{t('transcribe.needModel')}</p>
            <button type="button" className="xp-button" disabled={progress !== null} onClick={() => void download()}>
              {progress !== null ? `${Math.round(progress)} %` : t('transcribe.download', { mb: WHISPER_MODELS[model].megabytes })}
            </button>
          </div>
        )}
        {error && <p className="batch-hint error">{error}</p>}
        <p className="batch-hint">{t('transcribe.hint')}</p>
      </div>
      <div className="dialog-buttons right">
        <span className="batch-summary">{plural('count.items', entries.length)}</span>
        <button type="submit" className="xp-button" disabled={!ready}>
          {t('transcribe.start')}
        </button>
        <button type="button" className="xp-button" onClick={onCancel}>
          {t('dialog.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
