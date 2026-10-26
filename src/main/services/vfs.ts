// One place that knows which paths are virtual: members of archives (read-only) and items on remote
// connections (SFTP, S3 …). Services ask here instead of checking each kind themselves.

import os from 'node:os'
import * as archives from './archives'
import * as remote from './remote'

export type Location =
  | { kind: 'local'; path: string }
  | { kind: 'archive'; path: string; at: archives.Located }
  | { kind: 'remote'; path: string; at: remote.Located }
  /** The virtual folder holding all remote connections. */
  | { kind: 'mounts'; path: string }

export async function locate(p: string): Promise<Location> {
  const r = remote.locate(p)
  if (r === 'mounts') return { kind: 'mounts', path: p }
  if (r) return { kind: 'remote', path: p, at: r }
  const a = await archives.locate(p)
  return a ? { kind: 'archive', path: p, at: a } : { kind: 'local', path: p }
}

/** Not on the local disk: no watching, size computing, search, git or shell there. */
export async function isVirtual(p: string): Promise<boolean> {
  return (await locate(p)).kind !== 'local'
}

/** A real local file or folder for the path: extracted from an archive or downloaded to the cache. */
export async function realPath(p: string, maxRemoteBytes?: number): Promise<string> {
  const loc = await locate(p)
  if (loc.kind === 'remote') return remote.materialize(loc.at, maxRemoteBytes)
  if (loc.kind === 'archive') return archives.realPath(p)
  return p
}

/** Throws for paths that cannot be changed (inside an archive). */
export async function assertWritable(p: string): Promise<void> {
  const loc = await locate(p)
  if (loc.kind === 'mounts') throw new Error('read-only')
  if (loc.kind === 'archive') await archives.assertWritable(p)
}

/** A folder on the local disk to start a shell in for the path. */
export async function outsideFolder(p: string): Promise<string> {
  const loc = await locate(p)
  if (loc.kind === 'remote' || loc.kind === 'mounts') return os.homedir()
  return archives.outsideFolder(p)
}
