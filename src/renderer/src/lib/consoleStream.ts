// Routes console output to the xterm views. A session starts producing output (the shell prompt)
// before its view has mounted, so output for sessions without a listener is buffered.

import { noteOutput } from './consoleHistory'

const api = window.api

type Listener = (data: string) => void
const listeners = new Map<string, Listener>()
const pending = new Map<string, string[]>()
/** When each session last printed something – how the console tells a working agent from a waiting one. */
const lastOutput = new Map<string, number>()

export const lastOutputAt = (id: string): number => lastOutput.get(id) ?? 0

api.terminal.onData(({ id, data }) => {
  lastOutput.set(id, Date.now())
  noteOutput(id, Date.now())
  const listener = listeners.get(id)
  if (listener) listener(data)
  else pending.set(id, [...(pending.get(id) ?? []), data])
})

/** Delivers the session's output to `listener`, starting with anything buffered so far. */
export function attach(id: string, listener: Listener): () => void {
  listeners.set(id, listener)
  for (const chunk of pending.get(id) ?? []) listener(chunk)
  pending.delete(id)
  return () => {
    if (listeners.get(id) === listener) listeners.delete(id)
  }
}

/** Sessions handed over from the window this one replaced: their views replay `output` and make them redraw. */
const handedOver = new Set<string>()

export function prime(id: string, output: string): void {
  if (output) pending.set(id, [output, ...(pending.get(id) ?? [])])
  handedOver.add(id)
}

/** True once for a handed-over session: the view should nudge the size so the program repaints its screen. */
export function takeRedraw(id: string): boolean {
  return handedOver.delete(id)
}

export function forget(id: string): void {
  listeners.delete(id)
  pending.delete(id)
  lastOutput.delete(id)
}

/** Quotes paths for the shell running in the console (POSIX shells; PowerShell on Windows). */
export function quotePaths(paths: string[]): string {
  const windows = api.platform === 'win32'
  return paths.map((p) => (windows ? `'${p.replace(/'/g, "''")}'` : `'${p.replace(/'/g, `'\\''`)}'`)).join(' ')
}
