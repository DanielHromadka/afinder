// Watching the computer's screen: the phone asks (the user confirms on the computer), offers to receive
// one video track and exchanges the WebRTC signalling through the encrypted session, so the DTLS
// fingerprints the video is keyed with are vouched for by the paired keys. The video itself goes
// directly between the devices, or through TURN when the network does not allow that.

import { MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, type MediaStreamTrack } from 'react-native-webrtc'
import type { IceCandidate, ScreenEnd } from '../../../../src/shared/companion/protocol'
import type { HostClient } from './client'
import { t } from './i18n'

export type ViewerState =
  | { kind: 'waiting' }
  | { kind: 'connecting' }
  /** `relayEndsAt`: the video goes through the TURN server and ends then (phone clock). */
  | { kind: 'live'; stream: MediaStream; relayEndsAt?: number }
  | { kind: 'ended'; reason: ScreenEnd | 'idle' | 'error'; message?: string }

/** The computer drops a session it does not hear from; this keeps it alive while the screen is shown. */
const PING_MS = 15_000
/** Matches the computer's own limit for establishing the connection. */
const CONNECT_MS = 25_000

export class ScreenViewer {
  private pc: RTCPeerConnection | null = null
  private session: number | null = null
  private remoteSet = false
  private queued: IceCandidate[] = []
  private ping: ReturnType<typeof setInterval> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private off: (() => void) | null = null
  private relay: { endsAt: number; limitMs: number; cooldownMs: number } | null = null
  /** The TURN server is resting: only a direct connection was tried. */
  private restMs = 0
  state: ViewerState = { kind: 'waiting' }

  constructor(
    private readonly client: HostClient,
    private readonly onState: (s: ViewerState) => void
  ) {}

  private set(s: ViewerState): void {
    if (this.state.kind === 'ended') return
    this.state = s
    this.onState(s)
  }

  async start(display?: string): Promise<void> {
    this.off = this.client.onScreen((e) => {
      if (e.session !== this.session) return
      if (e.end === 'limit' && this.relay) this.finish({ kind: 'ended', reason: 'limit', message: t('mobile.screenLimit', { minutes: Math.round(this.relay.limitMs / 60_000), wait: Math.round(this.relay.cooldownMs / 60_000) }) }, false)
      else if (e.end === 'unreachable') this.finish(this.unreachable(), false)
      else if (e.end) this.finish({ kind: 'ended', reason: e.end }, false)
      else if (e.candidate) this.remoteCandidate(e.candidate)
      else if (e.relay) {
        this.relay = { endsAt: Date.now() + e.relay.ms, limitMs: e.relay.ms, cooldownMs: e.relay.cooldownMs }
        if (this.state.kind === 'live') this.set({ ...this.state, relayEndsAt: this.relay.endsAt })
      }
    })
    try {
      // Resolves only after the user allowed it on the computer.
      const { session, iceServers, cooldownMs } = await this.client.call('screenStart', display ? { display } : {})
      this.session = session
      this.restMs = cooldownMs ?? 0
      if (this.state.kind === 'ended') return void this.client.call('screenStop', { session }).catch(() => {})
      this.set({ kind: 'connecting' })
      const pc = new RTCPeerConnection({ iceServers })
      this.pc = pc
      pc.addTransceiver('video', { direction: 'recvonly' })
      // The track arrives with the answer, before any video can flow; it is shown once connected, so a
      // connection that never comes up ends with "unreachable" instead of a black screen.
      let stream: MediaStream | null = null
      const live = (): void => void (stream && pc.connectionState === 'connected' && this.state.kind === 'connecting' && this.set({ kind: 'live', stream, relayEndsAt: this.relay?.endsAt }))
      // The library types its events loosely; these are the fields the W3C events carry.
      pc.ontrack = (e: unknown) => {
        const { streams, track } = e as { streams?: MediaStream[]; track?: MediaStreamTrack }
        stream = streams?.[0] ?? (track ? new MediaStream([track]) : null)
        live()
      }
      pc.onicecandidate = (e: unknown) => {
        const { candidate } = e as { candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null }
        if (!candidate) return
        const c: IceCandidate = { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null }
        void this.client.call('screenSignal', { session, signal: { candidate: c } }).catch(() => {})
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' && this.timer) clearTimeout(this.timer)
        live()
        if (pc.connectionState === 'failed') this.finish(this.unreachable())
      }
      const offer = await pc.createOffer({})
      await pc.setLocalDescription(offer)
      const answer = await this.client.call('screenSignal', { session, signal: { offer: offer.sdp ?? '' } })
      if (!answer) throw new Error('No answer')
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer.sdp }))
      this.remoteSet = true
      for (const c of this.queued.splice(0)) this.remoteCandidate(c)
      this.ping = setInterval(() => void this.client.call('screenSignal', { session, signal: { ping: true } }).catch(() => {}), PING_MS)
      this.timer = setTimeout(() => this.state.kind !== 'live' && this.finish(this.unreachable()), CONNECT_MS)
    } catch (err) {
      this.finish({ kind: 'ended', reason: 'error', message: (err as Error).message })
    }
  }

  /** Unreachable while the TURN server rests says when it can be used again. */
  private unreachable(): Extract<ViewerState, { kind: 'ended' }> {
    return this.restMs ? { kind: 'ended', reason: 'unreachable', message: t('mobile.screenRest', { minutes: Math.max(1, Math.ceil(this.restMs / 60_000)) }) } : { kind: 'ended', reason: 'unreachable' }
  }

  private remoteCandidate(c: IceCandidate): void {
    if (!this.pc || !this.remoteSet) return void this.queued.push(c)
    void this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  }

  /** Ends the session on both sides; `tell` is false when the computer ended it. */
  finish(end: Extract<ViewerState, { kind: 'ended' }> = { kind: 'ended', reason: 'stopped' }, tell = true): void {
    if (this.state.kind === 'ended') return
    if (tell && this.session !== null) void this.client.call('screenStop', { session: this.session }).catch(() => {})
    if (this.ping) clearInterval(this.ping)
    if (this.timer) clearTimeout(this.timer)
    this.off?.()
    this.pc?.close()
    this.pc = null
    this.state = end
    this.onState(end)
  }
}
