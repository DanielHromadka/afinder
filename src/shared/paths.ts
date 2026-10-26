// Path helpers that work in the renderer (no node:path) for both POSIX paths and the Windows paths
// the main process hands out ("C:\Users\x", "\\server\share\dir"). The style is detected from the
// path itself, so the same code serves macOS, Linux and Windows.

const DRIVE = /^[A-Za-z]:(?:[\\/]|$)/

export function isWindowsPath(p: string): boolean {
  return DRIVE.test(p) || p.startsWith('\\\\')
}

export function separatorOf(p: string): '/' | '\\' {
  return isWindowsPath(p) ? '\\' : '/'
}

/** "/", "C:\" or "\\server\share\" – the part of the path that has no parent. */
export function rootOf(p: string): string {
  if (DRIVE.test(p)) return p.slice(0, 2).toUpperCase() + '\\'
  if (p.startsWith('\\\\')) {
    const parts = p.slice(2).split(/[\\/]/)
    return `\\\\${parts[0] ?? ''}\\${parts[1] ?? ''}\\`
  }
  return '/'
}

const trimEnd = (p: string): string => {
  const root = rootOf(p)
  let out = p
  while (out.length > root.length && /[\\/]$/.test(out)) out = out.slice(0, -1)
  return out.length < root.length ? root : out
}

export function isRoot(p: string): boolean {
  const root = rootOf(p)
  return trimEnd(p).length <= root.length
}

/** Parent folder, or null for a root. */
export function parentOf(p: string): string | null {
  const path = trimEnd(p)
  if (isRoot(path)) return null
  const root = rootOf(path)
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < root.length ? root : path.slice(0, i)
}

/** Folder that contains the item (a root contains itself). */
export function dirOf(p: string): string {
  return parentOf(p) ?? p
}

/** Last path component; a root is returned as is ("/", "C:\"). */
export function baseName(p: string): string {
  const path = trimEnd(p)
  if (isRoot(path)) return path
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

export function joinPath(dir: string, name: string): string {
  const sep = separatorOf(dir)
  return /[\\/]$/.test(dir) ? dir + name : dir + sep + name
}

/** Windows paths compare case-insensitively (NTFS default); POSIX ones exactly. */
export function samePath(a: string, b: string): boolean {
  const x = trimEnd(a)
  const y = trimEnd(b)
  return isWindowsPath(x) ? x.replace(/\//g, '\\').toLowerCase() === y.replace(/\//g, '\\').toLowerCase() : x === y
}

/** A map key under which paths that `samePath` considers equal meet. */
export function pathKey(p: string): string {
  const x = trimEnd(p)
  return isWindowsPath(x) ? x.replace(/\//g, '\\').toLowerCase() : x
}

/** True when `child` is `parent` itself or lies anywhere below it. */
export function isInside(child: string, parent: string): boolean {
  if (samePath(child, parent)) return true
  const p = trimEnd(parent)
  const prefix = /[\\/]$/.test(p) ? p : p + separatorOf(p)
  const c = trimEnd(child)
  return isWindowsPath(c) ? c.toLowerCase().replace(/\//g, '\\').startsWith(prefix.toLowerCase().replace(/\//g, '\\')) : c.startsWith(prefix)
}

/** `path` relative to `root` ("" when equal); `path` itself when it is not inside `root`. */
export function relativeTo(path: string, root: string): string {
  if (samePath(path, root)) return ''
  if (!isInside(path, root)) return path
  const r = trimEnd(root)
  return trimEnd(path).slice(/[\\/]$/.test(r) ? r.length : r.length + 1)
}

/** Folder of the item relative to `root` ("" = directly in `root`). */
export function relativeDir(path: string, root: string): string {
  return relativeTo(dirOf(path), root)
}

/** `root`, then every folder down to `path` (inclusive); [] when `path` is not inside `root`. */
export function ancestors(path: string, root: string): string[] {
  if (!isInside(path, root)) return []
  const out: string[] = []
  for (let cur: string | null = trimEnd(path); cur; cur = parentOf(cur)) {
    out.unshift(cur)
    if (samePath(cur, root)) return out
  }
  return out
}
