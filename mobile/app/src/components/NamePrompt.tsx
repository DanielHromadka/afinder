import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '../lib/i18n'
import { useColors } from '../lib/theme'

/** Asks for a name (new folder, rename); Alert.prompt exists only on iOS. */
export function NamePrompt({ title, initial, onSubmit, onClose }: { title: string; initial: string | null; onSubmit(name: string): void; onClose(): void }): React.JSX.Element {
  const c = useColors()
  const [value, setValue] = useState('')
  useEffect(() => setValue(initial ?? ''), [initial])
  const submit = (): void => {
    const name = value.trim()
    if (!name) return
    onClose()
    onSubmit(name)
  }
  return (
    <Modal visible={initial !== null} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.box, { backgroundColor: c.card }]}>
          <Text style={[styles.title, { color: c.text }]}>{title}</Text>
          <TextInput
            style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.bg }]}
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
            placeholder={t('mobile.name')}
            placeholderTextColor={c.muted}
            returnKeyType="done"
            onSubmitEditing={submit}
            autoCorrect={false}
          />
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose}>
              <Text style={[styles.buttonText, { color: c.accent }]}>{t('mobile.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={submit}>
              <Text style={[styles.buttonText, styles.bold, { color: c.accent }]}>{t('mobile.save')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: 'rgba(0,0,0,0.35)' },
  box: { borderRadius: 14, padding: 18, gap: 14 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { paddingVertical: 8, paddingHorizontal: 14 },
  buttonText: { fontSize: 16 },
  bold: { fontWeight: '600' }
})
