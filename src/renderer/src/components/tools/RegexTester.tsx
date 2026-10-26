import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { CopyButton, ToolError, useStored } from './common'
import type { RegexAnswer, RegexJob } from './regexWorker'

const FLAGS = ['g', 'i', 'm', 's', 'u'] as const
const TIMEOUT_MS = 1000

const newWorker = (): Worker => new Worker(new URL('./regexWorker.ts', import.meta.url), { type: 'module' })

/** Matches, groups and a replacement preview, computed in a worker that is killed when it runs too long. */
export default function RegexTester(): React.JSX.Element {
  const [pattern, setPattern] = useStored('regex.pattern', '(\\w+)@(\\w+)\\.com')
  const [flags, setFlags] = useStored('regex.flags', 'g')
  const [text, setText] = useStored('regex.text', 'jana@example.com, petr@firma.com')
  const [replace, setReplace] = useStored<string>('regex.replace', '')
  const [answer, setAnswer] = useState<RegexAnswer | null>(null)
  const worker = useRef<Worker | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])
  useEffect(() => {
    if (!pattern) return void setAnswer(null)
    const timer = setTimeout(() => {
      worker.current ??= newWorker()
      const w = worker.current
      const killer = setTimeout(() => {
        // Catastrophic backtracking: start over with a fresh worker.
        w.terminate()
        worker.current = null
        setAnswer({ error: t('tools.regexTooSlow') })
      }, TIMEOUT_MS)
      w.onmessage = (e: MessageEvent<RegexAnswer>) => {
        clearTimeout(killer)
        setAnswer(e.data)
      }
      w.postMessage({ pattern, flags, text, replace: replace || null } satisfies RegexJob)
    }, 150)
    return () => clearTimeout(timer)
  }, [pattern, flags, text, replace])

  const ok = answer && 'matches' in answer ? answer : null
  // The text with the matches marked.
  const parts: React.ReactNode[] = []
  if (ok) {
    let at = 0
    ok.matches.forEach((m, i) => {
      if (m.index > at) parts.push(text.slice(at, m.index))
      parts.push(<mark key={i}>{m.text || '∅'}</mark>)
      at = m.index + m.text.length
    })
    parts.push(text.slice(at))
  }

  return (
    <div className="tool">
      <div className="tool-row">
        <span className="mono">/</span>
        <input className="tool-input grow mono" value={pattern} spellCheck={false} onChange={(e) => setPattern(e.target.value)} aria-label={t('tools.regexPattern')} />
        <span className="mono">/</span>
        {FLAGS.map((f) => (
          <label key={f} className="tool-check mono" title={t(`tools.flag.${f}`)}>
            <input type="checkbox" checked={flags.includes(f)} onChange={(e) => setFlags(e.target.checked ? flags + f : flags.replace(f, ''))} />
            {f}
          </label>
        ))}
      </div>
      <textarea className="tool-input tool-text" rows={5} value={text} spellCheck={false} placeholder={t('tools.textPlaceholder')} onChange={(e) => setText(e.target.value)} />
      <ToolError text={answer && 'error' in answer ? answer.error : null} />
      {ok && (
        <>
          <p className="tool-muted">{t('tools.regexMatches', { count: ok.total })}</p>
          <div className="tool-block regex-marked">{parts}</div>
          {ok.matches.some((m) => m.groups.length) && (
            <table className="tool-table">
              <tbody>
                {ok.matches.slice(0, 50).map((m, i) => (
                  <tr key={i}>
                    <td className="tool-muted">{i + 1}</td>
                    <td className="mono">{m.text}</td>
                    {m.groups.map((g, j) => (
                      <td key={j} className="mono" title={`$${j + 1}`}>
                        {g ?? '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <div className="tool-row">
        <input className="tool-input grow mono" value={replace} spellCheck={false} placeholder={t('tools.regexReplace')} onChange={(e) => setReplace(e.target.value)} />
        {ok?.replaced != null && <CopyButton text={ok.replaced} />}
      </div>
      {ok?.replaced != null && <div className="tool-block mono">{ok.replaced}</div>}
    </div>
  )
}
