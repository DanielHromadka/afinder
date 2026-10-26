import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ensure, fileOf, kept } from '../lib/files'
import { useHost } from '../lib/hosts'
import { t } from '../lib/i18n'
import { saveEdits } from '../lib/open'
import { computerById } from '../lib/store'
import { useColors } from '../lib/theme'

/** A plain text editor for small text and code files: saves into the phone's copy, then to the computer. */
export default function Edit(): React.JSX.Element {
  const c = useColors()
  const p = useLocalSearchParams<{ computer: string; path: string; name: string; size: string; modified: string }>()
  const { client, state } = useHost(computerById(p.computer))
  const [text, setText] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!client || state.kind !== 'ready' || text !== null) return
    ensure(client, { path: p.path, name: p.name, size: Number(p.size), modified: Number(p.modified) })
      .then((file) => file.text())
      .then(setText, (err: Error) => (Alert.alert(t('mobile.error'), err.message), router.back()))
  }, [client, state.kind, text, p.path, p.name, p.size, p.modified])

  const save = async (): Promise<void> => {
    const k = kept(p.computer, p.path)
    if (!k || !client || text === null) return
    setSaving(true)
    try {
      fileOf(k).write(text)
      await saveEdits(client, k)
      setChanged(false)
      router.back()
    } finally {
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: c.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title: p.name,
          headerRight: () =>
            saving ? (
              <ActivityIndicator color={c.accent} />
            ) : (
              <Pressable hitSlop={12} disabled={!changed} onPress={() => void save()}>
                <Text style={[styles.save, { color: c.accent, opacity: changed ? 1 : 0.4 }]}>{t('mobile.save')}</Text>
              </Pressable>
            )
        }}
      />
      {text === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : (
        <TextInput
          style={[styles.input, { color: c.text }]}
          value={text}
          onChangeText={(v) => (setText(v), setChanged(true))}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          scrollEnabled
        />
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, padding: 16, fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  save: { fontSize: 17, fontWeight: '600' }
})
