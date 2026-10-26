import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyConnection } from '@shared/remote'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('@azure/msal-node', () => ({
  PublicClientApplication: class {
    async getAllAccounts(): Promise<unknown[]> {
      return [{ homeAccountId: 'a' }]
    }
    async acquireTokenSilent(): Promise<{ accessToken: string }> {
      return { accessToken: 'tok' }
    }
  }
}))

const { connectGraph } = await import('./graph')

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

let calls: Call[]
let routes: (call: Call) => Response | undefined
const G = 'https://graph.microsoft.com/v1.0'

beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const call = { method: init.method ?? 'GET', url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body }
    calls.push(call)
    return routes(call) ?? new Response(JSON.stringify({ error: { code: 'itemNotFound' } }), { status: 404 })
  })
})
afterEach(() => vi.unstubAllGlobals())

const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

const sharepoint = {
  ...emptyConnection('graph'),
  clientId: '11111111-2222-3333-4444-555555555555',
  siteUrl: 'https://contoso.sharepoint.com/sites/Team/Shared%20Documents/Forms/AllItems.aspx',
  library: 'Shared Documents',
  root: 'Projekty'
}

const siteRoutes = (call: Call): Response | undefined => {
  if (call.url === `${G}/sites/contoso.sharepoint.com:/sites/Team?$select=id`) return json({ id: 'S' })
  if (call.url.startsWith(`${G}/sites/S/drives?`)) {
    return json({ value: [{ id: 'D', name: 'Dokumenty', webUrl: 'https://contoso.sharepoint.com/sites/Team/Shared%20Documents' }] })
  }
  return undefined
}

describe('Microsoft Graph provider', () => {
  it('finds the library by its URL name, lists with paging and maps items', async () => {
    routes = (call) =>
      siteRoutes(call) ??
      (call.url.startsWith(`${G}/drives/D/root:/Projekty/a%20b:/children?`)
        ? json({
            value: [{ name: 'sub', folder: {}, lastModifiedDateTime: '2026-01-02T03:04:05Z' }],
            '@odata.nextLink': `${G}/next-page`
          })
        : call.url === `${G}/next-page`
          ? json({ value: [{ name: 'x.txt', size: 5, file: {}, lastModifiedDateTime: '2026-01-02T03:04:05Z' }] })
          : undefined)
    const p = await connectGraph({ connection: sharepoint, tokenCache: null, saveTokenCache: () => {} })
    const items = await p.list(['a b'])
    expect(items).toEqual([
      { name: 'sub', isDir: true, size: 0, modified: Date.parse('2026-01-02T03:04:05Z') },
      { name: 'x.txt', isDir: false, size: 5, modified: Date.parse('2026-01-02T03:04:05Z') }
    ])
    expect(calls.every((c) => c.headers.Authorization === 'Bearer tok')).toBe(true)
  })

  it('reports a missing library with the available ones', async () => {
    routes = siteRoutes
    await expect(connectGraph({ connection: { ...sharepoint, library: 'Nope' }, tokenCache: null, saveTokenCache: () => {} })).rejects.toThrow(/Dokumenty/)
  })

  it('creates folders, renames, moves and deletes by path', async () => {
    routes = (call) =>
      siteRoutes(call) ??
      (call.method === 'GET' && call.url === `${G}/drives/D/root:/Projekty/target:?$select=id`
        ? json({ id: 'T' })
        : call.method !== 'GET'
          ? new Response(null, { status: call.method === 'DELETE' ? 204 : 200 })
          : undefined)
    const p = await connectGraph({ connection: sharepoint, tokenCache: null, saveTokenCache: () => {} })
    calls = []
    await p.mkdir(['new'])
    await p.rename(['a.txt'], ['b.txt'])
    await p.rename(['b.txt'], ['target', 'b.txt'])
    await p.remove(['b.txt'], false)
    expect(calls.map((c) => `${c.method} ${c.url.slice(G.length)} ${c.body ?? ''}`)).toEqual([
      `POST /drives/D/root:/Projekty:/children {"name":"new","folder":{},"@microsoft.graph.conflictBehavior":"fail"}`,
      `PATCH /drives/D/root:/Projekty/a.txt: {"name":"b.txt"}`,
      `GET /drives/D/root:/Projekty/target:?$select=id `,
      `PATCH /drives/D/root:/Projekty/b.txt: {"name":"b.txt","parentReference":{"id":"T"}}`,
      `DELETE /drives/D/root:/Projekty/b.txt: `
    ])
  })

  it('uploads large files in 320 KiB-aligned fragments without the token', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'afgraph-'))
    const file = path.join(dir, 'big.bin')
    const size = 12 * 1024 * 1024 + 7
    writeFileSync(file, Buffer.alloc(size, 1))
    routes = (call) =>
      siteRoutes(call) ??
      (call.url === `${G}/drives/D/root:/Projekty/big.bin:/createUploadSession`
        ? json({ uploadUrl: 'https://upload.example/session' })
        : call.url === 'https://upload.example/session'
          ? new Response(null, { status: 202 })
          : undefined)
    const p = await connectGraph({ connection: sharepoint, tokenCache: null, saveTokenCache: () => {} })
    calls = []
    await p.upload(file, ['big.bin'])
    const puts = calls.filter((c) => c.url === 'https://upload.example/session')
    const fragment = 320 * 1024 * 32
    expect(puts.map((c) => c.headers['Content-Range'])).toEqual([
      `bytes 0-${fragment - 1}/${size}`,
      `bytes ${fragment}-${size - 1}/${size}`
    ])
    expect(puts.every((c) => c.headers.Authorization === undefined)).toBe(true)
  })

  it('downloads content and retries throttled requests', async () => {
    let throttled = false
    routes = (call) => {
      if (call.url === `${G}/me/drive?$select=id`) return json({ id: 'OD' })
      if (call.url === `${G}/drives/OD/root:/a.txt:/content`) {
        if (!throttled) {
          throttled = true
          return new Response(null, { status: 429, headers: { 'Retry-After': '0' } })
        }
        return new Response('hello graph')
      }
      return undefined
    }
    const p = await connectGraph({ connection: { ...sharepoint, graphTarget: 'onedrive', root: '' }, tokenCache: null, saveTokenCache: () => {} })
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'afgraph-')), 'a.txt')
    await p.download(['a.txt'], out)
    expect(readFileSync(out, 'utf8')).toBe('hello graph')
    expect(throttled).toBe(true)
  })
})
