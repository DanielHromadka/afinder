// SharePoint document libraries and OneDrive through Microsoft Graph. Sign-in uses MSAL's
// interactive flow in the system browser (loopback redirect to http://localhost), so aFinder never
// sees the password and MFA / conditional access work as usual. The token cache is handed to the
// caller to keep encrypted; later connections sign in silently with the refresh token.
//
// Needs an app registration (Microsoft Entra ID → App registrations): platform "Mobile and desktop
// applications" with redirect URI http://localhost, "Allow public client flows" on, and the delegated
// permissions Files.ReadWrite.All + Sites.Read.All (SharePoint) or Files.ReadWrite (OneDrive).

import { createWriteStream } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { shell } from 'electron'
import { t } from '@shared/i18n'
import { parseSiteUrl, type RemoteConnection } from '@shared/remote'
import { fsError, type RemoteItem, type RemoteProvider } from './provider'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const SELECT = '$select=name,size,lastModifiedDateTime,folder,file,package'
/** Simple upload limit; larger files go through an upload session. */
const SIMPLE_UPLOAD = 4 * 1024 * 1024
/** Upload session fragments must be multiples of 320 KiB (and below 60 MiB). */
const FRAGMENT = 320 * 1024 * 32
const LOGIN_TIMEOUT_MS = 5 * 60_000

export interface GraphOptions {
  connection: RemoteConnection
  /** Serialized MSAL token cache from an earlier sign-in, or null. */
  tokenCache: string | null
  /** Called whenever MSAL changed the cache (sign-in, refreshed tokens). */
  saveTokenCache(serialized: string): void
}

interface DriveItem {
  id?: string
  name: string
  size?: number
  lastModifiedDateTime?: string
  folder?: object
}

const page = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>aFinder</title><body style="font:15px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#222"><div><h2>${title}</h2><p>${text}</p></div>`

export async function connectGraph(opts: GraphOptions): Promise<RemoteProvider> {
  const c = opts.connection
  const msal = await import('@azure/msal-node')
  let cache = opts.tokenCache
  const pca = new msal.PublicClientApplication({
    auth: { clientId: c.clientId, authority: `https://login.microsoftonline.com/${c.tenant || 'organizations'}` },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (ctx) => {
          if (cache) ctx.tokenCache.deserialize(cache)
        },
        afterCacheAccess: async (ctx) => {
          if (!ctx.cacheHasChanged) return
          cache = ctx.tokenCache.serialize()
          opts.saveTokenCache(cache)
        }
      }
    }
  })
  const scopes = c.graphTarget === 'onedrive' ? ['Files.ReadWrite'] : ['Files.ReadWrite.All', 'Sites.Read.All']

  // One sign-in at a time, however many requests are waiting for a token.
  let interactive: Promise<string> | null = null
  const token = async (): Promise<string> => {
    const [account] = await pca.getAllAccounts()
    if (account) {
      try {
        return (await pca.acquireTokenSilent({ account, scopes })).accessToken
      } catch {
        // refresh token expired or revoked, or new consent needed – sign in again
      }
    }
    interactive ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t('remote.error.loginTimeout'))), LOGIN_TIMEOUT_MS)
      })
      try {
        const login = pca.acquireTokenInteractive({
          scopes,
          openBrowser: (url) => shell.openExternal(url),
          successTemplate: page(t('remote.login.ok'), t('remote.login.okText')),
          errorTemplate: page(t('remote.login.failed'), '{error}')
        })
        return (await Promise.race([login, timeout])).accessToken
      } finally {
        clearTimeout(timer)
        interactive = null
      }
    })()
    return interactive
  }

  const errorOf = async (res: Response, what: string): Promise<Error> => {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    const code = body?.error?.code
    if (res.status === 404 || code === 'itemNotFound') return fsError('ENOENT', t('error.notFound'), what)
    if (res.status === 403 || code === 'accessDenied') return fsError('EACCES', t('error.denied'), what)
    if (res.status === 409 || code === 'nameAlreadyExists') return fsError('EEXIST', t('error.exists'), what)
    return new Error(body?.error?.message ?? `Microsoft Graph: HTTP ${res.status}`)
  }

  /** A Graph request with the bearer token; throttling (429 / 503) is retried after Retry-After. */
  const request = async (method: string, url: string, body?: RequestInit['body'], headers: Record<string, string> = {}): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url.startsWith('https://') ? url : GRAPH + url, {
        method,
        body,
        headers: { Authorization: `Bearer ${await token()}`, ...headers }
      })
      if ((res.status === 429 || res.status === 503) && attempt < 5) {
        const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt
        await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000))
        continue
      }
      return res
    }
  }

  const json = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
    const res = await request(method, url, body === undefined ? undefined : JSON.stringify(body), body === undefined ? {} : { 'Content-Type': 'application/json' })
    if (!res.ok) throw await errorOf(res, url)
    const text = await res.text() // 204 and some 200s have no body
    return (text ? JSON.parse(text) : null) as T
  }

  // ---- the drive ----------------------------------------------------------------------------------

  let driveId: string
  if (c.graphTarget === 'onedrive') {
    driveId = (await json<{ id: string }>('GET', '/me/drive?$select=id')).id
  } else {
    const { host, path } = parseSiteUrl(c.siteUrl)
    const site = await json<{ id: string }>('GET', `/sites/${host}${path ? `:${path.split('/').map(encodeURIComponent).join('/')}` : ''}?$select=id`).catch((err) => {
      throw (err as { code?: string }).code === 'ENOENT' ? new Error(t('remote.error.noSite', { site: c.siteUrl })) : err
    })
    if (!c.library) {
      driveId = (await json<{ id: string }>('GET', `/sites/${site.id}/drive?$select=id`)).id
    } else {
      const drives = await json<{ value: { id: string; name: string; webUrl?: string }[] }>('GET', `/sites/${site.id}/drives?$select=id,name,webUrl`)
      const wanted = c.library.toLowerCase()
      const drive = drives.value.find(
        (d) => d.name.toLowerCase() === wanted || decodeURIComponent(d.webUrl?.split('/').pop() ?? '').toLowerCase() === wanted
      )
      if (!drive) throw new Error(t('remote.error.noLibrary', { library: c.library, found: drives.value.map((d) => d.name).join(', ') }))
      driveId = drive.id
    }
  }

  const base = c.root.split('/').filter(Boolean)
  const itemUrl = (segments: string[]): string => {
    const all = [...base, ...segments]
    return all.length ? `/drives/${driveId}/root:/${all.map(encodeURIComponent).join('/')}:` : `/drives/${driveId}/root`
  }
  const toItem = (i: DriveItem): RemoteItem => ({
    name: i.name,
    isDir: i.folder !== undefined,
    size: i.folder ? 0 : (i.size ?? 0),
    modified: i.lastModifiedDateTime ? Date.parse(i.lastModifiedDateTime) : 0
  })

  const provider: RemoteProvider = {
    async list(dir) {
      const items: RemoteItem[] = []
      let next: string | undefined = `${itemUrl(dir)}/children?$top=999&${SELECT}`
      while (next) {
        const res: { value: DriveItem[]; '@odata.nextLink'?: string } = await json('GET', next)
        items.push(...res.value.map(toItem))
        next = res['@odata.nextLink']
      }
      return items
    },
    async stat(item) {
      const res = await request('GET', `${itemUrl(item)}?${SELECT}`)
      if (res.status === 404) return null
      if (!res.ok) throw await errorOf(res, itemUrl(item))
      return toItem((await res.json()) as DriveItem)
    },
    async download(file, localTarget) {
      // /content redirects to a pre-authenticated URL; fetch follows it (without our token).
      const res = await request('GET', `${itemUrl(file)}/content`)
      if (!res.ok || !res.body) throw await errorOf(res, itemUrl(file))
      await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(localTarget))
    },
    async upload(localSource, file) {
      const size = (await stat(localSource)).size
      if (size <= SIMPLE_UPLOAD) {
        const res = await request('PUT', `${itemUrl(file)}/content`, await readFile(localSource), { 'Content-Type': 'application/octet-stream' })
        if (!res.ok) throw await errorOf(res, itemUrl(file))
        return
      }
      const session = await json<{ uploadUrl: string }>('POST', `${itemUrl(file)}/createUploadSession`, {
        item: { '@microsoft.graph.conflictBehavior': 'replace' }
      })
      const fh = await open(localSource, 'r')
      try {
        const buffer = Buffer.alloc(FRAGMENT)
        for (let offset = 0; offset < size; ) {
          const { bytesRead } = await fh.read(buffer, 0, Math.min(FRAGMENT, size - offset), offset)
          const chunk = buffer.subarray(0, bytesRead)
          let res: Response | null = null
          for (let attempt = 0; attempt < 4; attempt++) {
            // The upload URL is pre-authenticated: sending the token here makes Graph answer 401.
            res = await fetch(session.uploadUrl, {
              method: 'PUT',
              body: chunk,
              headers: { 'Content-Length': String(bytesRead), 'Content-Range': `bytes ${offset}-${offset + bytesRead - 1}/${size}` }
            })
            if (res.status < 500 && res.status !== 429) break
            await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
          }
          if (!res || !res.ok) {
            await fetch(session.uploadUrl, { method: 'DELETE' }).catch(() => {})
            throw res ? await errorOf(res, itemUrl(file)) : new Error(t('error.invalidOption'))
          }
          offset += bytesRead
        }
      } finally {
        await fh.close()
      }
    },
    async mkdir(dir) {
      await json('POST', `${itemUrl(dir.slice(0, -1))}/children`, {
        name: dir.at(-1),
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail'
      })
    },
    async rename(from, to) {
      const patch: Record<string, unknown> = { name: to.at(-1) }
      const fromParent = from.slice(0, -1).join('/')
      const toParent = to.slice(0, -1)
      if (fromParent !== toParent.join('/')) {
        patch.parentReference = { id: (await json<{ id: string }>('GET', `${itemUrl(toParent)}?$select=id`)).id }
      }
      await json('PATCH', itemUrl(from), patch)
    },
    async remove(item) {
      if (item.length === 0) throw new Error(t('error.invalidPath'))
      // Goes to the site's (or OneDrive's) recycle bin.
      await json('DELETE', itemUrl(item))
    },
    async close() {
      // Nothing to close: requests are stateless; the token cache stays with the caller.
    }
  }
  return provider
}
