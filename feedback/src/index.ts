// aFinder feedback: takes a bug report or suggestion from the app and files it as a public issue in the
// aFinder repository. The GitHub token lives only here (a Worker secret), never in the app.

import { checkReport, issueBody, issueLabel, issueTitle, MAX_BODY } from '../../src/shared/feedback'

export interface Env {
  GITHUB_TOKEN: string
  /** owner/name of the repository that gets the issues. */
  GITHUB_REPO: string
  /** Only for tests and local runs; GitHub's API otherwise. */
  GITHUB_API?: string
  SEND_LIMIT?: RateLimit
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function github(env: Env, method: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${env.GITHUB_API || 'https://api.github.com'}/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'afinder-feedback',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as Record<string, unknown>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/') return new Response('aFinder feedback\n')
    if (url.pathname !== '/v1/feedback') return json(404, { error: 'not-found' })
    if (request.method !== 'POST') return json(405, { error: 'method' })
    // Checked before reading, and again on the text: Content-Length can be missing or wrong.
    if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return json(413, { error: 'too-big' })
    if (env.SEND_LIMIT) {
      const { success } = await env.SEND_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'local' })
      if (!success) return json(429, { error: 'too-many' })
    }
    const text = await request.text()
    if (text.length > MAX_BODY) return json(413, { error: 'too-big' })
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return json(400, { error: 'json' })
    }
    const report = checkReport(parsed)
    if (typeof report === 'string') return json(400, { error: report })
    if (!env.GITHUB_TOKEN) return json(503, { error: 'not-configured' })

    try {
      const issue = await github(env, 'POST', '/issues', { title: issueTitle(report), body: issueBody(report), labels: [issueLabel(report.kind)] })
      return json(201, { ok: true, issue: issue.number })
    } catch (err) {
      console.error(err)
      return json(502, { error: 'github' })
    }
  }
} satisfies ExportedHandler<Env>
