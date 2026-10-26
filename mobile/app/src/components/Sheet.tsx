import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '../lib/i18n'
import { useColors } from '../lib/theme'

export interface SheetAction {
  label: string
  destructive?: boolean
  onPress(): void
}

/** A bottom action sheet that looks the same on iOS and Android. */
export function Sheet({ title, actions, onClose }: { title?: string; actions: SheetAction[] | null; onClose(): void }): React.JSX.Element {
  const c = useColors()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={!!actions} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.panel, { paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.group, { backgroundColor: c.card }]}>
            {title ? <Text style={[styles.title, { color: c.muted, borderColor: c.line }]} numberOfLines={2}>{title}</Text> : null}
            {actions?.map((a, i) => (
              <Pressable
                key={a.label}
                style={({ pressed }) => [styles.item, { borderColor: c.line, borderTopWidth: i || title ? StyleSheet.hairlineWidth : 0, opacity: pressed ? 0.5 : 1 }]}
                onPress={() => (onClose(), a.onPress())}
              >
                <Text style={[styles.label, { color: a.destructive ? c.danger : c.accent }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={({ pressed }) => [styles.group, styles.item, { backgroundColor: c.card, opacity: pressed ? 0.5 : 1 }]} onPress={onClose}>
            <Text style={[styles.label, styles.cancel, { color: c.accent }]}>{t('mobile.cancel')}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: { paddingHorizontal: 10, gap: 8 },
  group: { borderRadius: 14, overflow: 'hidden' },
  title: { textAlign: 'center', fontSize: 13, paddingVertical: 12, paddingHorizontal: 16 },
  item: { paddingVertical: 16, alignItems: 'center' },
  label: { fontSize: 18 },
  cancel: { fontWeight: '600' }
})
