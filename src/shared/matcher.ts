// Case- and diacritics-insensitive matching that returns the indexes of matched characters,
// so the UI can underline them. Indexes are code-point positions in the NFC form of the name
// (see `chars`) – macOS returns names in NFD, where "č" is two code units, which would
// otherwise shift the highlight.

const foldCache = new Map<string, string>()

/** Folds a single character: lower case, without diacritics. */
export function foldChar(ch: string): string {
  let folded = foldCache.get(ch)
  if (folded === undefined) {
    folded = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\p{M}/gu, '')
    folded = folded ? Array.from(folded)[0] : ch.toLowerCase()
    foldCache.set(ch, folded)
  }
  return folded
}

/** Splits text into display characters (NFC code points). */
export function chars(text: string): string[] {
  return Array.from(text.normalize('NFC'))
}

/**
 * Returns indexes of matched characters, [] for an empty query, or null if the name does not match.
 * Substring mode requires a contiguous match; fuzzy mode accepts the query characters in order
 * with gaps, but still prefers a contiguous match when there is one (nicer highlight).
 */
export function match(name: string, query: string, fuzzy: boolean): number[] | null {
  const q = chars(query.trim()).map(foldChar)
  if (q.length === 0) return []
  const n = chars(name).map(foldChar)

  const start = indexOfSeq(n, q)
  if (start >= 0) return q.map((_, i) => start + i)
  if (!fuzzy) return null

  const hits: number[] = []
  for (let i = 0, j = 0; i < n.length && j < q.length; i++) {
    if (n[i] === q[j]) {
      hits.push(i)
      j++
    }
  }
  return hits.length === q.length ? hits : null
}

function indexOfSeq(hay: string[], needle: string[]): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
