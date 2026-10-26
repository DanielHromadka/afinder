// SFTP backend on ssh2-sftp-client. Host keys are pinned on first use (trust on first use, like
// OpenSSH's known_hosts): a later connection to a server presenting a different key is refused.

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type SftpClient from 'ssh2-sftp-client'
import { t } from '@shared/i18n'
import type { RemoteConnection, RemoteSecrets } from '@shared/remote'
import { fsError, type RemoteItem, type RemoteProvider } from './provider'

export interface SftpOptions {
  connection: RemoteConnection
  secrets: RemoteSecrets
  /** SHA-256 of the server's host key seen before, or null on first use. */
  hostKey: string | null
  /** Called with the host key of a server seen for the first time. */
  onNewHostKey(hash: string): void
}

const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p)

function agentSocket(): string | undefined {
  if (process.platform === 'win32') return 'pageant'
  return process.env.SSH_AUTH_SOCK
}

export async function connectSftp(opts: SftpOptions): Promise<RemoteProvider> {
  const { connection: c, secrets } = opts
  const { default: Client } = await import('ssh2-sftp-client')
  const client: SftpClient = new Client(`afinder-${c.id || 'test'}`)
  let refused = false

  const auth =
    c.sftpAuth === 'agent'
      ? { agent: agentSocket() }
      : c.sftpAuth === 'key'
        ? { privateKey: await readFile(expandHome(c.keyPath)).catch(() => Promise.reject(new Error(t('remote.error.keyFile', { path: c.keyPath })))), passphrase: secrets.passphrase || undefined }
        : { password: secrets.password ?? '' }

  try {
    await client.connect({
      host: c.host,
      port: c.port || 22,
      username: c.username,
      readyTimeout: 20_000,
      keepaliveInterval: 30_000,
      hostHash: 'sha256',
      hostVerifier: (hash: string) => {
        if (!opts.hostKey) {
          opts.onNewHostKey(hash)
          return true
        }
        refused = hash !== opts.hostKey
        return !refused
      },
      ...auth
    } as SftpClient.ConnectOptions)
  } catch (err) {
    await client.end().catch(() => {})
    if (refused) throw new Error(t('remote.error.hostKeyChanged', { host: c.host }))
    throw err
  }

  const base = c.root && c.root !== '/' ? (c.root.startsWith('/') ? c.root : `/${c.root}`) : '/'
  const full = (segments: string[]): string => path.posix.join(base, ...segments)

  const toItem = (name: string, type: string, size: number, modified: number): RemoteItem => ({
    name,
    isDir: type === 'd',
    size: type === 'd' ? 0 : size,
    modified
  })

  /** Symlinks are followed so links to folders can be opened. */
  const resolveLink = async (p: string, name: string, size: number, modified: number): Promise<RemoteItem> => {
    try {
      const st = await client.stat(p)
      return { name, isDir: st.isDirectory, size: st.isDirectory ? 0 : st.size, modified: st.modifyTime || modified }
    } catch {
      return { name, isDir: false, size, modified } // broken link
    }
  }

  const mapError = (err: unknown, p: string): never => {
    const e = err as { code?: number | string; message?: string }
    // SFTP status codes: 2 = no such file, 3 = permission denied.
    if (e.code === 2 || e.code === 'ENOENT') throw fsError('ENOENT', t('error.notFound'), p)
    if (e.code === 3 || e.code === 'EACCES') throw fsError('EACCES', t('error.denied'), p)
    throw err
  }

  return {
    async list(dir) {
      const p = full(dir)
      const items = await client.list(p).catch((err) => mapError(err, p))
      return Promise.all(
        items
          .filter((i) => i.name !== '.' && i.name !== '..')
          .map((i) => (i.type === 'l' ? resolveLink(path.posix.join(p, i.name), i.name, i.size, i.modifyTime) : toItem(i.name, i.type, i.size, i.modifyTime)))
      )
    },
    async stat(item) {
      try {
        const st = await client.stat(full(item))
        return { name: item.at(-1) ?? '', isDir: st.isDirectory, size: st.isDirectory ? 0 : st.size, modified: st.modifyTime }
      } catch {
        return null
      }
    },
    async download(file, localTarget) {
      await client.fastGet(full(file), localTarget).catch((err) => mapError(err, full(file)))
    },
    async upload(localSource, file) {
      await client.fastPut(localSource, full(file)).catch((err) => mapError(err, full(file)))
    },
    async mkdir(dir) {
      await client.mkdir(full(dir), false).catch((err) => mapError(err, full(dir)))
    },
    async rename(from, to) {
      await client.rename(full(from), full(to)).catch((err) => mapError(err, full(from)))
    },
    async remove(item, isDir) {
      const p = full(item)
      if (p === base || p === '/') throw new Error(t('error.invalidPath'))
      if (isDir) await client.rmdir(p, true).catch((err) => mapError(err, p))
      else await client.delete(p).catch((err) => mapError(err, p))
    },
    async close() {
      await client.end().catch(() => {})
    }
  }
}
