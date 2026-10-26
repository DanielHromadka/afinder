import { useEffect, useLayoutEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import { dragDialog, resizeCursor, resizeDialog } from '@renderer/lib/dragDialog'

// The app's dialogs share one frame and one behaviour: a small title bar to drag them by with a close
// button, Escape to close, the first focus inside and, once closed, the focus back where it was. Two
// kinds exist: <Dialog> over a dimmed backdrop, and native <dialog> elements (useModalDialog) for the
// larger ones that host dialogs of their own in the top layer. The classes are the same as before, so
// every theme draws them as it always has.

/** The title bar: drag to move, ✕ to close. */
export function DialogTitleBar(props: { title: string; titleId?: string; onClose(): void; closeDisabled?: boolean }): React.JSX.Element {
  return (
    <div className="titlebar small" onPointerDown={dragDialog}>
      <span id={props.titleId} className="titlebar-text">
        {props.title}
      </span>
      <div className="titlebar-buttons">
        <button type="button" className="tb-btn tb-close" aria-label={t('window.close')} disabled={props.closeDisabled} onClick={props.onClose}>
          <span className="glyph-close">✕</span>
        </button>
      </div>
    </div>
  )
}

/** Gives the focus back to what had it before the dialog opened (if it is still there) when the dialog goes. */
export function useFocusReturn(): void {
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => {
      if (previous && previous !== document.body && previous.isConnected) previous.focus()
    }
  }, [])
}

interface DialogProps {
  title: string
  onClose(): void
  children: React.ReactNode
  /** Extra classes on the window (its size and layout). */
  className?: string
  role?: 'dialog' | 'alertdialog'
  /** Escape, when it should do something else first (e.g. leave a detail view). Defaults to onClose. */
  onEscape?(): void
  /** A click on the dimmed backdrop closes too. */
  closeOnBackdrop?: boolean
  /** The window can be resized by its edges. */
  resizable?: boolean
  /** Receives the first focus; without one the window itself takes it, so Escape always works. */
  initialFocus?: React.RefObject<HTMLElement | null>
  style?: React.CSSProperties
  /** The window is a form: Enter in a field submits it. */
  onSubmit?(): void
}

/** A dialog over a dimmed backdrop. */
export function Dialog(props: DialogProps): React.JSX.Element {
  const windowRef = useRef<HTMLElement>(null)
  const Window = props.onSubmit ? 'form' : 'div'
  useFocusReturn()
  useEffect(() => {
    const target = props.initialFocus?.current
    if (target) target.focus()
    else if (!windowRef.current?.contains(document.activeElement)) windowRef.current?.focus()
  }, [])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={props.closeOnBackdrop ? (e) => e.target === e.currentTarget && props.onClose() : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        ;(props.onEscape ?? props.onClose)()
      }}
    >
      <Window
        ref={windowRef as React.RefObject<HTMLDivElement & HTMLFormElement>}
        className={`xp-window dialog${props.className ? ` ${props.className}` : ''}`}
        role={props.role ?? 'dialog'}
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        style={props.style}
        onPointerDown={props.resizable ? resizeDialog : undefined}
        onPointerMove={props.resizable ? resizeCursor : undefined}
        onSubmit={
          props.onSubmit &&
          ((e: React.FormEvent) => {
            e.preventDefault()
            props.onSubmit!()
          })
        }
      >
        <DialogTitleBar title={props.title} onClose={props.onClose} />
        {props.children}
      </Window>
    </div>
  )
}

/**
 * A native <dialog>: shown modal while mounted, closed and the focus given back when unmounted. Escape
 * (the dialog's cancel event) calls `onCancel` instead of closing it behind React's back.
 */
export function useModalDialog(onCancel: () => void): { ref: React.RefObject<HTMLDialogElement | null>; onCancel(e: React.SyntheticEvent): void } {
  const ref = useRef<HTMLDialogElement>(null)
  useFocusReturn()
  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])
  return {
    ref,
    onCancel: (e) => {
      e.preventDefault()
      onCancel()
    }
  }
}
