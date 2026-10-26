// Copying, moving and archiving.

import type { ArchiveFormat, CompressionLevel } from '../archive'

export type TransferMode = 'copy' | 'move'

/** 'auto' = move within the same volume, copy across volumes (like Finder drag & drop). */
export interface TransferRequest {
  sources: string[]
  dest: string
  mode: TransferMode | 'auto'
}

export interface TransferPlan {
  sources: string[]
  dest: string
  /** What was asked; running the plan plans it again from this. */
  requested: TransferMode | 'auto'
  /** The batch in one word, for the progress dialog: 'move' only when every item moves. */
  mode: TransferMode
  /** Per source: an 'auto' batch decides each item by its own volume or connection. */
  modes: TransferMode[]
  /** Names that already exist in dest and would be overwritten. */
  conflicts: string[]
}

export type ConflictPolicy = 'replace' | 'keepBoth' | 'skip'

export interface TransferProgress {
  mode: TransferMode | 'archive'
  done: number
  total: number
  current: string
}

/** Packs local files and folders into a new archive in `dest`. */
export interface ArchiveRequest {
  sources: string[]
  dest: string
  /** File name; the format's extension is added when missing, a free name is picked when taken. */
  name: string
  format: ArchiveFormat
  level: CompressionLevel
}

export interface FileClipboard {
  paths: string[]
  /** True when the files were cut in aFinder (⌘X) – pasting moves them. */
  cut: boolean
}
