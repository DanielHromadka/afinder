// Bug reports and suggestions: what aFinder sends to the feedback Worker (feedback/) and how the Worker
// turns it into a GitHub issue. Shared by both sides, so it uses no Node, DOM or Workers APIs.

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
  /** Where the user wants an answer, if anywhere. */
  email?: string
  /** The aFinder window as a base64 JPEG. */
  screenshot?: string
  info?: FeedbackInfo
}

/** The deployed Worker (feedback/, `npm run deploy`). */
export const FEEDBACK_URL = 'https://afinder-feedback.danielhromadka1.workers.dev/v1/feedback'

export const MAX_MESSAGE = 5000
export const MAX_EMAIL = 200
/** Base64 characters (about 1.5 MB of JPEG): a 1600 px window shot is a few hundred kB. */
export const MAX_SCREENSHOT = 2_000_000
/** The whole request body; the Worker refuses anything bigger before parsing it. */
export const MAX_BODY = MAX_SCREENSHOT + 64 * 1024

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Base64 that starts like a JPEG (FF D8 FF). */
const JPEG_B64_RE = /^\/9j\/[A-Za-z0-9+/]*={0,2}$/
const INFO_KEYS: readonly (keyof FeedbackInfo)[] = ['version', 'platform', 'os', 'arch', 'language', 'theme']

/** The report if it is well formed, else the reason it is not (also run by the Worker on untrusted input). */
export function checkReport(value: unknown): FeedbackReport | string {
  if (!value || typeof value !== 'object') return 'not an object'
  const v = value as Record<string, unknown>
  if (v.kind !== 'bug' && v.kind !== 'idea') return 'kind'
  if (typeof v.message !== 'string' || !v.message.trim() || v.message.length > MAX_MESSAGE) return 'message'
  const report: FeedbackReport = { kind: v.kind, message: v.message.trim() }
  if (v.email !== undefined && v.email !== '') {
    if (typeof v.email !== 'string' || v.email.length > MAX_EMAIL || !EMAIL_RE.test(v.email.trim())) return 'email'
    report.email = v.email.trim()
  }
  if (v.screenshot !== undefined) {
    if (typeof v.screenshot !== 'string' || v.screenshot.length > MAX_SCREENSHOT || !JPEG_B64_RE.test(v.screenshot)) return 'screenshot'
    report.screenshot = v.screenshot
  }
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

export function issueBody(report: FeedbackReport, screenshotUrl?: string): string {
  const rows: [string, string][] = [['Type', report.kind === 'bug' ? 'Bug' : 'Suggestion']]
  if (report.info) {
    const i = report.info
    rows.push(['aFinder', i.version], ['System', `${i.platform} ${i.os} (${i.arch})`], ['Language', i.language], ['Theme', i.theme])
  }
  if (report.email) rows.push(['Reply to', report.email])
  return [
    quiet(report.message),
    '',
    '---',
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`),
    ...(screenshotUrl ? ['', `![Screenshot](${screenshotUrl})`] : [])
  ].join('\n')
}

export const issueLabel = (kind: FeedbackKind): string => (kind === 'bug' ? 'bug' : 'enhancement')
