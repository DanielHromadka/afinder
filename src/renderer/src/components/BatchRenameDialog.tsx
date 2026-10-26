import { useEffect, useMemo, useRef, useState } from 'react'
import { locale, t, type MessageKey } from '@shared/i18n'
import type { FileEntry } from '@shared/types'
import { compileFind, DEFAULT_OPTIONS, newNames, problems, type RenameOptions } from '../lib/batchRename'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

const PROBLEM_TEXT: Record<string, MessageKey> = {
  empty: 'batch.problem.empty',
  invalid: 'batch.problem.invalid',
  duplicate: 'batch.problem.duplicate',
  exists: 'batch.problem.exists'
}

/** The last settings are kept for the session – renaming the next batch the same way is common. */
let remembered: RenameOptions = DEFAULT_OPTIONS

/** Names suggested by AI for the entries (in their order). */
export type AiSuggestions = { state: 'loading' } | { state: 'done'; names: string[] } | { state: 'error'; message: string }

interface Props {
  entries: FileEntry[]
  /** Names in the folder that are not being renamed. */
  otherNames: string[]
  platform: string
  onRename(items: { path: string; name: string }[]): void
  onCancel(): void
  /** Present when AI suggestions were asked for (opens in the AI mode). */
  ai?: AiSuggestions
  /** Asks for new suggestions, with the user's extra instructions. */
  onAiRequest?(hint: string): void
}

export function BatchRenameDialog({ entries, otherNames, platform, onRename, onCancel, ai, onAiRequest }: Props): React.JSX.Element {
  // The AI mode only exists while there are suggestions; otherwise fall back to the last other mode.
  const [o, setO] = useState<RenameOptions>(() =>
    ai ? { ...remembered, mode: 'ai' } : remembered.mode === 'ai' ? { ...remembered, mode: 'replace' } : remembered
  )
  const [hint, setHint] = useState('')
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [o.mode])
  const set = (patch: Partial<RenameOptions>): void => setO((prev) => (remembered = { ...prev, ...patch }))

  let regexError = false
  if (o.mode === 'replace') {
    try {
      compileFind(o)
    } catch {
      regexError = true
    }
  }
  const suggested = ai?.state === 'done' ? ai.names : undefined
  const names = useMemo(() => newNames(entries, o, locale(), suggested), [entries, o, suggested])
  const aiWaiting = o.mode === 'ai' && ai?.state !== 'done'
  const issues = useMemo(() => problems(entries.map((e) => e.name), names, otherNames, platform), [entries, names, otherNames, platform])
  const changed = names.filter((n, i) => n !== entries[i].name).length
  const blocked = regexError || aiWaiting || issues.some((p) => p !== null)
  const submit = (): void => {
    if (blocked || changed === 0) return
    onRename(entries.flatMap((e, i) => (names[i] === e.name ? [] : [{ path: e.path, name: names[i] }])))
  }

  return (
    <Dialog title={t('batch.title', { n: entries.length })} className="batch-rename" onClose={onCancel} resizable onSubmit={() => submit()}>

        <div className="batch-form">
          <label>
            <span>{t('batch.mode')}</span>
            <select value={o.mode} onChange={(e) => set({ mode: e.target.value as RenameOptions['mode'] })}>
              <option value="replace">{t('batch.mode.replace')}</option>
              <option value="add">{t('batch.mode.add')}</option>
              <option value="format">{t('batch.mode.format')}</option>
              {ai && <option value="ai">{t('batch.mode.ai')}</option>}
            </select>
          </label>

          {o.mode === 'ai' && (
            <label>
              <span>{t('batch.aiHint')}</span>
              <span className="remote-pick">
                <input
                  ref={first}
                  value={hint}
                  spellCheck={false}
                  placeholder={t('batch.aiHintPlaceholder')}
                  onChange={(e) => setHint(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (ai?.state !== 'loading') onAiRequest?.(hint)
                    }
                  }}
                />
                <button type="button" className="xp-button" disabled={ai?.state === 'loading'} onClick={() => onAiRequest?.(hint)}>
                  {t('batch.aiAgain')}
                </button>
              </span>
            </label>
          )}

          {o.mode === 'replace' && (
            <>
              <label>
                <span>{t('batch.find')}</span>
                <input ref={first} value={o.find} spellCheck={false} onChange={(e) => set({ find: e.target.value })} />
              </label>
              <label>
                <span>{t('batch.replaceWith')}</span>
                <input value={o.replace} spellCheck={false} onChange={(e) => set({ replace: e.target.value })} />
              </label>
              <div className="batch-checks">
                <label>
                  <input type="checkbox" checked={o.matchCase} onChange={(e) => set({ matchCase: e.target.checked })} />
                  {t('batch.matchCase')}
                </label>
                <label>
                  <input type="checkbox" checked={o.regex} onChange={(e) => set({ regex: e.target.checked })} />
                  {t('batch.regex')}
                </label>
              </div>
            </>
          )}

          {o.mode === 'add' && (
            <>
              <label>
                <span>{t('batch.text')}</span>
                <input ref={first} value={o.text} spellCheck={false} onChange={(e) => set({ text: e.target.value })} />
              </label>
              <PositionField value={o.position} onChange={(position) => set({ position })} />
            </>
          )}

          {o.mode === 'format' && (
            <>
              <label>
                <span>{t('batch.base')}</span>
                <input ref={first} value={o.base} spellCheck={false} onChange={(e) => set({ base: e.target.value })} />
              </label>
              <PositionField value={o.position} onChange={(position) => set({ position })} number />
              <div className="batch-row">
                <label>
                  <span>{t('batch.start')}</span>
                  <input type="number" min={0} value={o.start} onChange={(e) => set({ start: Number(e.target.value) })} />
                </label>
                <label>
                  <span>{t('batch.digits')}</span>
                  <input type="number" min={1} max={9} value={o.digits} onChange={(e) => set({ digits: Number(e.target.value) })} />
                </label>
              </div>
            </>
          )}

          <label>
            <span>{t('batch.case')}</span>
            <select value={o.caseChange} onChange={(e) => set({ caseChange: e.target.value as RenameOptions['caseChange'] })}>
              <option value="none">{t('batch.case.none')}</option>
              <option value="lower">{t('batch.case.lower')}</option>
              <option value="upper">{t('batch.case.upper')}</option>
              <option value="title">{t('batch.case.title')}</option>
            </select>
          </label>
          <div className="batch-checks">
            <label>
              <input type="checkbox" checked={o.keepExtension} onChange={(e) => set({ keepExtension: e.target.checked })} />
              {t('batch.keepExtension')}
            </label>
          </div>
        </div>

        <div className="batch-preview">
          <table>
            <thead>
              <tr>
                <th>{t('batch.original')}</th>
                <th>{t('batch.new')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 500).map((e, i) => (
                <tr key={e.path} className={issues[i] ? 'problem' : names[i] !== e.name ? 'changed' : undefined}>
                  <td>
                    <Icon name={e.kind} size={16} />
                    {e.name}
                  </td>
                  <td title={issues[i] ? t(PROBLEM_TEXT[issues[i]!]) : undefined}>
                    {names[i]}
                    {issues[i] && <span className="batch-problem"> – {t(PROBLEM_TEXT[issues[i]!])}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dialog-buttons right">
          <span
            className={`batch-summary${regexError || (o.mode === 'ai' && ai?.state === 'error') ? ' error' : ''}`}
            title={o.mode === 'ai' && ai?.state === 'error' ? ai.message : undefined}
          >
            {regexError
              ? t('batch.problem.regex')
              : o.mode === 'ai' && ai?.state === 'loading'
                ? t('batch.aiThinking')
                : o.mode === 'ai' && ai?.state === 'error'
                  ? ai.message
                  : t('batch.summary', { changed, total: entries.length })}
          </span>
          <button type="submit" className="xp-button" disabled={blocked || changed === 0}>
            {t('batch.rename')}
          </button>
          <button type="button" className="xp-button" onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
        </div>
    </Dialog>
  )
}

function PositionField(props: { value: 'before' | 'after'; number?: boolean; onChange(v: 'before' | 'after'): void }): React.JSX.Element {
  return (
    <label>
      <span>{t(props.number ? 'batch.numberPosition' : 'batch.position')}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as 'before' | 'after')}>
        <option value="after">{t('batch.after')}</option>
        <option value="before">{t('batch.before')}</option>
      </select>
    </label>
  )
}
