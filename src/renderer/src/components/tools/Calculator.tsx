import { useRef, useState } from 'react'
import { locale, t } from '@shared/i18n'
import { evaluate, formatNumber, type AngleUnit } from '@shared/tools/calc'
import { useStored } from './common'

const BASIC = ['C', '⌫', '(', ')', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', ',', '%', '+']
const SCIENTIFIC = ['sin', 'cos', 'tan', '^', 'asin', 'acos', 'atan', '√', 'ln', 'log', 'π', 'e', '!', 'abs', 'ans', 'exp']
const FUNCTION_KEYS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'abs', 'exp', '√'])

interface Line {
  expr: string
  result: number
}

/** Calculator with a typed expression, a keypad (basic or scientific) and the history of results. */
export default function Calculator(): React.JSX.Element {
  const [expr, setExpr] = useState('')
  const [error, setError] = useState(false)
  const [scientific, setScientific] = useStored('calc.scientific', false)
  const [angle, setAngle] = useStored<AngleUnit>('calc.angle', 'deg')
  const [history, setHistory] = useStored<Line[]>('calc.history', [])
  const input = useRef<HTMLInputElement>(null)
  const ans = history[0]?.result ?? 0

  let preview = ''
  if (expr.trim()) {
    try {
      preview = formatNumber(evaluate(expr, { angle, ans }), locale())
    } catch {
      // incomplete while typing
    }
  }

  const equals = (): void => {
    if (!expr.trim()) return
    try {
      const result = evaluate(expr, { angle, ans })
      setHistory([{ expr, result }, ...history].slice(0, 50))
      setExpr(formatNumber(result, 'en').replace(/,/g, ''))
      setError(false)
    } catch {
      setError(true)
    }
  }
  const press = (key: string): void => {
    setError(false)
    if (key === 'C') setExpr('')
    else if (key === '⌫') setExpr(expr.slice(0, -1))
    else if (key === '=') equals()
    else setExpr(expr + (FUNCTION_KEYS.has(key) ? `${key}(` : key))
    input.current?.focus()
  }

  return (
    <div className="tool calc">
      <div className="tool-row">
        <div className="todo-seg">
          <button className={scientific ? '' : 'on'} onClick={() => setScientific(false)}>
            {t('tools.calcBasic')}
          </button>
          <button className={scientific ? 'on' : ''} onClick={() => setScientific(true)}>
            {t('tools.calcScientific')}
          </button>
        </div>
        {scientific && (
          <div className="todo-seg">
            {(['deg', 'rad'] as const).map((a) => (
              <button key={a} className={angle === a ? 'on' : ''} onClick={() => setAngle(a)}>
                {a.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`calc-display${error ? ' error' : ''}`}>
        <input
          ref={input}
          autoFocus
          value={expr}
          spellCheck={false}
          aria-label={t('tools.calc')}
          placeholder="0"
          onChange={(e) => {
            setExpr(e.target.value)
            setError(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === '=') {
              e.preventDefault()
              equals()
            } else if (e.key === 'Escape') setExpr('')
          }}
        />
        <div className="calc-preview">{error ? t('tools.calcError') : preview && preview !== expr ? `= ${preview}` : ' '}</div>
      </div>
      <div className={`calc-keys${scientific ? ' sci' : ''}`}>
        {scientific && SCIENTIFIC.map((k) => <button key={k} className="calc-key fn" onClick={() => press(k)}>{k}</button>)}
        {BASIC.map((k) => (
          <button key={k} className={`calc-key${/[0-9,]/.test(k) ? ' digit' : ''}`} onClick={() => press(k === ',' ? '.' : k)}>
            {k === ',' ? (formatNumber(1.5, locale()).includes(',') ? ',' : '.') : k}
          </button>
        ))}
        <button className="calc-key equals" onClick={equals}>
          =
        </button>
      </div>
      {history.length > 0 && (
        <div className="calc-history">
          <div className="tool-row">
            <span className="tool-label">{t('tools.history')}</span>
            <button className="todo-btn" onClick={() => setHistory([])}>
              {t('tools.clear')}
            </button>
          </div>
          {history.map((h, i) => (
            <button key={i} className="calc-line" title={t('tools.calcReuse')} onClick={() => setExpr(h.expr)}>
              <span className="tool-muted">{h.expr} =</span> <b>{formatNumber(h.result, locale())}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
