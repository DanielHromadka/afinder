export const ACTIVITY_ACTIONS = ['visit', 'open', 'create', 'rename', 'copy', 'move', 'archive', 'trash', 'edit', 'terminal', 'project', 'automation', 'screen', 'note'] as const
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]
export const ACTIVITY_RETENTION = [7, 30, 90, 365] as const
export type ActivityOutcome = 'success' | 'failed' | 'cancelled' | 'started'
export interface ActivityEvent {
  id: string
  at: number
  session: string
  action: ActivityAction
  outcome: ActivityOutcome
  folder: string | null
  paths: string[]
  destinations: string[]
  count: number
  label: string
  /** Only explicitly saved fragments. Never populated from file contents, prompts or terminal I/O. */
  note: string
  errorCode: string | null
  durationMs: number
}
export interface ActivityQuery {
  text?: string
  action?: ActivityAction | ''
  outcome?: ActivityOutcome | ''
  folder?: string
  from?: number
  to?: number
  mode?: 'text' | 'semantic'
  offset?: number
  limit?: number
}
export interface ActivityPage { events: ActivityEvent[]; total: number; partial: boolean }
export interface ActivityStatus {
  enabled: boolean
  semanticEnabled: boolean
  total: number
  indexed: number
  pending: number
  indexing: boolean
  modelReady: boolean
  downloading: boolean
  downloadProgress: number
  error: string | null
  model: string
}
export interface ActivityOptions { activityEnabled: boolean; semanticEnabled: boolean; activityRetentionDays: number }
