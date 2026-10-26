import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '../lib/theme'

/** A floating progress card at the bottom while a file goes to or from the computer. */
export function Transfer({ label, done, total }: { label: string; done: number; total: number }): React.JSX.Element {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  return (
    <View style={[styles.card, { backgroundColor: c.card, bottom: insets.bottom + 12 }]} pointerEvents="none">
      <Text style={[styles.label, { color: c.text }]} numberOfLines={1}>{label}</Text>
      <View style={[styles.track, { backgroundColor: c.line }]}>
        <View style={[styles.bar, { backgroundColor: c.accent, width: `${ratio * 100}%` }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 16, right: 16, borderRadius: 14, padding: 14, gap: 10, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  label: { fontSize: 15 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4 }
})
