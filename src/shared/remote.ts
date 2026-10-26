// Remote storage (SFTP, S3, later SharePoint / WebDAV …) browsed as ordinary folders. Every connection
// is mounted at a virtual folder below the app's data folder ("…/aFinder/Remote/<id>"); paths below it
// are intercepted by the main process, so tabs, history, favorites and the layout keep working with
// plain absolute paths. The address bar shows them as URLs ("sftp://me@host/var/www").

import { isInside, relativeTo, separatorOf } from './paths'

export const REMOTE_TYPES = ['sftp', 's3', 'graph', 'afinder'] as const
export type RemoteType = (typeof REMOTE_TYPES)[number]

export type SftpAuth = 'password' | 'key' | 'agent'
/** Microsoft Graph: the signed-in user's OneDrive, or a document library of a SharePoint site. */
export type GraphTarget = 'onedrive' | 'sharepoint'

/** A saved connection without its secrets (those stay encrypted in the main process). */
export interface RemoteConnection {
  id: string
  name: string
  type: RemoteType
  /** SFTP: server name; S3: unused. */
  host: string
  port: number
  username: string
  /** SFTP: folder on the server shown as the root; S3: key prefix ("" = whole bucket); Graph: folder in the drive. */
  root: string
  sftpAuth: SftpAuth
  /** SFTP with a key: path of the private key file. */
  keyPath: string
  bucket: string
  region: string
  /** S3-compatible services (MinIO, Cloudflare R2, Wasabi …); "" = AWS. */
  endpoint: string
  /** S3: the access key id (the secret key is a secret). */
  accessKeyId: string
  /** Graph: Application (client) ID of the app registration (public client, redirect http://localhost). */
  clientId: string
  /** Graph: tenant id or domain, "organizations", "common" or "consumers". */
  tenant: string
  graphTarget: GraphTarget
  /** Graph + SharePoint: site address, e.g. https://contoso.sharepoint.com/sites/Team */
  siteUrl: string
  /** Graph + SharePoint: document library name ("" = the site's default library). */
  library: string
  /** aFinder on another computer: its relay, room and public key, from pairing (remote/afinder.ts). */
  peerRelay: string
  peerRoom: string
  peerKey: string
}

/** What the renderer gets: the connection, where it is mounted and how to show it. */
export interface RemoteMount {
  connection: RemoteConnection
  /** Absolute virtual folder of the connection's root. */
  path: string
  /** "sftp://user@host:port/root" or "s3://bucket/prefix". */
  url: string
  connected: boolean
}

/** Secrets typed into the connection dialog; empty fields keep the saved value. */
export interface RemoteSecrets {
  password?: string
  passphrase?: string
  secretAccessKey?: string
  /** aFinder on another computer: this computer's key for it, made by pairing in the main process (never typed). */
  clientKey?: string
}

export const REMOTE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/

export function emptyConnection(type: RemoteType): RemoteConnection {
  return {
    id: '',
    name: '',
    type,
    host: '',
    port: type === 'sftp' ? 22 : 443,
    username: '',
    root: type === 'sftp' ? '/' : '',
    sftpAuth: 'password',
    keyPath: '',
    bucket: '',
    region: 'us-east-1',
    endpoint: '',
    accessKeyId: '',
    clientId: '',
    tenant: 'organizations',
    graphTarget: 'sharepoint',
    siteUrl: '',
    library: '',
    peerRelay: '',
    peerRoom: '',
    peerKey: ''
  }
}

/** A readable, path-safe id from the connection name ("Web server" → "web-server"). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'remote'
}

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '')

export function remoteUrl(c: RemoteConnection): string {
  if (c.type === 'afinder') return `afinder://${encodeURIComponent(c.name)}`
  if (c.type === 'graph') {
    const folder = trimSlashes(c.root)
    if (c.graphTarget === 'onedrive') return `onedrive://me${folder ? `/${folder}` : ''}`
    let site = c.siteUrl
    try {
      const u = new URL(c.siteUrl)
      site = `${u.host}${u.pathname.replace(/\/+$/, '')}`
    } catch {
      // not a URL yet – show it as typed
    }
    return `sharepoint://${[site, c.library, folder].filter(Boolean).join('/')}`
  }
  if (c.type === 's3') return `s3://${c.bucket}${c.root ? `/${c.root.replace(/^\/+|\/+$/g, '')}` : ''}`
  const user = c.username ? `${encodeURIComponent(c.username)}@` : ''
  const port = c.port && c.port !== 22 ? `:${c.port}` : ''
  const root = c.root && c.root !== '/' ? `/${c.root.replace(/^\/+|\/+$/g, '')}` : ''
  return `sftp://${user}${c.host}${port}${root}`
}

/** The mount whose folder contains the path (the path itself may be the mount's root). */
export function mountOf(p: string, mounts: readonly RemoteMount[]): RemoteMount | null {
  return mounts.find((m) => isInside(p, m.path)) ?? null
}

/** Path as shown in the address bar: a URL for remote folders, unchanged otherwise. */
export function displayPath(p: string, mounts: readonly RemoteMount[]): string {
  const m = mountOf(p, mounts)
  if (!m) return p
  const rest = relativeTo(p, m.path)
  return rest ? `${m.url}/${rest.split(separatorOf(m.path)).join('/')}` : m.url
}

/** The reverse of displayPath for text typed into the address bar; other text comes back unchanged. */
export function resolveDisplayPath(text: string, mounts: readonly RemoteMount[]): string {
  if (!/^(sftp|s3|onedrive|sharepoint):\/\//i.test(text)) return text
  const trimmed = text.replace(/\/+$/, '')
  // Longest URL first, so "s3://b/a/b" prefers a mount of "s3://b/a" over one of "s3://b".
  for (const m of [...mounts].sort((a, b) => b.url.length - a.url.length)) {
    const url = m.url.replace(/\/+$/, '')
    if (trimmed.toLowerCase() === url.toLowerCase()) return m.path
    if (trimmed.toLowerCase().startsWith(`${url.toLowerCase()}/`)) {
      const sep = separatorOf(m.path)
      const segments = trimmed.slice(url.length + 1).split('/').filter(Boolean)
      return [m.path, ...segments].join(sep)
    }
  }
  return text
}

/** "https://contoso.sharepoint.com/sites/Team/Shared Documents/Forms/AllItems.aspx" → host + site path. */
export function parseSiteUrl(siteUrl: string): { host: string; path: string } {
  const u = new URL(siteUrl)
  let p = decodeURIComponent(u.pathname)
  // A pasted library or page address: keep only the site part.
  const cut = p.search(/\/(Forms|_layouts|SitePages|Lists)\//i)
  if (cut >= 0) p = p.slice(0, cut)
  const m = /^\/(sites|teams|personal)\/[^/]+/i.exec(p)
  return { host: u.host, path: m ? m[0] : '' }
}
