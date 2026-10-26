// Files and folders as main lists them, and what the file views exchange about them.

export const FILE_KINDS = ['folder', 'app', 'image', 'audio', 'video', 'pdf', 'text', 'code', 'archive', 'document', 'other'] as const
export type FileKind = (typeof FILE_KINDS)[number]

export interface FileEntry {
  name: string
  path: string
  /** Directory that can be navigated into (symlinks to directories included, .app bundles excluded). */
  isDir: boolean
  isSymlink: boolean
  hidden: boolean
  kind: FileKind
  /** Logical size in bytes for files; null for directories (computed separately). */
  size: number | null
  /** Last modification time in ms since epoch. */
  modified: number
}

export interface Listing {
  path: string
  parent: string | null
  entries: FileEntry[]
  /** Inside an archive: nothing can be created, renamed, deleted or pasted here. */
  readOnly?: boolean
}

export type SizeState = 'partial' | 'done' | 'denied'

export interface SizeUpdate {
  path: string
  size: number
  state: SizeState
}

export interface Place {
  name: string
  path: string
  icon: 'home' | 'desktop' | 'documents' | 'downloads' | 'apps' | 'disk' | 'volume'
}

/** Mac App Store build: a folder the user let aFinder into, kept across restarts as a security-scoped bookmark. */
export interface DiskGrant {
  path: string
  bookmark: string
}

export type ScreenshotMode = 'region' | 'window' | 'screen'

export interface ScreenshotResult {
  path: string
  /** Only the whole display was captured (Windows, Linux) – the region is still to be cut out. */
  crop: boolean
}

/** The first rows of one spreadsheet sheet, as display strings. */
export interface SheetPreview {
  sheets: string[]
  index: number
  rows: string[][]
  /** More rows or columns exist than were read. */
  truncated: boolean
}

export interface SearchRequest {
  root: string
  query: string
  fuzzy: boolean
  showHidden: boolean
}

export interface SearchBatch {
  id: string
  entries: FileEntry[]
  done: boolean
  /** The result limit was hit – there are more matches. */
  truncated: boolean
}

/** A live view started by tail.start(): a regular file is followed, anything else read as a stream. */
export interface TailInfo {
  id: string
  kind: 'file' | 'stream'
}

/** Bytes for one live view. reset: the file was truncated or replaced, data starts at its beginning. */
export interface TailChunk {
  id: string
  data: Uint8Array
  reset?: boolean
  /** The stream ended (FIFO writer closed, end of a device). */
  ended?: boolean
  error?: string
}
