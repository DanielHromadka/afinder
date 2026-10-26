// How "auto" transfers decide, per item, like Finder: move within one volume (or one connection), copy
// everywhere else. Each item decides on its own, so a batch from several disks never moves (and deletes
// the original of) an item that Finder would only copy.

import type { TransferMode } from '@shared/types'

export interface TransferEnd {
  /** The remote connection the item lives on, or null when it is local. */
  connection: string | null
  /** The local volume (stat's dev), or null when remote. */
  dev: number | null
}

export function autoMode(src: TransferEnd, dest: TransferEnd): TransferMode {
  if (src.connection || dest.connection) return src.connection !== null && src.connection === dest.connection ? 'move' : 'copy'
  return src.dev !== null && src.dev === dest.dev ? 'move' : 'copy'
}

/** One word for a batch in the progress dialog: "moving" only when every item moves. */
export const batchMode = (modes: TransferMode[]): TransferMode => (modes.length > 0 && modes.every((m) => m === 'move') ? 'move' : 'copy')
