import { useState } from 'react'
import { t, type MessageKey } from '@shared/i18n'
import { generatePassword, passwordBits, type PasswordOptions } from '@shared/tools/password'
import { CopyButton, Output, useStored } from './common'

const SETS = ['lower', 'upper', 'digits', 'symbols'] as const

/** Random UUIDs and passwords, both from the system's secure generator. */
export default function Generators(): React.JSX.Element {
  const [count, setCount] = useStored('uuid.count', 1)
  const [upper, setUpper] = useStored('uuid.upper', false)
  const [dashes, setDashes] = useStored('uuid.dashes', true)
  const [uuids, setUuids] = useState<string[]>(() => [crypto.randomUUID()])
  const [opts, setOpts] = useStored<PasswordOptions>('password.options', { length: 20, lower: true, upper: true, digits: true, symbols: true, unambiguous: false })
  const [password, setPassword] = useState(() => generatePassword(opts))

  const format = (u: string): string => {
    const s = dashes ? u : u.replace(/-/g, '')
    return upper ? s.toUpperCase() : s
  }
  const setOption = (patch: Partial<PasswordOptions>): void => {
    const next = { ...opts, ...patch }
    setOpts(next)
    setPassword(generatePassword(next))
  }
  const bits = passwordBits(opts)
  const strength = bits < 50 ? 'weak' : bits < 80 ? 'fair' : bits < 110 ? 'strong' : 'veryStrong'

  return (
    <div className="tool">
      <h4 className="tool-subtitle">UUID</h4>
      <div className="tool-row">
        <input className="tool-input small" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
        <label className="tool-check">
          <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} />
          {t('tools.uppercase')}
        </label>
        <label className="tool-check">
          <input type="checkbox" checked={dashes} onChange={(e) => setDashes(e.target.checked)} />
          {t('tools.dashes')}
        </label>
        <button className="todo-btn" onClick={() => setUuids(Array.from({ length: count }, () => crypto.randomUUID()))}>
          {t('tools.doGenerate')}
        </button>
        <CopyButton text={uuids.map(format).join('\n')} />
      </div>
      <pre className="tool-value mono tool-block">{uuids.map(format).join('\n')}</pre>

      <h4 className="tool-subtitle">{t('tools.password')}</h4>
      <div className="tool-row">
        <input type="range" min={8} max={64} value={opts.length} onChange={(e) => setOption({ length: Number(e.target.value) })} aria-label={t('tools.length')} />
        <span>{t('tools.characters', { count: opts.length })}</span>
      </div>
      <div className="tool-row">
        {SETS.map((s) => (
          <label key={s} className="tool-check">
            <input type="checkbox" checked={opts[s]} onChange={(e) => setOption({ [s]: e.target.checked })} />
            {t(`tools.set.${s}` as MessageKey)}
          </label>
        ))}
        <label className="tool-check" title={t('tools.unambiguousHint')}>
          <input type="checkbox" checked={opts.unambiguous} onChange={(e) => setOption({ unambiguous: e.target.checked })} />
          {t('tools.unambiguous')}
        </label>
      </div>
      <Output label="" value={password} />
      <div className="tool-row">
        <button className="todo-btn" onClick={() => setPassword(generatePassword(opts))}>
          {t('tools.doGenerate')}
        </button>
        <span className={`tool-strength ${strength}`}>
          {t(`tools.strength.${strength}` as MessageKey)} · {t('tools.bits', { bits })}
        </span>
      </div>
    </div>
  )
}
