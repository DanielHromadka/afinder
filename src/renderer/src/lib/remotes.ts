// The remote connections known to this window, as module state (like the language): path helpers
// such as folderLabel() and the address bar read it without threading props everywhere. App sets it
// before rendering whenever the list changes.

import { dirOf, samePath } from '@shared/paths'
import { mountOf, type RemoteMount } from '@shared/remote'

let current: RemoteMount[] = []

export function setRemoteMounts(mounts: RemoteMount[]): void {
  current = mounts
}

export function remoteMounts(): RemoteMount[] {
  return current
}

export function remoteMountOf(path: string): RemoteMount | null {
  return mountOf(path, current)
}

/** The virtual folder holding all mounts ("…/Remote"), or null while there are none. */
export function remoteRoot(): string | null {
  return current.length ? dirOf(current[0].path) : null
}

export function isRemoteRoot(path: string): boolean {
  const root = remoteRoot()
  return root !== null && samePath(path, root)
}
