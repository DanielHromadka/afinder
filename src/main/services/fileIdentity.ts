// Whether two paths name the same item on disk. Renames need this rather than comparing path text: on a
// case-insensitive disk "Foto.txt" finds "foto.txt" itself, while on a case-sensitive one (Linux, case-sensitive
// APFS) it is another file that a rename would overwrite.

import { promises as fs, realpath } from 'node:fs'
import { promisify } from 'node:util'

/** The OS's own realpath: on case-insensitive disks it also gives the name's stored case. */
const realpathNative = promisify(realpath.native)

export interface Identity {
  dev: bigint
  ino: bigint
  /** The canonical path, for file systems without stable inode numbers (FAT, exFAT, some network shares). */
  real: string
}

/** The item's identity, or null when nothing is there. Symlinks are the links themselves, not their targets. */
export async function identity(p: string): Promise<Identity | null> {
  const st = await fs.lstat(p, { bigint: true }).catch(() => null)
  if (!st) return null
  // realpath of a link would follow it to its target, so a link keeps its own path.
  const real = st.isSymbolicLink() ? null : await realpathNative(p).catch(() => null)
  return { dev: st.dev, ino: st.ino, real: real ?? p }
}

export function sameIdentity(a: Identity, b: Identity): boolean {
  if (a.dev !== b.dev) return false
  // Inode 0 means the file system does not give one; then only the canonical path can tell.
  return a.ino !== 0n && b.ino !== 0n ? a.ino === b.ino : a.real === b.real
}

/** True when `to` exists and is not `from` itself (so renaming onto it would replace another item). */
export async function takenByAnother(from: string, to: string): Promise<boolean> {
  const target = await identity(to)
  if (!target) return false
  const source = await identity(from)
  return !source || !sameIdentity(source, target)
}
