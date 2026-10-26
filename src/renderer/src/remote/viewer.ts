// One remote desktop session: asks the other computer to share a monitor (with control when allowed),
// offers to receive its video, opens the input channel and exchanges the signalling through the main
// process and the paired, encrypted session. The browser counterpart of mobile/app/src/lib/screen.ts.

import { INPUT_CHANNEL, INPUT_READY, type ControlError, type IceCandidate, type RpcMethods, type ScreenEnd, type ScreenEvent, type ScreenSignal } from '@shared/companion/protocol'
import type { InputEvent } from '@shared/companion/input'
import type { RemoteDesktopInit } from '@shared/types'

export interface DesktopApi {
  init(): Promise<RemoteDesktopInit>
  start(display: string | null, control: boolean): Promise<RpcMethods['screenStart'][1]>
  signal(signal: ScreenSignal): Promise<RpcMethods['screenSignal'][1]>
  stop(session: number): Promise<void>
  clipboard(direction: 'send' | 'fetch'): Promise<void>
  onEvent(cb: (e: ScreenEvent) => void): void
}
export const api = (window as unknown as { desktopApi: DesktopApi }).desktopApi

/** ipcRenderer.invoke wraps the main process's message; the user needs only the message. */
export const messageOf = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')

export type ViewerState =
  | { kind: 'connecting' }
  /** `relayEndsAt`: the video goes through the TURN server and ends then. */
  | { kind: 'live'; stream: MediaStream; control: boolean; controlError?: ControlError; relayEndsAt?: number }
  | { kind: 'ended'; reason: ScreenEnd | 'error'; message?: string; limit?: { minutes: number; wait: number }; restMinutes?: number }

/** The other computer drops a session it does not hear from. */
const PING_MS = 15_000
const CONNECT_MS = 25_000

let listener: ((e: ScreenEvent) => void) | null = null
api.onEvent((e) => listener?.(e))

export class Viewer {
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  /** The other computer listens on the channel (it said so). */
  private inputReady = false
  private remoteSet = false
  private queued: IceCandidate[] = []
  private ping: ReturnType<typeof setInterval> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private relay: { endsAt: number; limitMs: number; cooldownMs: number } | null = null
  private session: number | null = null
  private onEvent: ((e: ScreenEvent) => void) | null = null
  private restMs = 0
  state: ViewerState = { kind: 'connecting' }

  constructor(private readonly onState: (s: ViewerState) => void) {}

  private set(s: ViewerState): void {
    if (this.state.kind === 'ended') return
    this.state = s
    this.onState(s)
  }

  async start(display: string | null, wantControl: boolean): Promise<void> {
    listener = this.onEvent = (e) => {
      if (e.end === 'limit' && this.relay) this.finish({ kind: 'ended', reason: 'limit', limit: { minutes: Math.round(this.relay.limitMs / 60_000), wait: Math.round(this.relay.cooldownMs / 60_000) } }, false)
      else if (e.end === 'unreachable') this.finish(this.unreachable(), false)
      else if (e.end) this.finish({ kind: 'ended', reason: e.end }, false)
      else if (e.candidate) this.remoteCandidate(e.candidate)
      else if (e.relay) {
        this.relay = { endsAt: Date.now() + e.relay.ms, limitMs: e.relay.ms, cooldownMs: e.relay.cooldownMs }
        if (this.state.kind === 'live') this.set({ ...this.state, relayEndsAt: this.relay.endsAt })
      }
    }
    try {
      const started = await api.start(display, wantControl)
      this.session = started.session
      this.restMs = started.cooldownMs ?? 0
      if (this.state.kind === 'ended') return void api.stop(started.session).catch(() => {})
      const pc = new RTCPeerConnection({ iceServers: started.iceServers })
      this.pc = pc
      pc.addTransceiver('video', { direction: 'recvonly' })
      // Opened by this side, before the offer, so it is part of the one negotiation.
      if (started.control) {
        this.channel = pc.createDataChannel(INPUT_CHANNEL, { ordered: true })
        this.channel.onmessage = (m) => m.data === INPUT_READY && (this.inputReady = true)
        this.channel.onclose = () => this.state.kind === 'live' && this.set({ ...this.state, control: false })
      }
      let stream: MediaStream | null = null
      const live = (): void =>
        void (stream && pc.connectionState === 'connected' && this.state.kind === 'connecting' && this.set({ kind: 'live', stream, control: !!started.control, controlError: started.controlError, relayEndsAt: this.relay?.endsAt }))
      pc.ontrack = (e) => {
        stream = e.streams[0] ?? new MediaStream([e.track])
        live()
      }
      pc.onicecandidate = (e) => e.candidate && void api.signal({ candidate: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } }).catch(() => {})
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' && this.timer) clearTimeout(this.timer)
        live()
        if (pc.connectionState === 'failed') this.finish(this.unreachable())
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const answer = await api.signal({ offer: offer.sdp ?? '' })
      if (!answer) throw new Error('No answer')
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
      this.remoteSet = true
      for (const c of this.queued.splice(0)) this.remoteCandidate(c)
      this.ping = setInterval(() => void api.signal({ ping: true }).catch(() => {}), PING_MS)
      this.timer = setTimeout(() => this.state.kind !== 'live' && this.finish(this.unreachable()), CONNECT_MS)
    } catch (err) {
      this.finish({ kind: 'ended', reason: 'error', message: messageOf(err) })
    }
  }

  private unreachable(): Extract<ViewerState, { kind: 'ended' }> {
    return { kind: 'ended', reason: 'unreachable', ...(this.restMs && { restMinutes: Math.max(1, Math.ceil(this.restMs / 60_000)) }) }
  }

  private remoteCandidate(c: IceCandidate): void {
    if (!this.pc || !this.remoteSet) return void this.queued.push(c)
    void this.pc.addIceCandidate(c).catch(() => {})
  }

  /** Mouse and keyboard; dropped while the channel is not open (or the session only watches). */
  send(e: InputEvent): void {
    if (this.inputReady && this.channel?.readyState === 'open') this.channel.send(JSON.stringify(e))
  }

  finish(end: Extract<ViewerState, { kind: 'ended' }> = { kind: 'ended', reason: 'stopped' }, tell = true): void {
    if (this.state.kind === 'ended') return
    if (tell && this.session !== null) void api.stop(this.session).catch(() => {})
    if (this.ping) clearInterval(this.ping)
    if (this.timer) clearTimeout(this.timer)
    if (listener === this.onEvent) listener = null
    this.channel?.close()
    this.pc?.close()
    this.pc = null
    this.state = end
    this.onState(end)
  }
}
