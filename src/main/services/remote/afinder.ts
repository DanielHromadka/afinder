// Another computer running aFinder, paired like a phone (companion pairing link + code check) and reached
// through its relay with the end-to-end encrypted companion protocol (shared/companion/client.ts). Its files
// are mounted like any remote storage; the root lists its places (home, desktop, disks …), so paths work the
// same whether it runs macOS, Windows or Linux. The same session carries the remote desktop signalling.

import { createWriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { t } from '@shared/i18n'
import { fromB64 } from '@shared/companion/bytes'
import { HostClient, type Computer, type HostState } from '@shared/companion/client'
import { keyPairOf } from '@shared/companion/crypto'
import type { HostInfo, RemoteEntry, RpcMethods } from '@shared/companion/protocol'
import type { RemoteConnection } from '@shared/remote'
import { fsError, type RemoteItem, type RemoteProvider } from './provider'

const READY_MS = 15_000
/** Messages of the client's own errors: the connection, not the request, failed. */
const OFFLINE = new Set(['offline', 'disconnected', 'closed'])

export const computerOf = (c: RemoteConnection): Computer => ({ id: c.peerRoom, relay: c.peerRelay, key: c.peerKey, name: c.name })

/** Waits until the session is up; the client keeps reconnecting on its own. */
export function whenReady(client: HostClient, ms = READY_MS): Promise<HostInfo> {
  const now = client.state
  if (now.kind === 'ready') return Promise.resolve(now.info)
  return new Promise((resolve, reject) => {
    let last: HostState = now
    const done = (err: Error | null, info?: HostInfo): void => {
      clearTimeout(timer)
      off()
      if (err) reject(err)
      else resolve(info!)
    }
    const off = client.subscribe((s) => {
      last = s
      if (s.kind === 'ready') done(null, s.info)
      else if (s.kind === 'refused') done(new Error(t('remote.error.computerRefused')))
    })
    const timer = setTimeout(() => done(new Error(last.kind === 'offline' ? t('remote.error.computerNotRunning') : t('remote.error.computerOffline'))), ms)
  })
}

export class AfinderProvider implements RemoteProvider {
  private places: { name: string; path: string }[] | null = null
  private sep = '/'

  constructor(readonly client: HostClient) {}

  async info(): Promise<HostInfo> {
    const info = await whenReady(this.client)
    this.sep = info.platform === 'win32' ? '\\' : '/'
    return info
  }

  /** Any call, with the connection's failures told as such. */
  async call<M extends keyof RpcMethods>(method: M, params: RpcMethods[M][0]): Promise<RpcMethods[M][1]> {
    await this.info()
    try {
      return await this.client.call(method, params)
    } catch (err) {
      throw OFFLINE.has((err as Error).message) ? new Error(t('remote.error.computerOffline')) : err
    }
  }

  /** Root entries are the computer's places; names are made unique and path-safe for the mount. */
  private async rootPlaces(): Promise<{ name: string; path: string }[]> {
    if (this.places) return this.places
    const seen = new Set<string>()
    this.places = (await this.call('places', {})).map((p) => {
      let name = p.name.replace(/[/\\:]/g, '-').trim() || '-'
      for (let n = 2; seen.has(name); n++) name = `${p.name} ${n}`
      seen.add(name)
      return { name, path: p.path }
    })
    return this.places
  }

  /** The path on the other computer of an item below the mount. */
  async hostPath(item: string[]): Promise<string> {
    if (item.length === 0) throw fsError('EACCES', t('remote.error.computerRoot'))
    const place = (await this.rootPlaces()).find((p) => p.name === item[0])
    if (!place) throw fsError('ENOENT', t('error.notFound'))
    if (item.length === 1) return place.path
    return place.path.replace(/[/\\]+$/, '') + this.sep + item.slice(1).join(this.sep)
  }

  async list(dir: string[]): Promise<RemoteItem[]> {
    if (dir.length === 0) return (await this.rootPlaces()).map((p) => ({ name: p.name, isDir: true, size: 0, modified: 0 }))
    const l = await this.call('list', { path: await this.hostPath(dir) })
    return l.entries.map((e: RemoteEntry) => ({ name: e.name, isDir: e.dir, size: e.size ?? 0, modified: e.modified }))
  }

  async stat(item: string[]): Promise<RemoteItem | null> {
    if (item.length === 0) return { name: '', isDir: true, size: 0, modified: 0 }
    if (item.length === 1) return (await this.list([])).find((p) => p.name === item[0]) ?? null
    try {
      const s = await this.call('stat', { path: await this.hostPath(item) })
      return { name: item.at(-1)!, isDir: s.dir, size: s.size, modified: s.modified }
    } catch (err) {
      // The error is the other computer's text: tell "missing" from a real failure by the folder's listing.
      const siblings = await this.list(item.slice(0, -1))
      if (!siblings.some((x) => x.name === item.at(-1))) return null
      throw err
    }
  }

  async download(file: string[], localTarget: string): Promise<void> {
    const out = createWriteStream(localTarget)
    const write = (data: Uint8Array): Promise<void> => new Promise((resolve, reject) => out.write(data, (err) => (err ? reject(err) : resolve())))
    try {
      await this.info()
      await this.client.download(await this.hostPath(file), write)
    } finally {
      await new Promise((r) => out.end(r))
    }
  }

  async upload(localSource: string, file: string[]): Promise<void> {
    const { size } = await stat(localSource)
    const fh = await open(localSource, 'r')
    const read = async (offset: number, length: number): Promise<Uint8Array> => {
      const buf = new Uint8Array(length)
      const { bytesRead } = await fh.read(buf, 0, length, offset)
      return buf.subarray(0, bytesRead)
    }
    try {
      await this.info()
      const target = await this.hostPath(file)
      if (await this.stat(file)) await this.client.replace(target, size, read)
      else {
        const saved = await this.client.upload(await this.hostPath(file.slice(0, -1)), file.at(-1)!, size, read)
        // The other computer picks a free name when one appeared meanwhile; this one asked for that name.
        if (saved !== target) throw fsError('EEXIST', t('error.nameExists', { name: file.at(-1)! }))
      }
    } finally {
      await fh.close()
    }
  }

  async mkdir(dir: string[]): Promise<void> {
    await this.call('mkdir', { parent: await this.hostPath(dir.slice(0, -1)), name: dir.at(-1)! })
  }

  async rename(from: string[], to: string[]): Promise<void> {
    const src = await this.hostPath(from)
    const sameFolder = from.length === to.length && from.slice(0, -1).every((s, i) => s === to[i])
    if (sameFolder) return void (await this.call('rename', { path: src, name: to.at(-1)! }))
    if (from.at(-1) !== to.at(-1)) throw fsError('EACCES', t('error.invalidPath'))
    await this.call('move', { path: src, dir: await this.hostPath(to.slice(0, -1)) })
  }

  /** Into the other computer's Trash: deleting there from here should be undoable. */
  async remove(item: string[]): Promise<void> {
    await this.call('trash', { paths: [await this.hostPath(item)] })
  }

  async close(): Promise<void> {
    this.client.close()
  }
}

export function connectAfinder(c: RemoteConnection, clientKey: string | undefined): AfinderProvider {
  if (!clientKey) throw new Error(t('remote.error.computerUnpaired'))
  return new AfinderProvider(new HostClient(computerOf(c), keyPairOf(fromB64(clientKey))))
}
