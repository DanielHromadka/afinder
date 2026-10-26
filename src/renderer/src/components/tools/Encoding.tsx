import { useState } from 'react'
import { t } from '@shared/i18n'
import { decodeText, encodeText, ENCODINGS, type Encoding as Kind } from '@shared/tools/encode'
import { CopyButton, ToolError, useStored } from './common'

const LABEL: Record<Kind, string> = { base64: 'Base64', base64url: 'Base64URL', url: 'URL', html: 'HTML', hex: 'Hex' }

/** Base64, Base64URL, URL, HTML entities and hex bytes, both ways. */
export default function Encoding(): React.JSX.Element {
  const [kind, setKind] = useStored<Kind>('encode.kind', 'base64')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = (decode: boolean): void => {
    setError(null)
    try {
      setOutput(decode ? decodeText(input, kind) : encodeText(input, kind))
    } catch {
      setOutput('')
      setError(t('tools.decodeFailed', { kind: LABEL[kind] }))
    }
  }

  return (
    <div className="tool">
      <div className="todo-seg">
        {ENCODINGS.map((k) => (
          <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>
            {LABEL[k]}
          </button>
        ))}
      </div>
      <textarea className="tool-input tool-text mono" rows={5} value={input} spellCheck={false} placeholder={t('tools.textPlaceholder')} onChange={(e) => setInput(e.target.value)} />
      <div className="tool-row">
        <button className="todo-btn" disabled={!input} onClick={() => run(false)}>
          {t('tools.doEncode')} ↓
        </button>
        <button className="todo-btn" disabled={!input} onClick={() => run(true)}>
          {t('tools.decode')} ↓
        </button>
        <button className="todo-btn" disabled={!output} onClick={() => (setInput(output), setOutput(''))}>
          ↑ {t('tools.useAsInput')}
        </button>
        <CopyButton text={output} />
      </div>
      <ToolError text={error} />
      <textarea className="tool-input tool-text mono" rows={5} value={output} readOnly />
    </div>
  )
}
