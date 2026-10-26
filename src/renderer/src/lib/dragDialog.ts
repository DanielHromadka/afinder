import type { PointerEvent as ReactPointerEvent } from 'react'

/** Move an in-app dialog by its title bar, keeping it inside the viewport. */
export function dragDialog(event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, a')) return
  const bar = event.currentTarget
  const dialog = bar.closest<HTMLElement>('.xp-window')
  if (!dialog) return
  event.preventDefault()
  const rect = dialog.getBoundingClientRect()
  const startX = event.clientX
  const startY = event.clientY
  const [offsetX = 0, offsetY = 0] = (dialog.style.translate || '0 0').split(' ').map(parseFloat)
  bar.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    const left = Math.max(0, Math.min(Math.max(0, window.innerWidth - rect.width), rect.left + e.clientX - startX))
    const top = Math.max(0, Math.min(Math.max(0, window.innerHeight - rect.height), rect.top + e.clientY - startY))
    dialog.style.translate = `${offsetX + left - rect.left}px ${offsetY + top - rect.top}px`
  }
  const stop = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    bar.removeEventListener('pointermove', move)
    bar.removeEventListener('pointerup', stop)
    bar.removeEventListener('pointercancel', stop)
    bar.removeEventListener('lostpointercapture', stop)
    if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId)
  }
  bar.addEventListener('pointermove', move)
  bar.addEventListener('pointerup', stop)
  bar.addEventListener('pointercancel', stop)
  bar.addEventListener('lostpointercapture', stop)
}

/** Width of the grab zone along a dialog's left, right and bottom edges (its top is the title bar). */
const EDGE = 6
const CORNER = 14

function resizeEdges(dialog: HTMLElement, x: number, y: number): string {
  const r = dialog.getBoundingClientRect()
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return ''
  const bottom = r.bottom - y <= EDGE || (r.bottom - y <= CORNER && (x - r.left <= CORNER || r.right - x <= CORNER))
  const near = bottom ? CORNER : EDGE
  return (bottom ? 's' : '') + (x - r.left <= near ? 'w' : r.right - x <= near ? 'e' : '')
}

/** Show a resize cursor near a dialog's edges; spread with `resizeDialog` onto the dialog element. */
export function resizeCursor(event: ReactPointerEvent<HTMLElement>): void {
  const dialog = event.currentTarget
  if (dialog.hasPointerCapture(event.pointerId)) return
  const edges = resizeEdges(dialog, event.clientX, event.clientY)
  if (edges) dialog.dataset.resize = edges
  else delete dialog.dataset.resize
}

/** Resize a dialog by its left, right or bottom edge. Dialogs are centred, so the translate shifts by half
 *  the size change to keep the opposite edge where it was. */
export function resizeDialog(event: ReactPointerEvent<HTMLElement>): void {
  const dialog = event.currentTarget
  const edges = event.button === 0 && !event.defaultPrevented ? resizeEdges(dialog, event.clientX, event.clientY) : ''
  if (!edges) return
  event.preventDefault()
  event.stopPropagation()
  const rect = dialog.getBoundingClientRect()
  const startX = event.clientX
  const startY = event.clientY
  const [offsetX = 0, offsetY = 0] = (dialog.style.translate || '0 0').split(' ').map(parseFloat)
  const minW = Math.min(rect.width, 300)
  const minH = Math.min(rect.height, 180)
  dialog.style.maxWidth = 'none'
  dialog.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    let dx = edges.includes('e') ? e.clientX - startX : edges.includes('w') ? startX - e.clientX : 0
    let dy = edges.includes('s') ? e.clientY - startY : 0
    dx = Math.max(minW, Math.min(window.innerWidth - 16, rect.width + dx)) - rect.width
    dy = Math.max(minH, Math.min(window.innerHeight - 24, rect.height + dy)) - rect.height
    if (edges.includes('e') || edges.includes('w')) dialog.style.width = `${rect.width + dx}px`
    if (edges.includes('s')) dialog.style.height = `${rect.height + dy}px`
    dialog.style.translate = `${offsetX + (edges.includes('w') ? -dx : dx) / 2}px ${offsetY + dy / 2}px`
  }
  const stop = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    dialog.removeEventListener('pointermove', move)
    dialog.removeEventListener('pointerup', stop)
    dialog.removeEventListener('pointercancel', stop)
    dialog.removeEventListener('lostpointercapture', stop)
    if (dialog.hasPointerCapture(event.pointerId)) dialog.releasePointerCapture(event.pointerId)
  }
  dialog.addEventListener('pointermove', move)
  dialog.addEventListener('pointerup', stop)
  dialog.addEventListener('pointercancel', stop)
  dialog.addEventListener('lostpointercapture', stop)
}
