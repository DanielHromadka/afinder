import { Ionicons } from '@expo/vector-icons'
import { useKeepAwake } from 'expo-keep-awake'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, AppState, PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native'
import { RTCView } from 'react-native-webrtc'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ScreenDisplay } from '../../../../src/shared/companion/protocol'
import { useHost } from '../lib/hosts'
import { t } from '../lib/i18n'
import { ScreenViewer, type ViewerState } from '../lib/screen'
import { computerById } from '../lib/store'

/** No touch for this long ends the session, so a forgotten phone does not keep watching. */
const IDLE_MS = 30 * 60_000

const MAX_ZOOM = 6
/** A double tap on the whole screen zooms this far into where it was tapped. */
const TAP_ZOOM = 2.5

type Point = { x: number; y: number }
/** The touches' midpoint and spread; one finger has no spread. */
function touchesOf(e: GestureResponderEvent): { mid: Point; dist: number; count: number } {
  const t = e.nativeEvent.touches
  if (t.length < 2) return { mid: { x: t[0]?.pageX ?? 0, y: t[0]?.pageY ?? 0 }, dist: 0, count: t.length }
  const [a, b] = t
  return { mid: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }, dist: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), count: t.length }
}

/** Pinch zooms into the point between the fingers, one or two fingers pan, and a double tap zooms into the
 * tapped point (or back to the whole screen). The picture never leaves the edges. */
function useZoom(onTouch: () => void): { style: object; handlers: object; onLayout: (e: LayoutChangeEvent) => void } {
  const scale = useRef(new Animated.Value(1)).current
  const x = useRef(new Animated.Value(0)).current
  const y = useRef(new Animated.Value(0)).current
  const g = useRef({ s: 1, x: 0, y: 0, w: 1, h: 1, s0: 1, x0: 0, y0: 0, mid0: { x: 0, y: 0 }, dist0: 0, count: 0, lastTap: 0, moved: false }).current
  /** Keeps the scaled picture covering the view (the transform scales around the centre). */
  const set = (s: number, tx: number, ty: number): void => {
    g.s = Math.min(MAX_ZOOM, Math.max(1, s))
    const mx = ((g.s - 1) * g.w) / 2
    const my = ((g.s - 1) * g.h) / 2
    g.x = Math.min(mx, Math.max(-mx, tx))
    g.y = Math.min(my, Math.max(-my, ty))
    scale.setValue(g.s)
    x.setValue(g.x)
    y.setValue(g.y)
  }
  /** Starts a gesture segment, again whenever a finger is added or lifted. */
  const begin = (e: GestureResponderEvent): void => {
    const { mid, dist, count } = touchesOf(e)
    Object.assign(g, { s0: g.s, x0: g.x, y0: g.y, mid0: mid, dist0: dist, count })
  }
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        onTouch()
        g.moved = false
        begin(e)
      },
      onPanResponderMove: (e) => {
        const { mid, dist, count } = touchesOf(e)
        if (count !== g.count) return begin(e)
        if (Math.hypot(mid.x - g.mid0.x, mid.y - g.mid0.y) > 8 || (dist && Math.abs(dist - g.dist0) > 8)) g.moved = true
        const s = dist && g.dist0 ? (g.s0 * dist) / g.dist0 : g.s0
        // The picture point that was under the fingers stays under them: p = c + t + s·(q − c).
        const k = Math.min(MAX_ZOOM, Math.max(1, s)) / g.s0
        set(s, mid.x - g.w / 2 - k * (g.mid0.x - g.w / 2 - g.x0), mid.y - g.h / 2 - k * (g.mid0.y - g.h / 2 - g.y0))
      },
      onPanResponderRelease: (e) => {
        if (g.moved || e.nativeEvent.changedTouches.length > 1) return
        const now = Date.now()
        if (now - g.lastTap > 300) return void (g.lastTap = now)
        g.lastTap = 0
        const { pageX, pageY } = e.nativeEvent
        if (g.s > 1) set(1, 0, 0)
        else set(TAP_ZOOM, -(TAP_ZOOM - 1) * (pageX - g.w / 2), -(TAP_ZOOM - 1) * (pageY - g.h / 2))
      }
    })
  ).current
  const onLayout = (e: LayoutChangeEvent): void => {
    g.w = e.nativeEvent.layout.width
    g.h = e.nativeEvent.layout.height
    set(g.s, g.x, g.y)
  }
  return { style: { transform: [{ translateX: x }, { translateY: y }, { scale }] }, handlers: responder.panHandlers, onLayout }
}

/** m:ss left of the time through the TURN server. */
function useCountdown(until?: number): string | null {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  if (!until) return null
  const left = Math.max(0, Math.round((until - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

export default function Screen(): React.JSX.Element {
  useKeepAwake()
  const insets = useSafeAreaInsets()
  const { computer: id } = useLocalSearchParams<{ computer: string }>()
  const { client, state: host } = useHost(computerById(id))
  const [state, setState] = useState<ViewerState>({ kind: 'waiting' })
  const [displays, setDisplays] = useState<ScreenDisplay[] | null>(null)
  const viewer = useRef<ScreenViewer | null>(null)
  const touched = useRef(Date.now())
  const zoom = useZoom(() => (touched.current = Date.now()))
  const ready = host.kind === 'ready' && !!client

  // Landscape is allowed here only; the rest of the app stays upright.
  useEffect(() => {
    void ScreenOrientation.unlockAsync()
    return () => void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
  }, [])

  const start = (display?: string): void => {
    if (!client) return
    setDisplays(null)
    const v = new ScreenViewer(client, setState)
    viewer.current = v
    touched.current = Date.now()
    void v.start(display)
  }

  // With several monitors the user picks one first.
  useEffect(() => {
    if (!ready || viewer.current) return
    client!.call('screenDisplays', {}).then(
      (list) => (list.length > 1 ? setDisplays(list) : start(list[0]?.id)),
      (err: Error) => setState({ kind: 'ended', reason: 'error', message: err.message })
    )
  }, [ready])

  // Leaving the screen, the app going to the background or a long idle ends it on both sides.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && viewer.current?.finish())
    const idle = setInterval(() => Date.now() - touched.current > IDLE_MS && viewer.current?.finish({ kind: 'ended', reason: 'idle' }), 30_000)
    return () => (sub.remove(), clearInterval(idle), viewer.current?.finish())
  }, [])

  const close = (): void => {
    viewer.current?.finish()
    router.back()
  }

  const relayLeft = useCountdown(state.kind === 'live' ? state.relayEndsAt : undefined)
  const message =
    state.kind === 'ended' && state.message
      ? state.message
      : state.kind === 'waiting'
      ? t('mobile.screenWaiting')
      : state.kind === 'connecting'
        ? t('mobile.screenConnecting')
        : state.kind === 'ended'
          ? state.reason === 'unreachable'
            ? t('mobile.screenUnreachable')
            : state.reason === 'idle'
              ? t('mobile.screenIdle')
              : state.reason === 'permission'
                ? t('companion.screenPermission')
                : state.reason === 'revoked'
                  ? t('companion.screenNotAllowed')
              : state.reason === 'error'
                ? (state.message ?? t('mobile.error'))
                : t('mobile.screenEnded')
          : ''

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar hidden />
      {state.kind === 'live' ? (
        <View style={styles.fill} onLayout={zoom.onLayout} {...zoom.handlers}>
          <Animated.View style={[styles.fill, zoom.style]}>
            <RTCView streamURL={state.stream.toURL()} objectFit="contain" style={styles.fill} />
          </Animated.View>
          {relayLeft && (
            <View pointerEvents="none" style={[styles.relay, { top: insets.top + 16, left: insets.left + 14 }]}>
              <Ionicons name="cloud-outline" size={14} color="#fff" />
              <Text style={styles.relayText}>{t('mobile.screenRelay', { time: relayLeft })}</Text>
            </View>
          )}
        </View>
      ) : displays ? (
        <View style={styles.center}>
          <Text style={styles.title}>{t('mobile.chooseDisplay')}</Text>
          {displays.map((d) => (
            <Pressable key={d.id} style={({ pressed }) => [styles.choice, { opacity: pressed ? 0.6 : 1 }]} onPress={() => start(d.id)}>
              <Ionicons name="desktop-outline" size={22} color="#fff" />
              <Text style={styles.choiceText}>{`${d.name} · ${d.width}×${d.height}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.center}>
          {state.kind === 'ended' ? <Ionicons name="tv-outline" size={48} color="#aaa" /> : <ActivityIndicator color="#fff" />}
          <Text style={styles.message}>{ready || state.kind === 'ended' ? message : t('mobile.connecting')}</Text>
        </View>
      )}
      <Pressable style={[styles.stop, { top: insets.top + 10, right: insets.right + 14 }]} onPress={close} accessibilityLabel={t('mobile.stop')} hitSlop={10}>
        <Ionicons name="close" size={22} color="#fff" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  message: { color: '#ddd', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  title: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, backgroundColor: '#222', minWidth: 260 },
  choiceText: { color: '#fff', fontSize: 16 },
  relay: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  relayText: { color: '#fff', fontSize: 13, fontVariant: ['tabular-nums'] },
  stop: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }
})
