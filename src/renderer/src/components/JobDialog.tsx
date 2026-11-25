import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { baseName } from '@shared/paths'
import type { FileEntry } from '@shared/types'
import { Dialog } from './Dialog'

type ItemState = { kind: 'waiting' } | { kind: 'busy'; percent: number | null } | { kind: 'done'; name: string | null } | { kind: 'error'; message: string } | { kind: 'skipped' }

/** What one file turns into: the path of the file written (selected afterwards), or null when nothing changed. */
export type JobRun = (entry: FileEntry, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<string | null>

export interface Job {
  title: string
  entries: FileEntry[]
  run: JobRun
  /** Shown under the list, e.g. that originals stay. */
  note?: string
  /** Shown for files that were left as they were. */
  unchanged?: string
  /** Closes by itself when every file went through (quick in-place edits such as turning photos). */
  autoClose?: boolean
  /** Prepares once before the first file (loads a library); its result is passed to nothing, it just has to finish. */
  prepare?: () => Promise<unknown>
}

interface Props extends Job {
  /** Selects the written files in the list once everything is done; also called when files changed in place. */
  onDone(paths: string[]): void
  onClose(): void
}

/**
 * Runs one job over the chosen files, one after another, with a line per file. Starts on open (the menu
 * item was the confirmation); Stop cancels the current file and skips the rest.
 */
export function JobDialog({ title, entries, run, note, unchanged, autoClose, prepare, onDone, onClose }: Props): React.JSX.Element {
  const [states, setStates] = useState<ItemState[]>(() => entries.map(() => ({ kind: 'waiting' })))
  const [running, setRunning] = useState(true)
  const ctrl = useRef<AbortController | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const set = (i: number, state: ItemState): void => setStates((s) => s.map((x, j) => (j === i ? state : x)))

  // Runs once: the files and the job are fixed while the dialog is open.
  useEffect(() => {
    const abort = new AbortController()
    ctrl.current = abort
    void (async () => {
      const made: string[] = []
      let failed = false
      try {
        await prepare?.()
      } catch (err) {
        setStates(entries.map(() => ({ kind: 'error', message: (err as Error).message })))
        setRunning(false)
        return
      }
      for (let i = 0; i < entries.length; i++) {
        // Stop has marked the rest as skipped; an aborted run must not touch the states any more.
        if (abort.signal.aborted) return
        set(i, { kind: 'busy', percent: null })
        try {
          let shown = -1
          const path = await run(
            entries[i],
            (fraction) => {
              const percent = Math.floor(fraction * 100)
              if (percent === shown) return
              shown = percent
              set(i, { kind: 'busy', percent })
            },
            abort.signal
          )
          if (path) made.push(path)
          set(i, { kind: 'done', name: path ? baseName(path) : null })
        } catch (err) {
          if (abort.signal.aborted) return
          failed = true
          set(i, { kind: 'error', message: (err as Error).message })
        }
      }
      setRunning(false)
      ctrl.current = null
      onDone(made)
      if (autoClose && !failed) onClose()
      else closeRef.current?.focus()
    })()
    // Closing the window (or the dialog) mid-way stops the current file and removes what it half wrote.
    return () => abort.abort()
  }, [])

  const stop = (): void => {
    ctrl.current?.abort()
    ctrl.current = null
    setRunning(false)
    setStates((s) => s.map((x) => (x.kind === 'waiting' || x.kind === 'busy' ? { kind: 'skipped' } : x)))
  }
  const close = (): void => {
    stop()
    onClose()
  }

  return (
    <Dialog title={title} className="convert-dialog" onClose={close}>
      <ul className="convert-list">
        {entries.map((e, i) => {
          const s = states[i]
          return (
            <li key={e.path} title={e.path}>
              <span className="convert-name">{e.name}</span>
              <span className={`convert-state${s.kind === 'error' ? ' error' : ''}`}>
                {s.kind === 'busy' ? (
                  s.percent !== null ? (
                    <>
                      <progress max={100} value={s.percent} /> {s.percent} %
                    </>
                  ) : (
                    t('convert.working')
                  )
                ) : s.kind === 'done' ? (
                  s.name === null ? (unchanged ?? t('job.unchanged')) : s.name === e.name ? t('job.done') : `→ ${s.name}`
                ) : s.kind === 'error' ? (
                  s.message
                ) : s.kind === 'skipped' ? (
                  t('convert.skipped')
                ) : (
                  t('convert.waiting')
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {note && <p className="convert-note">{note}</p>}
      <div className="dialog-buttons right">
        {running ? (
          <button type="button" className="xp-button" onClick={stop}>
            {t('convert.stop')}
          </button>
        ) : (
          <button ref={closeRef} type="button" className="xp-button" onClick={onClose}>
            {t('window.close')}
          </button>
        )}
      </div>
    </Dialog>
  )
}
