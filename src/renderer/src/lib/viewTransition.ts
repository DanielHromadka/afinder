import { flushSync } from 'react-dom'

// Animated layout changes (switching workspaces, Development mode) through the View Transitions API: the
// browser snapshots the window, the update renders synchronously, and every named area (`view-transition-name`
// on `.area`) glides from its old box to its new one while the rest cross-fades. The styles are in workspace.css.

/** Runs a React state update as one animated transition; plain update without the API or with reduced motion. */
export function animateLayout(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  doc.startViewTransition(() => flushSync(update))
}
