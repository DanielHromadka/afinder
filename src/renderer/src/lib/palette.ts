// Command palette (⌘K): every action of the window and the focused tab, found by fuzzy typing.

import { match } from '@shared/matcher'
import type { IconName } from '@renderer/components/Icon'

export interface PaletteCommand {
  id: string
  label: string
  /** Shown next to the label ("Zobrazení", "Přejít", …) and searched too. */
  group: string
  shortcut?: string
  icon?: IconName
  /** Extra words that find the command (synonyms, the path of a favorite …). */
  keywords?: string
  /** A toggle that is on (shown with a check mark). */
  checked?: boolean
  run(): void
}

export interface RankedCommand {
  command: PaletteCommand
  /** Matched characters of the label, for underlining. */
  hits: number[]
  score: number
}

/**
 * Commands matching the query, best first: a contiguous match beats a scattered one, a match at the
 * start of a word beats one inside it, and the label beats the group and keywords. An empty query
 * keeps the given order.
 */
export function rankCommands(commands: readonly PaletteCommand[], query: string): RankedCommand[] {
  const q = query.trim()
  if (!q) return commands.map((command) => ({ command, hits: [], score: 0 }))
  const out: RankedCommand[] = []
  for (const command of commands) {
    const hits = match(command.label, q, true)
    if (hits) {
      out.push({ command, hits, score: labelScore(command.label, hits) })
      continue
    }
    const other = `${command.group} ${command.keywords ?? ''}`
    const otherHits = match(other, q, true)
    if (otherHits) out.push({ command, hits: [], score: labelScore(other, otherHits) - 200 })
  }
  // Stable: equal scores keep the original order.
  return out.map((r, i) => ({ r, i })).sort((a, b) => b.r.score - a.r.score || a.i - b.i).map(({ r }) => r)
}

function labelScore(text: string, hits: number[]): number {
  const chars = Array.from(text.normalize('NFC'))
  const first = hits[0] ?? 0
  const spread = (hits.at(-1) ?? 0) - first + 1 - hits.length
  const wordStart = first === 0 || /[\s\-–:/(·]/.test(chars[first - 1] ?? '')
  return (spread === 0 ? 100 : 0) + (wordStart ? 50 : 0) - first - spread * 3
}
