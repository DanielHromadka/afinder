import type { DecisionInput } from '@shared/fileAssistant'

/** Laya's published choice sequence format and head budgets. See docs/file-assistant.md. */
export function layaSequence(input: DecisionInput, encode: (text: string) => number[], special = { cls: 2, sep: 1, mask: 4 }, maxLength = 1024, headLength = 256): { ids: number[]; markers: number[]; truncated: boolean; collapsed: boolean } {
  if (!input.choices || input.choices.length < 2 || input.choices.length > 12 || new Set(input.choices.map((c) => c.id)).size !== input.choices.length) throw new Error('Choose between 2 and 12 distinct options')
  const escape = (s: string): string => s.replace(/<mask>/g, ' ')
  let options = input.choices.map((c) => [special.mask, ...encode(` ${escape(c.id)}: ${escape(c.description)}`).slice(0, 48)])
  let room = headLength - options.reduce((sum, ids) => sum + ids.length, 0)
  if (room < 16) {
    const perOption = Math.max(4, Math.floor((headLength - 16) / options.length))
    options = options.map((ids) => ids.slice(0, perOption))
    room = headLength - options.reduce((sum, ids) => sum + ids.length, 0)
  }
  const prefix = [special.cls, ...encode(`choice question: ${escape(input.question)}`).slice(0, Math.max(8, room)), special.sep]
  const markers: number[] = []
  for (const option of options) { markers.push(prefix.length); prefix.push(...option) }
  prefix.push(special.sep)
  const state = encode(escape(input.state)), capacity = Math.max(0, maxLength - prefix.length - 1)
  const ids = [...prefix, ...state.slice(0, capacity), special.sep]
  if (ids.length > maxLength || markers.length !== input.choices.length) throw new Error('Decision options do not fit')
  return { ids, markers, truncated: state.length > capacity, collapsed: new Set(options.map((o) => o.join(','))).size !== options.length }
}
export function decisionProbabilities(logits: number[]): number[] {
  if (!logits.length || logits.some((n) => !Number.isFinite(n))) throw new Error('Invalid decision logits')
  const max = Math.max(...logits), values = logits.map((n) => Math.exp(n - max)), total = values.reduce((a, b) => a + b, 0)
  return values.map((n) => n / total)
}
