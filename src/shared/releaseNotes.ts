// Release notes: built from commit messages by scripts/release-notes.mjs in the release workflow, shown on the
// GitHub release, in the update prompt and in the app's "What's new" dialog. No imports: the script runs this
// file directly with Node's type stripping.

export interface ReleaseNote {
  version: string
  /** ISO date of the release. */
  date: string
  notes: string[]
}

export interface Commit {
  subject: string
  body: string
}

/** Commits that say nothing to users: version bumps, merges, reverted reverts. */
const NOISE = /^(Raise the version to|Merge (branch|pull request|remote-tracking)|Revert "Revert)/
/** `Release-Note: text` replaces the subject (several lines allowed); `Release-Note: none` hides the commit. */
const TRAILER = /^Release-Note:\s*(.+)$/gim
const MARKER = /<!--\s*commit:\s*([0-9a-f]{7,40})\s*-->/i
export const MAX_NOTES = 30

export function noteLines(commits: Commit[]): string[] {
  const lines: string[] = []
  for (const c of commits) {
    const trailers = [...c.body.matchAll(TRAILER)].map((m) => m[1].trim())
    if (trailers.some((t) => /^none$/i.test(t))) continue
    if (trailers.length) lines.push(...trailers)
    else if (c.subject.trim() && !NOISE.test(c.subject)) lines.push(c.subject.trim())
  }
  // Oldest first reads like a story; the same line twice (a fix of a fix) only once.
  return [...new Set(lines)]
}

/** The GitHub release body: bullets plus the commit marker the next release starts counting from. */
export function releaseBody(version: string, lines: string[], commit: string): string {
  const bullets = lines.length ? lines.map((l) => `- ${l}`).join('\n') : `- aFinder ${version}`
  return `${bullets}\n\n<!-- commit: ${commit} -->\n`
}

/** The commit a release was built from, if its body has the marker (releases before this feature do not). */
export const releaseCommit = (body: string | null | undefined): string | null => MARKER.exec(body ?? '')?.[1] ?? null

/**
 * Lines of a release body, Markdown (the REST API) or HTML (the Atom feed electron-updater reads): the bullets,
 * or for older releases whose body is a bare commit message, its subject line.
 */
export function bodyLines(body: string | null | undefined): string[] {
  const text = (body ?? '')
    .replace(MARKER, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(li|p|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const bullets = lines.filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ''))
  return bullets.length ? bullets : lines.slice(0, 1)
}

/** A release-notes.json read from disk or the network: anything malformed is dropped, not trusted. */
export function sanitizeNotes(raw: unknown): ReleaseNote[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is ReleaseNote => !!r && typeof r.version === 'string' && typeof r.date === 'string' && Array.isArray(r.notes))
    .slice(0, MAX_NOTES)
    .map((r) => ({ version: r.version.slice(0, 40), date: r.date.slice(0, 40), notes: r.notes.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 500)) }))
}
