// Runs the regular expression off the UI thread: a pattern like (a+)+$ on a long text can take forever,
// and the tester terminates this worker instead of freezing the window.

export interface RegexJob {
  pattern: string
  flags: string
  text: string
  replace: string | null
}

export interface RegexMatch {
  index: number
  text: string
  groups: (string | undefined)[]
  named: Record<string, string | undefined> | null
}

export type RegexAnswer = { matches: RegexMatch[]; total: number; replaced: string | null } | { error: string }

const MAX_MATCHES = 500

self.onmessage = (e: MessageEvent<RegexJob>) => {
  const { pattern, flags, text, replace } = e.data
  try {
    const re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
    const matches: RegexMatch[] = []
    let total = 0
    for (const m of text.matchAll(re)) {
      total++
      if (matches.length < MAX_MATCHES) matches.push({ index: m.index ?? 0, text: m[0], groups: m.slice(1), named: m.groups ? { ...m.groups } : null })
      if (!flags.includes('g')) break
    }
    const replaced = replace === null ? null : text.replace(new RegExp(pattern, flags), replace)
    self.postMessage({ matches, total, replaced } satisfies RegexAnswer)
  } catch (err) {
    self.postMessage({ error: (err as Error).message } satisfies RegexAnswer)
  }
}
