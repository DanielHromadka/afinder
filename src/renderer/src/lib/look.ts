// Monaco and xterm read their colours from the page once (on mount and on a theme change). A look switched
// without a theme change (Development mode's data-dev) announces itself here so they read them again.

const EVENT = 'afinder:look'

export const lookChanged = (): void => void window.dispatchEvent(new Event(EVENT))

/** Subscribes to look changes; returns the unsubscribe, so it fits a useEffect. */
export function onLookChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
