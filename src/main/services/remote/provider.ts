// The contract every remote storage backend implements (SFTP, S3; SharePoint / OneDrive via Microsoft
// Graph or WebDAV would be further implementations). Items are addressed by their path segments below
// the connection's root folder; the mount manager (./index.ts) turns them into aFinder paths, caches
// downloads and does the recursive work, so a backend only needs these single-item operations.

export interface RemoteItem {
  name: string
  isDir: boolean
  /** Bytes for files; 0 for folders. */
  size: number
  /** Last modification in ms since epoch (0 = unknown, e.g. S3 "folders"). */
  modified: number
}

export interface RemoteProvider {
  /** Children of a folder ([] = the root). Rejects with code ENOENT / ENOTDIR like fs.readdir. */
  list(dir: string[]): Promise<RemoteItem[]>
  /** The item, or null when it does not exist. */
  stat(item: string[]): Promise<RemoteItem | null>
  /** Writes the file's content to a local file (which the caller then renames into place). */
  download(file: string[], localTarget: string): Promise<void>
  /** Creates or overwrites the remote file with the content of a local file. */
  upload(localSource: string, file: string[]): Promise<void>
  /** Creates one folder (its parent exists). */
  mkdir(dir: string[]): Promise<void>
  /** Renames or moves a file or folder within this connection. */
  rename(from: string[], to: string[]): Promise<void>
  /** Deletes permanently – remote storage has no Trash. Folders are deleted with their content. */
  remove(item: string[], isDir: boolean): Promise<void>
  close(): Promise<void>
}

/** Errors with the codes describeError() in ipc.ts already understands. */
export function fsError(code: 'ENOENT' | 'ENOTDIR' | 'EEXIST' | 'EACCES', message: string, path?: string): Error {
  return Object.assign(new Error(message), { code, path })
}
