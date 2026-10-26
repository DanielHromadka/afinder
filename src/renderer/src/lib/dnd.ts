// Drop-target wiring shared by the file list and the folder tree. Drags are native file drags
// (from aFinder itself via webContents.startDrag, or from Finder and other apps).

/**
 * Paths being dragged out of aFinder (any tab or pane of this window) – used to refuse dropping a
 * folder onto itself or back into the folder it came from.
 */
export const dragging: { paths: string[] } = { paths: [] }

export interface DropTargetOptions {
  /** Folder the drop would go into, or null when the pointer is not over a valid target. */
  destFor(e: React.DragEvent): string | null
  onTarget(dest: string | null): void
  onDrop(files: File[], dest: string, copy: boolean): void
}

const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

/** ⌥ forces copy; otherwise the main process decides (move on the same volume, copy across). */
function applyDropEffect(e: React.DragEvent): void {
  const wanted = e.altKey ? 'copy' : 'move'
  const allowed = e.dataTransfer.effectAllowed
  if (allowed === 'all' || allowed === 'uninitialized' || allowed.toLowerCase().includes(wanted)) {
    e.dataTransfer.dropEffect = wanted
  }
}

export function dropTargetProps(o: DropTargetOptions): Pick<
  React.HTMLAttributes<HTMLElement>,
  'onDragOver' | 'onDragLeave' | 'onDrop'
> {
  return {
    onDragOver: (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      const dest = o.destFor(e)
      if (dest) applyDropEffect(e)
      else e.dataTransfer.dropEffect = 'none'
      o.onTarget(dest)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) o.onTarget(null)
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      o.onTarget(null)
      const dest = o.destFor(e)
      if (dest) o.onDrop([...e.dataTransfer.files], dest, e.altKey)
    }
  }
}
