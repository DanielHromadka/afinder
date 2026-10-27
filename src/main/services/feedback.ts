// "Report a problem or suggest an improvement": the report, sent to the feedback Worker (feedback/), which
// files it as a public issue. Only ever sent from the user's Send button.

import os from 'node:os'
import { app, net } from 'electron'
import { checkReport, FEEDBACK_URL, type FeedbackReport } from '@shared/feedback'
import { getLanguage, t } from '@shared/i18n'
import type { FeedbackDraft } from '@shared/types'
import { loadState } from './settings'

export async function send(draft: FeedbackDraft): Promise<void> {
  // Tests point this at a local Worker.
  const url = process.env.AFINDER_FEEDBACK_URL || FEEDBACK_URL
  if (!url) throw new Error(t('feedback.notConfigured'))
  const report = checkReport({
    kind: draft.kind,
    message: draft.message,
    info: draft.includeInfo
      ? { version: app.getVersion(), platform: process.platform, os: os.release(), arch: process.arch, language: getLanguage(), theme: loadState().theme }
      : undefined
  } satisfies Record<keyof FeedbackReport, unknown>)
  if (typeof report === 'string') throw new Error(t('feedback.failed'))
  let res: Response
  try {
    res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(60_000) })
  } catch (err) {
    console.error('Feedback failed', err)
    throw new Error(t('feedback.offline'))
  }
  if (res.status === 429) throw new Error(t('feedback.tooMany'))
  if (!res.ok) throw new Error(`${t('feedback.failed')} (${res.status})`)
}
