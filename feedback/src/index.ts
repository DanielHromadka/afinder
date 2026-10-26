// aFinder feedback: takes a bug report or suggestion from the app and files it as an issue in a private
// GitHub repository, with the window screenshot committed next to it. The GitHub token lives only
// here (a Worker secret), never in the app.

import { checkReport, issueBody, issueLabel, issueTitle, MAX_BODY } from '../../src/shared/feedback'

export interface Env {
  GITHUB_TOKEN: string
  /** owner/name of the (private) repository. */
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

    const now = new Date()
    const id = `${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`
    try {
      let image: string | undefined
      if (report.screenshot) {
        // A file in the private repository: only people with access to it can see the image.
        const saved = await github(env, 'PUT', `/contents/screenshots/${now.toISOString().slice(0, 7)}/${id}.jpg`, { message: `Screenshot ${id}`, content: report.screenshot })
        const html = (saved.content as { html_url?: string } | undefined)?.html_url
        if (html) image = `${html}?raw=true`
      }
      const issue = await github(env, 'POST', '/issues', { title: issueTitle(report), body: issueBody(report, image), labels: [issueLabel(report.kind)] })
      return json(201, { ok: true, issue: issue.number })
    } catch (err) {
      console.error(err)
      return json(502, { error: 'github' })
    }
  }
} satisfies ExportedHandler<Env>
