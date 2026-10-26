// Opening a file of the computer with one tap: make sure the phone has a current copy, show it the
// system's way, and send any edits back. Swiping in Quick Look covers the neighbouring images that are
// already on the phone; the next ones are fetched quietly so they are there for the next tap.

import { openFiles } from '../../modules/afinder-open'
import * as Sharing from 'expo-sharing'
import { Alert } from 'react-native'
import { CONFLICT, type RemoteEntry } from '../../../../src/shared/companion/protocol'
import type { HostClient } from './client'
import { discard, edited, ensure, fileOf, kept, ready, sendAsCopy, sendBack, type Kept, type Progress } from './files'
import { t } from './i18n'

/** Neighbours fetched ahead after an image is opened, and how big they may be. */
const AHEAD = 2
const AHEAD_BYTES = 25 * 1024 ** 2
const SWIPE_KINDS = new Set(['image', 'video'])

const MIME: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf' }
const mimeOf = (name: string): string | null => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? null

export async function openEntry(client: HostClient, entry: RemoteEntry, folder: RemoteEntry[], canWrite: boolean, progress: Progress, signal: AbortSignal): Promise<void> {
  const file = await ensure(client, entry, progress, signal)
  if (signal.aborted) return
  const computer = client.computer.id
  // Images and videos next to it that are on the phone already can be swiped to.
  const swipe = SWIPE_KINDS.has(entry.kind) ? folder.filter((e) => !e.dir && SWIPE_KINDS.has(e.kind)) : [entry]
  const items = swipe.flatMap((e) => {
    const f = e.path === entry.path ? file : ready(computer, e)
    return f ? [{ entry: e, uri: f.uri }] : []
  })
  const at = items.findIndex((i) => i.entry.path === entry.path)
  if (SWIPE_KINDS.has(entry.kind)) void fetchAhead(client, swipe, swipe.findIndex((e) => e.path === entry.path))
  try {
    await openFiles(items.map((i) => i.uri), at, canWrite, mimeOf(entry.name))
  } catch {
    // Nothing on the phone shows this type: hand it to another app.
    await Sharing.shareAsync(file.uri, { dialogTitle: entry.name })
  }
  // Android does not say what changed, Quick Look only reports Markup: compare the copies instead.
  for (const i of items) {
    const k = kept(computer, i.entry.path)
    if (k && edited(k) && canWrite) await saveEdits(client, k)
  }
}

/**
 * Opens an offline copy without asking the computer. Edits go back right away when it is reachable and
 * allows changes, otherwise with the next sync (lib/files `sync`).
 */
export async function openKept(k: Kept, client: HostClient | undefined): Promise<void> {
  const file = fileOf(k)
  const write = client?.state.kind === 'ready' ? client.state.info.write : true
  try {
    await openFiles([file.uri], 0, write, mimeOf(k.name))
  } catch {
    await Sharing.shareAsync(file.uri, { dialogTitle: k.name })
  }
  if (edited(k) && client?.state.kind === 'ready' && client.state.info.write) await saveEdits(client, k)
}

async function fetchAhead(client: HostClient, list: RemoteEntry[], at: number): Promise<void> {
  const next = [...list.slice(at + 1, at + 1 + AHEAD), ...list.slice(Math.max(0, at - AHEAD), at)]
  for (const e of next) if ((e.size ?? 0) <= AHEAD_BYTES && !ready(client.computer.id, e)) await ensure(client, e).catch(() => {})
}

/** Sends edits back; when the computer's file changed meanwhile, the user decides. */
export async function saveEdits(client: HostClient, k: Kept, progress?: Progress): Promise<void> {
  try {
    await sendBack(client, k, false, progress)
  } catch (err) {
    if ((err as Error).message !== CONFLICT) {
      Alert.alert(t('mobile.saveFailed'), (err as Error).message)
      return
    }
    await new Promise<void>((resolve) =>
      Alert.alert(t('mobile.conflictTitle'), t('mobile.conflictText', { name: k.name }), [
        { text: t('mobile.keepBoth'), onPress: () => void sendAsCopy(client, k).catch(failed).finally(resolve) },
        { text: t('mobile.overwrite'), style: 'destructive', onPress: () => void sendBack(client, k, true).catch(failed).finally(resolve) },
        { text: t('mobile.discardMine'), style: 'cancel', onPress: () => (discard(k), resolve()) }
      ])
    )
  }
}

const failed = (err: unknown): void => Alert.alert(t('mobile.saveFailed'), (err as Error).message)
