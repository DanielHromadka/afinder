import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/index'

const env: Env = { GITHUB_TOKEN: 'token', GITHUB_REPO: 'owner/feedback' }
const send = (body: unknown, e: Env = env, init: RequestInit = {}): Promise<Response> =>
  worker.fetch(new Request('https://feedback.test/v1/feedback', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...init }), e)

/** A fake GitHub API that records what it was asked. */
function fakeGitHub(status = 201): { calls: { method: string; url: string; body: Record<string, unknown>; auth: string | null }[] } {
  const calls: { method: string; url: string; body: Record<string, unknown>; auth: string | null }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push({ method: init?.method ?? 'GET', url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('Authorization') })
    return new Response(JSON.stringify({ number: 7 }), { status })
  })
  return { calls }
}

afterEach(() => vi.restoreAllMocks())

describe('feedback worker', () => {
  // The issue is public: an old version's e-mail and screenshot never reach it.
  it('files an issue without the e-mail and the screenshot of an old version', async () => {
    const { calls } = fakeGitHub()
    const res = await send({ kind: 'bug', message: 'Crash on rename\nsteps…', email: 'a@b.cz', screenshot: '/9j/4AAQ' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, issue: 7 })
    expect(calls.map((c) => [c.method, c.url])).toEqual([['POST', 'https://api.github.com/repos/owner/feedback/issues']])
    expect(calls[0]).toMatchObject({ auth: 'Bearer token', body: { title: 'Crash on rename', labels: ['bug'] } })
    expect(calls[0].body.body).not.toMatch(/b\.cz|Screenshot/)
  })

  it('files a suggestion as one call', async () => {
    const { calls } = fakeGitHub()
    expect((await send({ kind: 'idea', message: 'Dark XP theme' })).status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0].body.labels).toEqual(['enhancement'])
  })

  it('refuses bad requests before calling GitHub', async () => {
    const { calls } = fakeGitHub()
    expect((await worker.fetch(new Request('https://feedback.test/v1/feedback'), env)).status).toBe(405)
    expect((await worker.fetch(new Request('https://feedback.test/other'), env)).status).toBe(404)
    expect((await send('{nope')).status).toBe(400)
    expect(await (await send({ kind: 'bug', message: '' })).json()).toEqual({ error: 'message' })
    expect((await send({ kind: 'bug', message: 'x', screenshot: '/9j/' + 'A'.repeat(2_100_000) })).status).toBe(413)
    expect((await send({ kind: 'bug', message: 'x' }, { ...env, GITHUB_TOKEN: '' })).status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it('limits reports per address', async () => {
    fakeGitHub()
    const limited: Env = { ...env, SEND_LIMIT: { limit: async () => ({ success: false }) } }
    expect((await send({ kind: 'bug', message: 'x' }, limited)).status).toBe(429)
  })

  it('reports a GitHub failure without its details', async () => {
    fakeGitHub(401)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await send({ kind: 'bug', message: 'x' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'github' })
  })
})
