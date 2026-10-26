// Recently touched files: what the user opened, created, edited or captured in aFinder, newest first.
// Shared so that main keeps the list and the renderer shows it with the same types and limits.

export const RECENT_ACTIONS = ['opened', 'created', 'edited', 'screenshot'] as const
export type RecentAction = (typeof RECENT_ACTIONS)[number]

export interface RecentFile {
  path: string
  at: number
  action: RecentAction
}

export const MAX_RECENTS = 50

/** Moves the path to the top (a file touched again is not listed twice) and caps the list. */
export function addRecent(list: RecentFile[], item: RecentFile): RecentFile[] {
  return [item, ...list.filter((r) => r.path !== item.path)].slice(0, MAX_RECENTS)
}

/** Keeps well-formed entries only, newest first, without duplicates – the file on disk may be hand-edited. */
export function sanitizeRecents(value: unknown): RecentFile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: RecentFile[] = []
  for (const v of value) {
    if (typeof v !== 'object' || v === null) continue
    const { path, at, action } = v as Record<string, unknown>
    if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0') || seen.has(path)) continue
    if (typeof at !== 'number' || !Number.isFinite(at) || !(RECENT_ACTIONS as readonly unknown[]).includes(action)) continue
    seen.add(path)
    out.push({ path, at, action: action as RecentAction })
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_RECENTS)
}

/** `Screenshot 2026-10-12 at 16.20.05.png` – the prefix is localized, the time is the local wall clock. */
export function screenshotName(prefix: string, date: Date, taken: (name: string) => boolean): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  for (let n = 1; ; n++) {
    const name = `${prefix.replace('{time}', stamp)}${n > 1 ? ` (${n})` : ''}.png`
    if (!taken(name)) return name
  }
}
