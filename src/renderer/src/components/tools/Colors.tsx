import { useState } from 'react'
import { t } from '@shared/i18n'
import { contrastText, parseColor, toHex, toHslText, toRgbText, type Rgb } from '@shared/tools/color'
import { Output, useStored } from './common'

/** Chromium's eyedropper: picks a colour anywhere on the screen. Not in TypeScript's DOM types yet. */
declare global {
  interface Window {
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> }
  }
}

/** A colour from a picker, the screen or any notation, shown as HEX, RGB and HSL; recent ones kept. */
export default function Colors(): React.JSX.Element {
  const [recent, setRecent] = useStored<string[]>('color.recent', [])
  const [text, setText] = useState(recent[0] ?? '#3366cc')
  const color: Rgb | null = parseColor(text)
  const remember = (hex: string): void => setRecent([hex, ...recent.filter((c) => c !== hex)].slice(0, 16))
  const set = (value: string): void => {
    setText(value)
    const c = parseColor(value)
    if (c) remember(toHex(c))
  }
  const pickFromScreen = async (): Promise<void> => {
    try {
      set((await new window.EyeDropper!().open()).sRGBHex)
    } catch {
      // Escape pressed
    }
  }

  return (
    <div className="tool">
      <div className="tool-row">
        <input type="color" value={color ? toHex(color) : '#000000'} onChange={(e) => set(e.target.value)} aria-label={t('tools.color')} />
        <input className="tool-input grow mono" value={text} spellCheck={false} placeholder="#3366cc · rgb(51, 102, 204) · hsl(220, 60%, 50%)" onChange={(e) => setText(e.target.value)} onBlur={() => color && remember(toHex(color))} />
        {window.EyeDropper && (
          <button className="todo-btn" onClick={() => void pickFromScreen()}>
            {t('tools.eyedropper')}
          </button>
        )}
      </div>
      {color ? (
        <>
          <div className="color-swatch" style={{ background: toHex(color), color: contrastText(color) }}>
            {toHex(color)}
          </div>
          <Output label="HEX" value={toHex(color)} />
          <Output label="RGB" value={toRgbText(color)} />
          <Output label="HSL" value={toHslText(color)} />
        </>
      ) : (
        <p className="tool-error">{t('tools.colorUnreadable')}</p>
      )}
      {recent.length > 0 && (
        <div className="tool-row color-recent">
          {recent.map((c) => (
            <button key={c} title={c} style={{ background: c }} onClick={() => setText(c)} />
          ))}
        </div>
      )}
    </div>
  )
}
