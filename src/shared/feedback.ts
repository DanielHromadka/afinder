// Bug reports and suggestions: what aFinder sends to the feedback Worker (feedback/) and how the Worker
// turns it into a public GitHub issue. Shared by both sides, so it uses no Node, DOM or Workers APIs.
// The issue is public, so a report carries no e-mail and no screenshot. Versions up to 1.1.25 still send
// both: checkReport drops them.

export type FeedbackKind = 'bug' | 'idea'

/** Technical details the user may attach; never paths or file names. */
export interface FeedbackInfo {
  version: string
  platform: string
  os: string
  arch: string
  language: string
  theme: string
}

export interface FeedbackReport {
  kind: FeedbackKind
  message: string
  info?: FeedbackInfo
}

/** The deployed Worker (feedback/, `npm run deploy`). */
export const FEEDBACK_URL = 'https://afinder-feedback.danielhromadka1.workers.dev/v1/feedback'

export const MAX_MESSAGE = 5000
/** The whole request body; the Worker refuses anything bigger before parsing it. Room for the screenshot of an old version. */
export const MAX_BODY = 2_000_000 + 64 * 1024
const INFO_KEYS: readonly (keyof FeedbackInfo)[] = ['version', 'platform', 'os', 'arch', 'language', 'theme']

/** The report if it is well formed, else the reason it is not (also run by the Worker on untrusted input). */
export function checkReport(value: unknown): FeedbackReport | string {
  if (!value || typeof value !== 'object') return 'not an object'
  const v = value as Record<string, unknown>
  if (v.kind !== 'bug' && v.kind !== 'idea') return 'kind'
  if (typeof v.message !== 'string' || !v.message.trim() || v.message.length > MAX_MESSAGE) return 'message'
  const report: FeedbackReport = { kind: v.kind, message: v.message.trim() }
  if (v.info !== undefined) {
    const info = v.info as Record<string, unknown> | null
    if (!info || typeof info !== 'object') return 'info'
    const clean = {} as FeedbackInfo
    for (const key of INFO_KEYS) {
      const field = info[key]
      if (typeof field !== 'string' || field.length > 100) return 'info'
      clean[key] = field
    }
    report.info = clean
  }
  return report
}

/** Keeps user text from mentioning GitHub users or breaking out of a table cell. */
const quiet = (s: string): string => s.replace(/@(?=[\w-])/g, '@​')
const cell = (s: string): string => quiet(s).replace(/[|\r\n]/g, ' ')

/** The first line of the message, shortened: issue titles stay readable in the list. */
export function issueTitle(report: FeedbackReport): string {
  const line = report.message.split('\n')[0].trim()
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

export function issueBody(report: FeedbackReport): string {
  const rows: [string, string][] = [['Type', report.kind === 'bug' ? 'Bug' : 'Suggestion']]
  if (report.info) {
    const i = report.info
    rows.push(['aFinder', i.version], ['System', `${i.platform} ${i.os} (${i.arch})`], ['Language', i.language], ['Theme', i.theme])
  }
  return [
    quiet(report.message),
    '',
    '---',
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)
  ].join('\n')
}

export const issueLabel = (kind: FeedbackKind): string => (kind === 'bug' ? 'bug' : 'enhancement')
