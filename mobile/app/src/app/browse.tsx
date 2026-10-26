import { Ionicons } from '@expo/vector-icons'
import { FlashList } from '@shopify/flash-list'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import type { RemoteEntry } from '../../../../src/shared/companion/protocol'
import { EntryIcon } from '../components/EntryIcon'
import { NamePrompt } from '../components/NamePrompt'
import { Sheet, type SheetAction } from '../components/Sheet'
import { Transfer } from '../components/Transfer'
import type { HostClient } from '../lib/client'
import { useHost } from '../lib/hosts'
import { locale, t } from '../lib/i18n'
import { computerById, useComputers } from '../lib/store'
import { useColors } from '../lib/theme'
import { edited, kept, setPinned, useKept } from '../lib/files'
import { openEntry } from '../lib/open'
import { shareEntry, pickFiles,  pickPhotos, upload, type Picked } from '../lib/transfer'

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
const THUMB_KINDS = new Set(['image', 'video', 'pdf'])
const TEXT_KINDS = new Set(['text', 'code'])
/** Bigger text files are opened read-only in Quick Look; the editor keeps everything in memory. */
export const EDIT_BYTES = 1024 ** 2

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) (n /= 1024), i++
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: i ? 1 : 0 }).format(n)} ${units[i]}`
}

/** Quick Look / Explorer thumbnail from the computer, asked only for rows on screen. */
function Thumb({ client, entry }: { client: HostClient; entry: RemoteEntry }): React.JSX.Element {
  const { data } = useQuery({
    queryKey: ['thumb', client.computer.id, entry.path, entry.modified],
    queryFn: () => client.call('thumbnail', { path: entry.path, size: 128 }),
    enabled: THUMB_KINDS.has(entry.kind),
    staleTime: Infinity
  })
  return data ? <Image source={{ uri: data }} style={styles.thumb} contentFit="cover" /> : <EntryIcon kind={entry.dir ? 'folder' : entry.kind} />
}

/** Offline copy, or edits that have not reached the computer yet. */
function Badge({ computer, entry }: { computer: string; entry: RemoteEntry }): React.JSX.Element | null {
  const c = useColors()
  const k = entry.dir ? undefined : kept(computer, entry.path)
  if (!k) return null
  if (k.conflict || edited(k)) return <Ionicons name="alert-circle" size={18} color={c.danger} accessibilityLabel={t('mobile.unsent')} />
  return k.pinned ? <Ionicons name="arrow-down-circle" size={18} color={c.muted} accessibilityLabel={t('mobile.offlineAvailable')} /> : null
}

type Listed = { kind: 'places'; rows: RemoteEntry[] } | { kind: 'folder'; rows: RemoteEntry[]; readOnly: boolean }

export default function Browse(): React.JSX.Element {
  const c = useColors()
  const queries = useQueryClient()
  const { computer: id, path } = useLocalSearchParams<{ computer: string; path?: string }>()
  useComputers()
  const computer = computerById(id)
  const { client, state } = useHost(computer)
  const ready = state.kind === 'ready' && !!client
  const [showHidden, setShowHidden] = useState(false)
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null)
  const [prompt, setPrompt] = useState<{ title: string; initial: string; submit(name: string): void } | null>(null)
  const [transfer, setTransfer] = useState<{ label: string; done: number; total: number } | null>(null)
  /** The file being fetched for opening; its row shows the progress, nothing blocks the screen. */
  const [opening, setOpening] = useState<{ path: string; done: number; total: number } | null>(null)
  const openCtrl = useRef<AbortController | null>(null)
  useEffect(() => () => openCtrl.current?.abort(), [])
  useKept()

  const key = ['list', id, path ?? '']
  const listing = useQuery<Listed>({
    queryKey: key,
    enabled: ready,
    queryFn: async () => {
      if (!path) {
        const places = await client!.call('places', {})
        return { kind: 'places', rows: places.map((p) => ({ name: p.name, path: p.path, dir: true, hidden: false, size: null, modified: 0, kind: p.icon })) }
      }
      const l = await client!.call('list', { path })
      const rows = [...l.entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, locale(), { numeric: true, sensitivity: 'base' }))
      return { kind: 'folder', rows, readOnly: l.readOnly }
    }
  })
  const refresh = (): Promise<unknown> => queries.invalidateQueries({ queryKey: key })
  const info = state.kind === 'ready' ? state.info : null
  const canWrite = !!info?.write && listing.data?.kind === 'folder' && !listing.data.readOnly
  const rows = (listing.data?.rows ?? []).filter((e) => showHidden || !e.hidden)

  const fail = (err: unknown): void => Alert.alert(t('mobile.error'), (err as Error).message)
  const run = (work: () => Promise<unknown>): void => void work().then(refresh, fail)

  const share = (entry: RemoteEntry): void => {
    setTransfer({ label: t('mobile.downloading', { n: 0 }), done: 0, total: entry.size ?? 0 })
    void shareEntry(client!, entry, (done, total) => setTransfer({ label: `${entry.name} · ${t('mobile.downloading', { n: total ? Math.floor((done / total) * 100) : 0 })}`, done, total }))
      .catch(fail)
      .finally(() => setTransfer(null))
  }

  const send = async (picked: Picked[]): Promise<void> => {
    for (const p of picked) {
      await upload(client!, path!, p, (done, total) => setTransfer({ label: `${p.name} · ${t('mobile.uploading', { n: total ? Math.floor((done / total) * 100) : 100 })}`, done, total }))
    }
  }
  const uploadFrom = (pick: () => Promise<Picked[]>): void =>
    void pick()
      .then(send)
      .then(refresh, fail)
      .finally(() => setTransfer(null))

  const open = (entry: RemoteEntry): void => {
    if (entry.dir) return router.push({ pathname: '/browse', params: { computer: id, path: entry.path } })
    // A second tap on the same file cancels; a tap on another file switches to it.
    const same = opening?.path === entry.path
    openCtrl.current?.abort()
    openCtrl.current = null
    setOpening(null)
    if (same) return
    const ctrl = new AbortController()
    openCtrl.current = ctrl
    setOpening({ path: entry.path, done: 0, total: entry.size ?? 0 })
    void openEntry(client!, entry, listing.data?.rows ?? [], canWrite, (done, total) => !ctrl.signal.aborted && setOpening({ path: entry.path, done, total }), ctrl.signal)
      .catch((err) => !ctrl.signal.aborted && fail(err))
      .finally(() => {
        if (openCtrl.current === ctrl) (openCtrl.current = null), setOpening(null)
        // Edits may have reached the computer: show the new size and time.
        void refresh()
      })
  }

  const fileMenu = (entry: RemoteEntry): void => {
    const k = kept(id, entry.path)
    const actions: SheetAction[] = [{ label: t('mobile.openIn'), onPress: () => share(entry) }]
    actions.push(
      k?.pinned
        ? { label: t('mobile.offlineRemove'), onPress: () => run(() => setPinned(client!, entry, false)) }
        : { label: t('mobile.offlineMake'), onPress: () => pin(entry) }
    )
    if (canWrite && TEXT_KINDS.has(entry.kind) && (entry.size ?? 0) <= EDIT_BYTES && !entry.name.toLowerCase().endsWith('.rtf')) {
      actions.push({ label: t('mobile.editText'), onPress: () => router.push({ pathname: '/edit', params: { computer: id, path: entry.path, name: entry.name, size: String(entry.size ?? 0), modified: String(entry.modified) } }) })
    }
    if (canWrite) {
      actions.push({ label: t('mobile.rename'), onPress: () => setPrompt({ title: t('mobile.rename'), initial: entry.name, submit: (name) => run(() => client!.call('rename', { path: entry.path, name })) }) })
      actions.push({ label: t('mobile.trash'), destructive: true, onPress: () => confirmTrash(entry) })
    }
    setSheet({ title: entry.name, actions })
  }
  const pin = (entry: RemoteEntry): void => {
    setTransfer({ label: entry.name, done: 0, total: entry.size ?? 0 })
    void setPinned(client!, entry, true, (done, total) => setTransfer({ label: `${entry.name} · ${t('mobile.downloading', { n: total ? Math.floor((done / total) * 100) : 100 })}`, done, total }))
      .catch(fail)
      .finally(() => setTransfer(null))
  }

  const more = (entry: RemoteEntry): void => {
    if (!entry.dir) return fileMenu(entry)
    if (!canWrite) return open(entry)
    setSheet({
      title: entry.name,
      actions: [
        { label: t('mobile.rename'), onPress: () => setPrompt({ title: t('mobile.rename'), initial: entry.name, submit: (name) => run(() => client!.call('rename', { path: entry.path, name })) }) },
        { label: t('mobile.trash'), destructive: true, onPress: () => confirmTrash(entry) }
      ]
    })
  }
  const confirmTrash = (entry: RemoteEntry): void =>
    Alert.alert(t('mobile.trash'), t('mobile.trashConfirm', { name: entry.name }), [
      { text: t('mobile.cancel'), style: 'cancel' },
      { text: t('mobile.trash'), style: 'destructive', onPress: () => run(() => client!.call('trash', { paths: [entry.path] })) }
    ])

  const menu = (): void => {
    const actions: SheetAction[] = []
    if (canWrite) {
      actions.push({ label: t('mobile.uploadPhoto'), onPress: () => uploadFrom(pickPhotos) })
      actions.push({ label: t('mobile.uploadFile'), onPress: () => uploadFrom(pickFiles) })
      actions.push({ label: t('mobile.newFolder'), onPress: () => setPrompt({ title: t('mobile.newFolder'), initial: '', submit: (name) => run(() => client!.call('mkdir', { parent: path!, name })) }) })
    }
    actions.push({ label: showHidden ? t('mobile.hideHidden') : t('mobile.showHidden'), onPress: () => setShowHidden((v) => !v) })
    // Always offered: without the permission the computer answers with how to turn it on.
    actions.unshift({ label: t('mobile.viewScreen'), onPress: () => router.push({ pathname: '/screen', params: { computer: id } }) })
    setSheet({ actions })
  }

  const title = path ? baseName(path) : (info?.name ?? computer?.name ?? '')
  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: () =>
          ready ? (
            <Pressable hitSlop={12} onPress={menu} accessibilityLabel="…">
              <Ionicons name="ellipsis-horizontal-circle" size={26} color={c.accent} />
            </Pressable>
          ) : null
      }}
    />
  )

  if (!ready) {
    const text = state.kind === 'offline' ? t('mobile.hostOffline') : state.kind === 'refused' ? t('mobile.unknownDevice') : t('mobile.connecting')
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        {header}
        {state.kind === 'connecting' ? <ActivityIndicator color={c.accent} /> : <Ionicons name={state.kind === 'refused' ? 'lock-closed-outline' : 'cloud-offline-outline'} size={48} color={c.muted} />}
        <Text style={[styles.message, { color: c.muted }]}>{text}</Text>
        {state.kind === 'offline' ? (
          <Pressable onPress={() => client?.wake()}>
            <Text style={[styles.retry, { color: c.accent }]}>{t('mobile.retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      {header}
      {listing.error ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: c.danger }]}>{(listing.error as Error).message}</Text>
          <Pressable onPress={() => void listing.refetch()}>
            <Text style={[styles.retry, { color: c.accent }]}>{t('mobile.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(e) => e.path}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={listing.isRefetching} onRefresh={() => void listing.refetch()} />}
          ListHeaderComponent={
            listing.data?.kind === 'places' ? (
              <View>
                {/* The computer itself, above its places; the terminal will be the next row here. */}
                <Text style={[styles.section, { color: c.muted }]}>{t('mobile.computer')}</Text>
                <Pressable style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.line : c.bg }]} onPress={() => router.push({ pathname: '/screen', params: { computer: id } })}>
                  <View style={styles.icon}>
                    <Ionicons name="tv-outline" size={28} color={c.accent} />
                  </View>
                  <View style={[styles.text, { borderColor: c.line }]}>
                    <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{t('mobile.screen')}</Text>
                    <Text style={[styles.sub, { color: c.muted }]} numberOfLines={1}>{t('mobile.screenSub')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.muted} />
                </Pressable>
                <Text style={[styles.section, styles.sectionGap, { color: c.muted }]}>{t('mobile.places')}</Text>
              </View>
            ) :listing.data?.kind === 'folder' && listing.data.readOnly ? (
              <Text style={[styles.section, { color: c.muted }]}>{t('mobile.readOnly')}</Text>
            ) : null
          }
          ListEmptyComponent={listing.isLoading ? <ActivityIndicator style={styles.loading} color={c.accent} /> : <Text style={[styles.message, styles.loading, { color: c.muted }]}>{t('mobile.empty')}</Text>}
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.line : c.bg }]} onPress={() => open(item)} onLongPress={() => more(item)}>
              <View style={styles.icon}>{listing.data?.kind === 'places' ? <EntryIcon kind={item.kind} /> : <Thumb client={client!} entry={item} />}</View>
              <View style={[styles.text, { borderColor: c.line }]}>
                <Text style={[styles.name, { color: c.text, opacity: item.hidden ? 0.55 : 1 }]} numberOfLines={1}>{item.name}</Text>
                {listing.data?.kind === 'folder' ? (
                  <Text style={[styles.sub, { color: c.muted }]} numberOfLines={1}>
                    {[item.size !== null && !item.dir ? formatSize(item.size) : null, item.modified ? new Date(item.modified).toLocaleDateString(locale()) : null].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <Badge computer={id} entry={item} />
              {item.dir ? <Ionicons name="chevron-forward" size={18} color={c.muted} /> : null}
              {opening?.path === item.path ? (
                <View style={[styles.rowTrack, { backgroundColor: c.line }]}>
                  <View style={[styles.rowBar, { backgroundColor: c.accent, width: `${opening.total ? Math.min(100, (opening.done / opening.total) * 100) : 5}%` }]} />
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}
      <Sheet title={sheet?.title} actions={sheet?.actions ?? null} onClose={() => setSheet(null)} />
      <NamePrompt title={prompt?.title ?? ''} initial={prompt ? prompt.initial : null} onSubmit={(name) => prompt?.submit(name)} onClose={() => setPrompt(null)} />
      {transfer ? <Transfer label={transfer.label} done={transfer.done} total={transfer.total} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  message: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  retry: { fontSize: 16, fontWeight: '600', padding: 8 },
  loading: { marginTop: 48 },
  section: { fontSize: 13, textTransform: 'uppercase', marginLeft: 20, marginTop: 8, marginBottom: 4 },
  sectionGap: { marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 14, minHeight: 60, gap: 12 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 40, height: 40, borderRadius: 6 },
  text: { flex: 1, justifyContent: 'center', alignSelf: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  name: { fontSize: 16 },
  sub: { fontSize: 13 },
  rowTrack: { position: 'absolute', left: 68, right: 14, bottom: 0, height: 2 },
  rowBar: { height: 2 }
})
