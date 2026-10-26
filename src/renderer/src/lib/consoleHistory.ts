// Where each prompt of a console session sits in its terminal, so the history panel can scroll there.
// Every Enter leaves a marker that xterm keeps on its line as output scrolls. A shell's history is made
// of these marks; an agent's comes from its transcript and is matched to the nearest mark in time.

import type { IMarker, Terminal } from '@xterm/xterm'
import { MAX_AGENT_TURNS, type AgentTurn } from '@shared/types'

interface Mark {
  /** The line where typing started; the column after the shell's prompt. */
  marker: IMarker
  x: number
  /** When Enter was pressed. */
  time: number
  /** The command as last read – kept for when its line leaves the scrollback. */
  text: string
  /** Last output after this mark – the end of a shell command. */
  lastOutput: number
  /** The next line is being typed: its echo is no longer this command's output. */
  closed: boolean
}

const terms = new Map<string, Terminal>()
const marks = new Map<string, Mark[]>()

/** The typed line from where typing started, through the lines it wrapped onto. */
function readLine(term: Terminal, m: Mark): string {
  const b = term.buffer.active
  if (m.marker.isDisposed || m.marker.line < 0) return ''
  // Shells wrap long input themselves, so a full row continues on the next one even without xterm's flag.
  const row = (y: number): string => b.getLine(y)?.translateToString() ?? ''
  let y = m.marker.line
  let text = row(y).slice(m.x)
  while (y + 1 < b.length && (b.getLine(y + 1)?.isWrapped || row(y).trimEnd().length >= term.cols)) text += row(++y)
  return text.replace(/\s+/g, ' ').trim()
}

export function register(id: string, term: Terminal): () => void {
  terms.set(id, term)
  // Set by the first key of a line: the prompt's own text (any theme of it) then lies left of the cursor.
  let typing: { marker: IMarker; x: number } | null = null
  const input = term.onData((data) => {
    const b = term.buffer.active
    if (data.includes('\x03')) {
      typing?.marker.dispose()
      typing = null
      return
    }
    if (!typing) {
      const last = marks.get(id)?.at(-1)
      if (last) last.closed = true
      const marker = term.registerMarker(0)
      if (!marker) return
      typing = { marker, x: b.cursorX }
    }
    if (!data.includes('\r')) return
    const list = marks.get(id) ?? []
    list.push({ ...typing, time: Date.now(), text: '', lastOutput: 0, closed: false })
    typing = null
    if (list.length > MAX_AGENT_TURNS * 2) list.splice(0, list.length - MAX_AGENT_TURNS * 2).forEach((m) => m.marker.dispose())
    marks.set(id, list)
  })
  return () => {
    input.dispose()
    if (terms.get(id) === term) terms.delete(id)
    marks.delete(id)
  }
}

export function noteOutput(id: string, at: number): void {
  const last = marks.get(id)?.at(-1)
  if (last && !last.closed) last.lastOutput = at
}

/** A shell's history: the commands typed, each lasting until its output stopped. */
export function shellTurns(id: string): AgentTurn[] {
  const term = terms.get(id)
  return (marks.get(id) ?? []).flatMap((m) => {
    // Read anew each time: the shell echoes what was typed (or pasted) a moment after Enter.
    const prompt = (term && readLine(term, m)) || m.text
    m.text = prompt
    return prompt ? [{ prompt, start: m.time, durationMs: m.lastOutput > m.time ? m.lastOutput - m.time : 0 }] : []
  })
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Buffer line where the prompt was typed: its own mark, else the text echoed nearby, else anywhere. */
function locate(id: string, term: Terminal, turn: AgentTurn): number | null {
  const near = (marks.get(id) ?? [])
    .filter((m) => !m.marker.isDisposed && m.marker.line >= 0 && Math.abs(m.time - turn.start) < 10_000)
    .sort((a, b) => Math.abs(a.time - turn.start) - Math.abs(b.time - turn.start))[0]
  const b = term.buffer.active
  const needle = norm(turn.prompt).slice(0, 24)
  const found: number[] = []
  if (needle) {
    for (let y = 0; y < b.length; y++) if (norm(b.getLine(y)?.translateToString(true) ?? '').includes(needle)) found.push(y)
  }
  if (near) {
    // An agent echoes the prompt just above its input box, where the mark sits.
    const echo = found.filter((y) => y <= near.marker.line && near.marker.line - y < 80).at(-1)
    return echo ?? near.marker.line
  }
  return found.at(-1) ?? null
}

/** Scrolls the session's terminal to the prompt and selects its line; false when it is no longer there. */
export function reveal(id: string, turn: AgentTurn): boolean {
  const term = terms.get(id)
  if (!term) return false
  const line = locate(id, term, turn)
  if (line === null) return false
  term.scrollToLine(Math.max(0, line - 2))
  term.selectLines(line, line)
  return true
}
