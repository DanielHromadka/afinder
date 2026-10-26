// Moving files between the phone and the computer: shared files come from the phone's copy (lib/files),
// uploads from the photo library or Files.

import * as DocumentPicker from 'expo-document-picker'
import { File, FileMode } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import * as Sharing from 'expo-sharing'
import type { RemoteEntry } from '../../../../src/shared/companion/protocol'
import type { HostClient } from './client'
import { ensure, type Progress } from './files'

/** The share sheet (save to Files, AirDrop, another app) for the phone's copy of the file. */
export async function shareEntry(client: HostClient, entry: RemoteEntry, progress: Progress): Promise<void> {
  const file = await ensure(client, entry, progress)
  await Sharing.shareAsync(file.uri, { dialogTitle: entry.name })
}

export interface Picked {
  uri: string
  name: string
  size: number
}

export async function pickPhotos(): Promise<Picked[]> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 1 })
  if (res.canceled) return []
  return res.assets.map((a, i) => {
    const file = new File(a.uri)
    return { uri: a.uri, name: a.fileName ?? `photo-${Date.now()}-${i}.${a.type === 'video' ? 'mp4' : 'jpg'}`, size: a.fileSize ?? file.size ?? 0 }
  })
}

export async function pickFiles(): Promise<Picked[]> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
  if (res.canceled) return []
  return res.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? new File(a.uri).size ?? 0 }))
}

/** Sends one picked file into `dir` on the computer; resolves with where it was saved. */
export async function upload(client: HostClient, dir: string, picked: Picked, progress: Progress): Promise<string> {
  const handle = new File(picked.uri).open(FileMode.ReadOnly)
  try {
    return await client.upload(dir, picked.name, picked.size, async (offset, length) => {
      handle.offset = offset
      return handle.readBytes(length)
    }, progress)
  } finally {
    handle.close()
  }
}
