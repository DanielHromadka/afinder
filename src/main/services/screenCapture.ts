// Captures one monitor for a phone watching it (companion.ts). WebRTC runs in a hidden window of its own
// session, created for the viewing and closed after it, so the main process only passes signalling and
// the app's windows never get a display-media handler. Loaded lazily together with the companion.

import path from 'node:path'
import { BrowserWindow, desktopCapturer, screen, session } from 'electron'
import type { IceCandidate, IceServer, ScreenDisplay, ScreenEnd } from '@shared/companion/protocol'
import { IPC } from '@shared/types'

const PARTITION = 'afinder-screen'
/** `out/`: this module is a lazy chunk in out/main/chunks, so `__dirname/..` would be out/main. */
const OUT = path.resolve(__dirname, path.basename(__dirname) === 'chunks' ? '../..' : '..')

export function displays(): ScreenDisplay[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    name: d.label || `${i + 1}`,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primary
  }))
}

export interface CaptureEvents {
  candidate(c: IceCandidate): void
  ended(reason: ScreenEnd, detail?: string): void
  /** The connection runs through the TURN server (reported once). */
  relayed(): void
  /** A message from the viewer's input channel (only for sessions with control); not yet validated. */
  input(raw: string): void
}

export class ScreenCapture {
  private win: BrowserWindow | null
  private offer: { resolve(sdp: string): void; promise: Promise<string> }
  private answer: { resolve(sdp: string): void; reject(err: Error): void; promise: Promise<string> }
  /** Phone candidates that arrive before the page has applied the offer. */
  private pending: IceCandidate[] | null = []
  private done = false

  constructor(
    private readonly display: string,
    private readonly iceServers: IceServer[],
    private readonly control: boolean,
    private readonly events: CaptureEvents
  ) {
    let resolveOffer!: (sdp: string) => void
    this.offer = { resolve: (sdp) => resolveOffer(sdp), promise: new Promise((r) => (resolveOffer = r)) }
    let resolveAnswer!: (sdp: string) => void
    let rejectAnswer!: (err: Error) => void
    this.answer = { resolve: (s) => resolveAnswer(s), reject: (e) => rejectAnswer(e), promise: new Promise((res, rej) => ((resolveAnswer = res), (rejectAnswer = rej))) }
    this.answer.promise.catch(() => {})

    const ses = session.fromPartition(PARTITION)
    // Only this session may capture, and only the monitor the user allowed.
    ses.setDisplayMediaRequestHandler((_req, callback) => {
      void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(
        (sources) => {
          const source = sources.find((s) => s.display_id === this.display) ?? sources[0]
          callback(source ? { video: source } : {})
        },
        () => callback({})
      )
    })
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(OUT, 'preload/screen.js'),
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Hidden windows are throttled by default, which would starve the encoder.
        backgroundThrottling: false
      }
    })
    this.win = win
    const ipc = win.webContents.ipc
    ipc.handle(IPC.screenReady, async () => ({ iceServers: this.iceServers, offer: await this.offer.promise, control: this.control }))
    if (control) ipc.on(IPC.screenInput, (_e, raw: unknown) => typeof raw === 'string' && raw.length < 512 && this.events.input(raw))
    ipc.on(IPC.screenAnswer, (_e, sdp: unknown) => {
      if (typeof sdp !== 'string') return
      this.answer.resolve(sdp)
      const queued = this.pending ?? []
      this.pending = null
      for (const c of queued) win.webContents.send(IPC.screenCandidate, c)
    })
    ipc.on(IPC.screenCandidate, (_e, c: unknown) => isCandidate(c) && this.events.candidate(c))
    ipc.once(IPC.screenRelayed, () => this.events.relayed())
    ipc.on(IPC.screenEnded, (_e, reason: unknown, detail: unknown) => this.end(reason === 'permission' ? 'permission' : 'failed', typeof detail === 'string' ? detail : undefined))
    // A page that does not load would leave the phone waiting for an answer that never comes.
    win.webContents.on('did-fail-load', (_e, _code, desc) => this.end('failed', desc))
    win.webContents.on('preload-error', (_e, _p, err) => this.end('failed', err.message))
    win.on('closed', () => {
      this.win = null
      this.end('failed')
    })
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/screen.html`)
    else void win.loadFile(path.join(OUT, 'renderer/screen.html'))
  }

  /** The phone's offer; resolves with the answer once the page captured the monitor. */
  accept(offer: string): Promise<string> {
    this.offer.resolve(offer)
    return this.answer.promise
  }

  candidate(c: IceCandidate): void {
    if (this.pending) this.pending.push(c)
    else this.win?.webContents.send(IPC.screenCandidate, c)
  }

  /** Stops capturing; `reason` goes to the phone through the events. */
  end(reason: ScreenEnd, detail?: string): void {
    if (this.done) return
    this.done = true
    this.answer.reject(new Error(detail || reason))
    const win = this.win
    this.win = null
    if (win && !win.isDestroyed()) win.destroy()
    this.events.ended(reason, detail)
  }
}

export function isCandidate(c: unknown): c is IceCandidate {
  const x = c as IceCandidate
  return !!x && typeof x.candidate === 'string' && x.candidate.length < 2000 && (x.sdpMid === null || typeof x.sdpMid === 'string') && (x.sdpMLineIndex === null || typeof x.sdpMLineIndex === 'number')
}
