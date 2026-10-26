import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { rankCommands, type PaletteCommand } from '@renderer/lib/palette'
import { Highlight } from './Highlight'
import { Icon } from './Icon'

interface Props {
  commands: PaletteCommand[]
  onClose(): void
}

const MAX_SHOWN = 200

/** ⌘K: type to filter every command, ↑↓ to pick, Enter to run, Esc to close. */
export function CommandPalette({ commands, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const ranked = useMemo(() => rankCommands(commands, query).slice(0, MAX_SHOWN), [commands, query])
  const active = Math.min(index, ranked.length - 1)

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: PaletteCommand): void => {
    onClose()
    // After the palette is gone, so the command's own dialogs and focus are not disturbed.
    setTimeout(() => command.run(), 0)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const move = (delta: number): void => {
      e.preventDefault()
      if (ranked.length) setIndex((active + delta + ranked.length) % ranked.length)
    }
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'PageDown') move(8)
    else if (e.key === 'PageUp') move(-8)
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (ranked[active]) run(ranked[active].command)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={t('palette.title')} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={query}
            spellCheck={false}
            placeholder={t('palette.placeholder')}
            aria-controls="palette-list"
            aria-activedescendant={ranked[active] ? `palette-${active}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {ranked.length === 0 && <div className="palette-empty">{t('palette.empty')}</div>}
          {ranked.map(({ command, hits }, i) => (
            <div
              key={command.id}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === active}
              className={`palette-item${i === active ? ' active' : ''}`}
              onMouseMove={() => i !== active && setIndex(i)}
              onClick={() => run(command)}
            >
              <span className="palette-icon">{command.icon ? <Icon name={command.icon} size={16} /> : command.checked ? '✓' : ''}</span>
              <span className="palette-label">
                <Highlight text={command.label} hits={hits} />
                {command.checked && command.icon && <span className="palette-check"> ✓</span>}
              </span>
              <span className="palette-group">{command.group}</span>
              {command.shortcut && <kbd className="palette-shortcut">{command.shortcut}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
