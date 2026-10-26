import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { Settings, ToolsProgress } from '@shared/types'
import { formatSize } from '@renderer/lib/format'

export const api = window.api

export interface ToolProps {
  /** The folder shown in the focused file list. */
  folder: string
  visible: boolean
  settings: Settings
  updateSettings(patch: Partial<Settings>): void
}

/** A value kept in localStorage: tool inputs survive restarts (a convenience, so failures are ignored). */
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`afinder.tools.${key}`)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  })
  const set = (v: T): void => {
    setValue(v)
    try {
      localStorage.setItem(`afinder.tools.${key}`, JSON.stringify(v))
    } catch {
      // full or blocked
    }
  }
  return [value, set]
}

let jobCounter = 0

/** A worker job (checksums, duplicates, disk map) with its progress and cancel. */
export function useJob<T>(): {
  run(start: (id: string) => Promise<T>): Promise<T | null>
  cancel(): void
  busy: boolean
  progress: ToolsProgress | null
  error: string | null
} {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ToolsProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<string | null>(null)
  useEffect(() => api.tools.onProgress((id, p) => id === current.current && setProgress(p)), [])
  // A job still running when the tool closes is cancelled.
  useEffect(() => () => void (current.current && api.tools.cancel(current.current)), [])
  return {
    busy,
    progress,
    error,
    async run(start) {
      const id = `job-${Date.now()}-${++jobCounter}`
      current.current = id
      setBusy(true)
      setError(null)
      setProgress(null)
      try {
        return await start(id)
      } catch (err) {
        if (current.current === id) setError((err as Error).message)
        return null
      } finally {
        if (current.current === id) {
          current.current = null
          setBusy(false)
        }
      }
    },
    cancel() {
      if (current.current) api.tools.cancel(current.current)
    }
  }
}

export function Progress({ progress, onCancel }: { progress: ToolsProgress | null; onCancel(): void }): React.JSX.Element {
  const fraction = progress && progress.total > 0 ? progress.done / progress.total : null
  return (
    <div className="tool-row">
      <div className={`tool-progress${fraction === null ? ' busy' : ''}`}>
        <div style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <span className="tool-muted">
        {progress && fraction !== null
          ? `${formatSize(progress.done)} / ${formatSize(progress.total)}`
          : progress
            ? t('tools.filesScanned', { count: progress.done.toLocaleString() })
            : t('tools.working')}
      </span>
      <button className="todo-btn" onClick={onCancel}>
        {t('dialog.cancel')}
      </button>
    </div>
  )
}

/** A path typed or chosen, with "this folder" for the folder shown in the file list. */
export function PathField({ value, onChange, kind, folder }: { value: string; onChange(v: string): void; kind: 'file' | 'folder'; folder: string }): React.JSX.Element {
  return (
    <div className="tool-row">
      <input className="tool-input grow" value={value} spellCheck={false} placeholder={t(kind === 'folder' ? 'tools.folderPlaceholder' : 'tools.filePlaceholder')} onChange={(e) => onChange(e.target.value)} />
      {kind === 'folder' && (
        <button className="todo-btn" title={folder} onClick={() => onChange(folder)}>
          {t('tools.thisFolder')}
        </button>
      )}
      <button className="todo-btn" onClick={() => void api.tools.pick(kind).then((p) => p[0] && onChange(p[0]))}>
        {t('tools.choose')}
      </button>
    </div>
  )
}

export function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <button
      className="todo-btn"
      disabled={!text}
      onClick={() => {
        void api.copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? '✓' : t('tools.copy')}
    </button>
  )
}

/** A labelled read-only value with a copy button. */
export function Output({ label, value, mono = true }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return (
    <div className="tool-output">
      <span className="tool-label">{label}</span>
      <span className={`tool-value${mono ? ' mono' : ''}`}>{value}</span>
      <CopyButton text={value} />
    </div>
  )
}

export const ToolError = ({ text }: { text: string | null }): React.JSX.Element | null => (text ? <p className="tool-error">{text}</p> : null)
