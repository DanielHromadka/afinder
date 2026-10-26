import { dump, load } from 'js-yaml'
import { useState } from 'react'
import { t } from '@shared/i18n'
import { CopyButton, ToolError, useStored } from './common'

type Action = 'format' | 'minify' | 'toYaml' | 'toJson'

/** "Unexpected token } in JSON at position 42" → also the line and column, which people can find. */
function where(text: string, err: Error): string {
  const pos = /position (\d+)/.exec(err.message)?.[1]
  if (!pos) return err.message
  const before = text.slice(0, Number(pos))
  const line = before.split('\n').length
  return `${err.message} (${t('tools.lineColumn', { line, column: Number(pos) - before.lastIndexOf('\n') })})`
}

/** Formats, minifies, validates and converts between JSON and YAML. */
export default function JsonYaml(): React.JSX.Element {
  const [input, setInput] = useStored('json.input', '')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = (action: Action): void => {
    setError(null)
    try {
      if (action === 'toJson') {
        // YAML is a superset of JSON, so this also formats JSON.
        setOutput(JSON.stringify(load(input), null, 2))
        return
      }
      const value = JSON.parse(input) as unknown
      setOutput(action === 'format' ? JSON.stringify(value, null, 2) : action === 'minify' ? JSON.stringify(value) : dump(value, { lineWidth: 120, noRefs: true }))
    } catch (err) {
      setOutput('')
      setError(where(input, err as Error))
    }
  }

  return (
    <div className="tool">
      <textarea className="tool-input tool-text mono" rows={8} value={input} spellCheck={false} placeholder={t('tools.jsonPlaceholder')} onChange={(e) => setInput(e.target.value)} />
      <div className="tool-row">
        <button className="todo-btn" disabled={!input.trim()} onClick={() => run('format')}>
          {t('tools.jsonFormat')}
        </button>
        <button className="todo-btn" disabled={!input.trim()} onClick={() => run('minify')}>
          {t('tools.jsonMinify')}
        </button>
        <button className="todo-btn" disabled={!input.trim()} onClick={() => run('toYaml')}>
          JSON → YAML
        </button>
        <button className="todo-btn" disabled={!input.trim()} onClick={() => run('toJson')}>
          YAML → JSON
        </button>
      </div>
      <ToolError text={error} />
      {output && (
        <>
          <div className="tool-row">
            <span className="tool-ok">✓ {t('tools.valid')}</span>
            <CopyButton text={output} />
            <button className="todo-btn" onClick={() => setInput(output)}>
              {t('tools.useAsInput')}
            </button>
          </div>
          <textarea className="tool-input tool-text mono" rows={10} value={output} readOnly />
        </>
      )}
    </div>
  )
}
