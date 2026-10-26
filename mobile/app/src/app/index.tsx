import { Ionicons } from '@expo/vector-icons'
import { router, Stack } from 'expo-router'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { EntryIcon } from '../components/EntryIcon'
import type { Computer } from '../lib/client'
import { edited, setPinned, useKept, type Kept } from '../lib/files'
import { dropClient, useHost } from '../lib/hosts'
import { openKept } from '../lib/open'
import { t } from '../lib/i18n'
import { computerById, removeComputer, useComputers } from '../lib/store'
import { useColors } from '../lib/theme'

function ComputerRow({ computer }: { computer: Computer }): React.JSX.Element {
  const c = useColors()
  const { state } = useHost(computer)
  const status = state.kind === 'ready' ? t('mobile.online') : state.kind === 'connecting' ? t('mobile.connecting') : state.kind === 'refused' ? t('mobile.unknownDevice') : t('mobile.offline')
  const remove = (): void =>
    Alert.alert(t('mobile.remove'), t('mobile.removeConfirm', { name: computer.name }), [
      { text: t('mobile.cancel'), style: 'cancel' },
      {
        text: t('mobile.remove'),
        style: 'destructive',
        onPress: () => {
          dropClient(computer.id)
          void removeComputer(computer.id)
        }
      }
    ])
  return (
    <Pressable
      style={({ pressed }) => [styles.card, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/browse', params: { computer: computer.id } })}
      onLongPress={remove}
    >
      <Ionicons name="desktop-outline" size={30} color={c.accent} />
      <View style={styles.text}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{computer.name}</Text>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: state.kind === 'ready' ? c.ok : state.kind === 'refused' ? c.danger : c.muted }]} />
          <Text style={[styles.sub, { color: c.muted }]}>{status}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={c.muted} />
    </Pressable>
  )
}

const KIND_BY_EXT: Record<string, string> = { jpg: 'image', jpeg: 'image', png: 'image', heic: 'image', gif: 'image', mp4: 'video', mov: 'video', mp3: 'audio', m4a: 'audio', pdf: 'pdf', txt: 'text', md: 'text' }

/** A file kept on the phone; opens without the computer, long press offers to stop keeping it. */
function OfflineRow({ item }: { item: Kept }): React.JSX.Element {
  const c = useColors()
  const computer = computerById(item.computer)
  const { client } = useHost(computer)
  const unsent = edited(item) || item.conflict
  const forget = (): void =>
    Alert.alert(item.name, undefined, [
      { text: t('mobile.cancel'), style: 'cancel' },
      { text: t('mobile.offlineRemove'), onPress: () => client && void setPinned(client, { path: item.path, name: item.name, size: item.remote.size, modified: item.remote.modified }, false) }
    ])
  return (
    <Pressable style={({ pressed }) => [styles.card, styles.fileCard, { backgroundColor: c.card, opacity: pressed ? 0.6 : 1 }]} onPress={() => void openKept(item, client)} onLongPress={forget}>
      <EntryIcon kind={KIND_BY_EXT[item.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'file'} />
      <View style={styles.text}>
        <Text style={[styles.fileName, { color: c.text }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.sub, { color: unsent ? c.danger : c.muted }]} numberOfLines={1}>{unsent ? t('mobile.unsent') : (computer?.name ?? '')}</Text>
      </View>
    </Pressable>
  )
}

export default function Computers(): React.JSX.Element {
  const c = useColors()
  const { computers, loaded } = useComputers()
  const offline = useKept().filter((k) => k.pinned)
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable hitSlop={12} onPress={() => router.push('/pair')} accessibilityLabel={t('mobile.pairComputer')}>
              <Ionicons name="add-circle-outline" size={26} color={c.accent} />
            </Pressable>
          )
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        data={computers}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) => <ComputerRow computer={item} />}
        ListHeaderComponent={computers.length ? <Text style={[styles.section, { color: c.muted }]}>{t('mobile.computers')}</Text> : null}
        ListFooterComponent={
          offline.length ? (
            <View style={styles.offline}>
              <Text style={[styles.section, { color: c.muted }]}>{t('mobile.offlineFiles')}</Text>
              {offline.map((k) => (
                <OfflineRow key={`${k.computer}\n${k.path}`} item={k} />
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Ionicons name="phone-portrait-outline" size={56} color={c.muted} />
              <Text style={[styles.emptyText, { color: c.muted }]}>{t('mobile.noComputers')}</Text>
              <Pressable style={({ pressed }) => [styles.button, { backgroundColor: c.accent, opacity: pressed ? 0.7 : 1 }]} onPress={() => router.push('/pair')}>
                <Text style={styles.buttonText}>{t('mobile.pairComputer')}</Text>
              </Pressable>
            </View>
          ) : null
        }
      />
    </>
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  section: { fontSize: 13, textTransform: 'uppercase', marginLeft: 4, marginBottom: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14 },
  text: { flex: 1, gap: 4 },
  name: { fontSize: 17, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sub: { fontSize: 14 },
  offline: { gap: 10, marginTop: 18 },
  fileCard: { paddingVertical: 12 },
  fileName: { fontSize: 16 },
  empty: { alignItems: 'center', gap: 16, paddingTop: 80, paddingHorizontal: 24 },
  emptyText: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' }
})
