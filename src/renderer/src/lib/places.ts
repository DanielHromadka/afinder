import { getOs, t, tos } from '@shared/i18n'
import { baseName, isRoot, rootOf, samePath } from '@shared/paths'
import { isRemoteRoot, remoteMountOf } from './remotes'

/** Display name of a folder: its last component, or a friendly name for a root. */
export function folderLabel(path: string): string {
  const mount = remoteMountOf(path)
  if (mount && samePath(mount.path, path)) return mount.connection.name
  if (isRemoteRoot(path)) return t('tasks.remote')
  if (!isRoot(path)) return baseName(path)
  if (path.startsWith('\\\\')) return path // UNC share
  if (getOs() === 'win') return rootOf(path).slice(0, 2) // "C:"
  return tos('root')
}

/** Label for the tree / places entry of a root ("Macintosh HD", "Local Disk (C:)", "File System"). */
export function rootLabel(path: string): string {
  return getOs() === 'win' && !path.startsWith('\\\\') ? t('place.drive', { drive: rootOf(path).slice(0, 2) }) : folderLabel(path)
}
