import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import * as Device from 'expo-device'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { parsePairingUri } from '../../../../src/shared/companion/protocol'
import { pair, RemoteError } from '../lib/client'
import { dropClient } from '../lib/hosts'
import { t } from '../lib/i18n'
import { addComputer, loadIdentity } from '../lib/store'
import { useColors } from '../lib/theme'

type Step = { kind: 'scan' } | { kind: 'connecting' } | { kind: 'code'; sas: string } | { kind: 'error'; message: string }

const errorText = (err: unknown): string => {
  const e = err as RemoteError
  if (e.message === 'declined') return t('mobile.pairRefused')
  if (e.reason === 'pairing-closed' || e.message === 'pairing-closed') return t('mobile.pairClosed')
  return t('mobile.error')
}

/** Rebuilds the link when the app was opened by scanning the QR code with the system camera. */
function linkFromParams(params: Record<string, string | string[]>): string | null {
  if (!params.room) return null
  const v = (k: string): string => String(params[k] ?? '')
  return `afinder://pair?v=${v('v')}&relay=${encodeURIComponent(v('relay'))}&room=${v('room')}&key=${v('key')}&code=${v('code')}&name=${encodeURIComponent(v('name'))}`
}

export default function Pair(): React.JSX.Element {
  const c = useColors()
  const params = useLocalSearchParams()
  const [permission, requestPermission] = useCameraPermissions()
  const [step, setStep] = useState<Step>({ kind: 'scan' })
  const busy = useRef(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const start = async (uri: string): Promise<void> => {
    if (busy.current) return
    const link = parsePairingUri(uri)
    if (!link) return setStep({ kind: 'error', message: t('mobile.badLink') })
    busy.current = true
    void Haptics.selectionAsync()
    setStep({ kind: 'connecting' })
    abort.current = new AbortController()
    try {
      const computer = await pair(link, await loadIdentity(), Device.deviceName ?? Device.modelName ?? 'Phone', (sas) => setStep({ kind: 'code', sas }), abort.current.signal)
      dropClient(computer.id)
      await addComputer(computer)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.replace({ pathname: '/browse', params: { computer: computer.id } })
    } catch (err) {
      if ((err as Error).message === 'cancelled') return
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setStep({ kind: 'error', message: errorText(err) })
    } finally {
      busy.current = false
    }
  }

  // Opened from afinder://pair?… (system camera): pair right away.
  const fromLink = linkFromParams(params as Record<string, string>)
  useEffect(() => {
    if (fromLink) void start(fromLink)
  }, [fromLink])

  const paste = async (): Promise<void> => void start(await Clipboard.getStringAsync())

  if (step.kind === 'code' || step.kind === 'connecting') {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        {step.kind === 'code' ? (
          <>
            <Text style={[styles.lead, { color: c.text }]}>{t('mobile.compareCode')}</Text>
            <Text style={[styles.sas, { color: c.text }]}>{step.sas.replace(/(\d{3})(\d{3})/, '$1 $2')}</Text>
            <Text style={[styles.note, { color: c.muted }]}>{t('mobile.waiting')}</Text>
          </>
        ) : null}
        <ActivityIndicator color={c.accent} />
      </View>
    )
  }

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <Text style={[styles.lead, styles.pad, { color: c.text }]}>{t('mobile.scanHint')}</Text>
      <View style={styles.cameraBox}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy.current ? undefined : (r) => void start(r.data)} />
        ) : (
          <View style={[styles.center, { backgroundColor: c.card }]}>
            <Ionicons name="camera-outline" size={44} color={c.muted} />
            {permission && !permission.canAskAgain ? <Text style={[styles.note, { color: c.muted }]}>{t('mobile.cameraDenied')}</Text> : null}
            {permission?.canAskAgain !== false ? (
              <Pressable style={[styles.button, { backgroundColor: c.accent }]} onPress={() => void requestPermission()}>
                <Text style={styles.buttonText}>{t('mobile.allowCamera')}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
      {step.kind === 'error' ? <Text style={[styles.note, styles.pad, { color: c.danger }]}>{step.message}</Text> : null}
      <Pressable style={({ pressed }) => [styles.link, { opacity: pressed ? 0.5 : 1 }]} onPress={() => void paste()}>
        <Ionicons name="clipboard-outline" size={18} color={c.accent} />
        <Text style={[styles.linkText, { color: c.accent }]}>{t('mobile.pasteLink')}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingTop: 16, gap: 16 },
  pad: { paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  lead: { fontSize: 17, textAlign: 'center', lineHeight: 23 },
  sas: { fontSize: 48, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  note: { fontSize: 15, textAlign: 'center' },
  cameraBox: { marginHorizontal: 24, aspectRatio: 1, borderRadius: 20, overflow: 'hidden' },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 },
  linkText: { fontSize: 16 }
})
