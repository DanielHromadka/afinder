import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

export type MenuItem =
  | { label: string; icon?: IconName; shortcut?: string; disabled?: boolean; bold?: boolean; checked?: boolean; title?: string; onClick(): void }
  /** Opens a submenu on hover. */
  | { label: string; icon?: IconName; disabled?: boolean; items: MenuItem[] }
  | 'separator'

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose(): void }): React.JSX.Element {
  const { onClose } = props
  useEffect(() => {
    // Any open level counts as inside: submenus nest, so one ref per level would not do.
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && (e.target as Element | null)?.closest?.('.context-menu')) return
      onClose()
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return <MenuList x={props.x} y={props.y} items={props.items} onClose={onClose} />
}

/**
 * One menu level, rendering its open submenu the same way, so submenus nest to any depth ("Split and
 * add" → editor → side). The top level is clamped into the window; a submenu opens right of its row,
 * or left of it when there is no room.
 */
function MenuList(props: { x: number; y: number; items: MenuItem[]; onClose(): void; parentLeft?: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: props.x, top: props.y })
  // The open submenu: its item and the row it hangs off.
  const [sub, setSub] = useState<{ index: number; x: number; y: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    const isSub = props.parentLeft !== undefined
    const left = !isSub
      ? Math.min(props.x, window.innerWidth - r.width - 4)
      : props.x + r.width > window.innerWidth - 4
        ? Math.max(4, props.parentLeft! - r.width + 2)
        : props.x
    setPos({ left, top: Math.max(4, Math.min(props.y, window.innerHeight - r.height - 4)) })
  }, [props.x, props.y, props.parentLeft])

  const openSub = (i: number, e: React.MouseEvent<HTMLElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setSub({ index: i, x: r.right - 2, y: r.top - 3, left: r.left })
  }
  const subItem = sub ? props.items[sub.index] : null
  return (
    <>
      <div ref={ref} className={`context-menu${props.parentLeft !== undefined ? ' submenu' : ''}`} style={pos} onContextMenu={(e) => e.preventDefault()}>
        {props.items.map((item, i) =>
          item === 'separator' ? (
            <div key={i} className="menu-sep" />
          ) : 'items' in item ? (
            <button
              key={i}
              className={`menu-item has-submenu${sub?.index === i ? ' open' : ''}`}
              disabled={item.disabled}
              onMouseEnter={(e) => openSub(i, e)}
              onClick={(e) => openSub(i, e)}
            >
              <span className="menu-icon">{item.icon && <Icon name={item.icon} size={16} />}</span>
              <span className="menu-label">{item.label}</span>
              <span className="menu-shortcut">▸</span>
            </button>
          ) : (
            <CommandItem key={i} item={item} onClose={props.onClose} onMouseEnter={() => setSub(null)} />
          )
        )}
      </div>
      {sub && subItem && subItem !== 'separator' && 'items' in subItem && (
        <MenuList key={sub.index} x={sub.x} y={sub.y} parentLeft={sub.left} items={subItem.items} onClose={props.onClose} />
      )}
    </>
  )
}

function CommandItem(props: { item: Extract<MenuItem, { onClick(): void }>; onClose(): void; onMouseEnter?(): void }): React.JSX.Element {
  const { item } = props
  return (
    <button
      className={`menu-item${item.bold ? ' bold' : ''}`}
      disabled={item.disabled}
      title={item.title}
      onMouseEnter={props.onMouseEnter}
      onClick={() => {
        props.onClose()
        item.onClick()
      }}
    >
      <span className="menu-icon">{item.checked ? '✓' : item.icon && <Icon name={item.icon} size={16} />}</span>
      <span className="menu-label">{item.label}</span>
      <span className="menu-shortcut">{item.shortcut}</span>
    </button>
  )
}
