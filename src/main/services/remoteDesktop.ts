// Remote desktop of another computer running aFinder (paired as a remote connection, remote/afinder.ts).
// One window per connection shows its screen (renderer/src/remote) and sends mouse and keyboard on a WebRTC
// data channel. The window does the WebRTC itself; the signalling goes through this module and the paired,
// encrypted session, so the DTLS fingerprints the video and input are keyed with are vouched for by the
// paired keys. Loaded lazily from ipc.ts.

import path from 'node:path'
import { BrowserWindow, clipboard } from 'electron'
import { getLanguage, t } from '@shared/i18n'
import type { ScreenEvent, ScreenSignal } from '@shared/companion/protocol'
import { IPC, type RemoteDesktopInit } from '@shared/types'
import * as remote from './remote'

/** `out/`: this module is a lazy chunk in out/main/chunks, so `__dirname/..` would be out/main. */
const OUT = path.resolve(__dirname, path.basename(__dirname) === 'chunks' ? '../..' : '..')
const windows = new Map<string, BrowserWindow>()

export async function open(id: string): Promise<void> {
  const existing = windows.get(id)
  if (existing && !existing.isDestroyed()) return existing.focus()
  const mount = remote.mounts().find((m) => m.connection.id === id && m.connection.type === 'afinder')
  if (!mount) throw new Error(t('error.notFound'))
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    title: t('remoteDesktop.title', { name: mount.connection.name }),
    backgroundColor: '#1b1b1b',
    webPreferences: { preload: path.join(OUT, 'preload/remote.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  windows.set(id, win)
  let session: number | null = null
  let off: (() => void) | null = null
  const ipc = win.webContents.ipc
  const computer = (): ReturnType<typeof remote.computer> => remote.computer(id)
  /** Ends the running session; the next one starts only after the other computer let go of it. */
  const stop = async (only?: unknown): Promise<void> => {
    if (session === null || (typeof only === 'number' && only !== session)) return
    const ending = session
    off?.()
    off = null
    session = null
    await computer().then((c) => c.call('screenStop', { session: ending }), () => {})
  }

  ipc.handle(IPC.remoteDesktopInit, async (): Promise<RemoteDesktopInit> => {
    const c = await computer()
    const info = await c.info()
    const displays = info.screen ? await c.call('screenDisplays', {}) : []
    return { name: mount.connection.name, language: getLanguage(), platform: process.platform, info, displays }
  })
  ipc.handle(IPC.remoteDesktopStart, async (_e, display: unknown, control: unknown) => {
    await stop()
    const c = await computer()
    off = c.client.onScreen((ev: ScreenEvent) => ev.session === session && !win.isDestroyed() && win.webContents.send(IPC.remoteDesktopEvent, ev))
    const started = await c.call('screenStart', { ...(typeof display === 'string' && { display }), control: control === true })
    session = started.session
    return started
  })
  ipc.handle(IPC.remoteDesktopSignal, async (_e, signal: ScreenSignal) => {
    if (session === null) throw new Error(t('companion.screenEnded'))
    const mine = session
    // Whatever races the end of the session (the window closed, another monitor chosen) tells nothing.
    return (await computer()).call('screenSignal', { session, signal }).catch((err: Error) => {
      if (session !== mine || win.isDestroyed() || !('offer' in signal)) return null
      throw err
    })
  })
  ipc.handle(IPC.remoteDesktopStop, (_e, only: unknown) => stop(only))
  // Text only, and only on a click in the window: neither side's clipboard flows on its own.
  ipc.handle(IPC.remoteDesktopClipboard, async (_e, direction: unknown) => {
    const c = await computer()
    if (direction === 'send') await c.call('clipboardWrite', { text: await clipboard.readText() })
    else await clipboard.writeText(await c.call('clipboardRead', {}))
  })
  win.on('closed', () => {
    void stop()
    if (windows.get(id) === win) windows.delete(id)
  })
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/remote.html`)
  else await win.loadFile(path.join(OUT, 'renderer/remote.html'))
}
