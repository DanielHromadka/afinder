// Opens a file of the phone the way the system would: Quick Look on iOS (images with zoom, video, audio,
// PDF, Office, text; Markup edits the file in place), an app chosen by Android otherwise.
import { requireNativeModule } from 'expo'

export interface Opened {
  /** Indexes of the files that were changed while open (Markup on iOS, an editing app on Android). */
  edited: number[]
}

interface Native {
  /** Rejects with `unsupported` when nothing on the phone can show the file. */
  open(uris: string[], index: number, editable: boolean, mimeType: string | null): Promise<Opened>
}

const native = requireNativeModule<Native>('AfinderOpen')

export const openFiles = (uris: string[], index: number, editable: boolean, mimeType: string | null = null): Promise<Opened> => native.open(uris, index, editable, mimeType)
