/** Saved code is reviewed once; no AI participates in execution or verification. */
export type AutomationTrigger =
  | { kind: 'manual' }
  | { kind: 'startup' }
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string }

export interface AutomationDraft {
  name: string
  description: string
  trigger: AutomationTrigger
  workflow: string[]
  outcome: string
  script: string
  verificationScript: string
  timeoutSeconds: number
}

export type AutomationProposal = { kind: 'ready'; draft: AutomationDraft } | { kind: 'questions'; questions: string[] }
export type AutomationRunStatus = 'running' | 'verifying' | 'success' | 'failed' | 'cancelled' | 'interrupted'
export interface AutomationRun {
  id: string
  startedAt: number
  finishedAt: number | null
  reason: 'manual' | 'schedule' | 'startup'
  status: AutomationRunStatus
  log: string
  error: string | null
}
export interface Automation extends AutomationDraft {
  id: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextRunAt: number | null
  runs: AutomationRun[]
}

function text(v: unknown, max: number): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) throw new Error('Invalid automation text')
  return v.trim()
}
export function validateTrigger(input: unknown): AutomationTrigger {
  if (!input || typeof input !== 'object') throw new Error('Invalid automation trigger')
  const t = input as Record<string, unknown>
  if (t.kind === 'manual' || t.kind === 'startup') return { kind: t.kind }
  if (t.kind === 'interval' && Number.isInteger(t.minutes) && Number(t.minutes) >= 1 && Number(t.minutes) <= 525600) {
    return { kind: 'interval', minutes: Number(t.minutes) }
  }
  if (t.kind === 'daily' && typeof t.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) return { kind: 'daily', time: t.time }
  throw new Error('Invalid automation trigger')
}
export function validateAutomationDraft(input: unknown): AutomationDraft {
  if (!input || typeof input !== 'object') throw new Error('Invalid automation')
  const d = input as Record<string, unknown>
  if (!Array.isArray(d.workflow) || d.workflow.length < 1 || d.workflow.length > 30) throw new Error('Invalid workflow')
  if (!Number.isInteger(d.timeoutSeconds) || Number(d.timeoutSeconds) < 10 || Number(d.timeoutSeconds) > 86400) throw new Error('Timeout must be 10–86400 seconds')
  return {
    name: text(d.name, 120), description: text(d.description, 8000), trigger: validateTrigger(d.trigger),
    workflow: d.workflow.map((s) => text(s, 1000)), outcome: text(d.outcome, 4000),
    script: text(d.script, 100000), verificationScript: text(d.verificationScript, 100000), timeoutSeconds: Number(d.timeoutSeconds)
  }
}

/** Daily schedules use the machine's local time; overdue jobs run once, never in a catch-up loop. */
export function nextAutomationRun(trigger: AutomationTrigger, now: number): number | null {
  if (trigger.kind === 'interval') return now + trigger.minutes * 60000
  if (trigger.kind !== 'daily') return null
  const [hour, minute] = trigger.time.split(':').map(Number)
  const date = new Date(now)
  date.setHours(hour, minute, 0, 0)
  if (date.getTime() <= now) date.setDate(date.getDate() + 1)
  return date.getTime()
}
