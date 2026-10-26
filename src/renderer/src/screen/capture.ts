// The hidden window that captures one monitor for a viewer (main/services/screenCapture.ts): the phone or
// another aFinder. The viewer offers to receive video; this page captures, answers and sends. With control,
// the viewer's input channel is passed on to the main process. Nothing is shown and nothing is kept.
import { INPUT_CHANNEL, INPUT_READY, type IceCandidate, type IceServer } from '@shared/companion/protocol'

interface ScreenApi {
  ready(): Promise<{ iceServers: IceServer[]; offer: string; control: boolean }>
  input(raw: string): void
  answer(sdp: string): void
  candidate(c: IceCandidate): void
  ended(reason: 'permission' | 'failed', detail?: string): void
  relayed(): void
  onCandidate(cb: (c: IceCandidate) => void): void
}
const api = (window as unknown as { screenApi: ScreenApi }).screenApi

/** Text must stay readable on the phone: keep the resolution, give up frames first. */
const MAX_SIDE = 1920
const MAX_BITRATE = 4_000_000
/** A computer controlling this one has a big screen and someone working on it: sharper and smoother. */
const CONTROL_SIDE = 2560
const CONTROL_BITRATE = 10_000_000
const CONTROL_FPS = 60
/** Without a working path by then (no TURN and a strict NAT) the phone is told so. */
const CONNECT_MS = 20_000
/** Through the TURN server (paid per GB, often a mobile network): smaller, slower, cheaper. */
const RELAY_SIDE = 1280
const RELAY_BITRATE = 1_500_000
const RELAY_FPS = 15
const RELAY_CHECK_MS = 3000

/** Whether the connection in use goes through a TURN server, on either side. */
async function relayed(pc: RTCPeerConnection): Promise<boolean> {
  const stats = await pc.getStats()
  let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined
  stats.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId)
  })
  if (!pair) stats.forEach((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && (pair = r))
  const type = (id?: string): string | undefined => (id ? stats.get(id)?.candidateType : undefined)
  return !!pair && (type(pair.localCandidateId) === 'relay' || type(pair.remoteCandidateId) === 'relay')
}

async function run(): Promise<void> {
  const { iceServers, offer, control } = await api.ready()
  const pc = new RTCPeerConnection({ iceServers })
  // Other channels, and any channel in a session without control, are ignored.
  pc.ondatachannel = (e) => {
    if (!control || e.channel.label !== INPUT_CHANNEL) return e.channel.close()
    e.channel.onmessage = (m) => typeof m.data === 'string' && api.input(m.data)
    e.channel.send(INPUT_READY)
  }
  pc.onicecandidate = (e) => e.candidate && api.candidate({ candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex })
  api.onCandidate((c) => void pc.addIceCandidate(c).catch(() => {}))
  let stream: MediaStream
  try {
    const side = control ? CONTROL_SIDE : MAX_SIDE
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: side }, height: { max: side }, frameRate: { max: control ? CONTROL_FPS : 30 } }, audio: false })
  } catch (err) {
    return api.ended('permission', (err as Error).message)
  }
  const track = stream.getVideoTracks()[0]
  track.contentHint = 'detail'
  track.onended = () => api.ended('failed', 'capture ended')
  await pc.setRemoteDescription({ type: 'offer', sdp: offer })
  // The viewer offered a receive-only video transceiver: send on it.
  const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')
  if (!transceiver) return api.ended('failed', 'no video in offer')
  transceiver.direction = 'sendonly'
  await transceiver.sender.replaceTrack(track)
  const params = transceiver.sender.getParameters()
  params.degradationPreference = 'maintain-resolution'
  if (params.encodings?.[0]) params.encodings[0].maxBitrate = control ? CONTROL_BITRATE : MAX_BITRATE
  await transceiver.sender.setParameters(params).catch(() => {})
  const { width = MAX_SIDE, height = MAX_SIDE } = track.getSettings()
  let viaRelay = false
  const checkRelay = async (): Promise<void> => {
    if (viaRelay || pc.connectionState !== 'connected' || !(await relayed(pc).catch(() => false))) return
    viaRelay = true
    const p = transceiver.sender.getParameters()
    p.encodings?.[0] && Object.assign(p.encodings[0], { maxBitrate: RELAY_BITRATE, maxFramerate: RELAY_FPS, scaleResolutionDownBy: Math.max(1, Math.max(width, height) / RELAY_SIDE) })
    await transceiver.sender.setParameters(p).catch(() => {})
    api.relayed()
  }
  // The path can change after connecting (a direct one failing later), so it is checked again now and then.
  setInterval(() => void checkRelay(), RELAY_CHECK_MS)
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  api.answer(answer.sdp ?? '')
  const timer = setTimeout(() => pc.connectionState !== 'connected' && api.ended('failed', 'unreachable'), CONNECT_MS)
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      clearTimeout(timer)
      void checkRelay()
    }
    if (pc.connectionState === 'failed') api.ended('failed', 'unreachable')
  }
}

run().catch((err) => api.ended('failed', (err as Error).message))
