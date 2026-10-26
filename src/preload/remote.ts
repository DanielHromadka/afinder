// Preload of the remote desktop window (main/services/remoteDesktop.ts): the page does the WebRTC and the
// input; the signalling, the clipboard and what it knows about the other computer come through here.
import { contextBridge, ipcRenderer } from 'electron'
import type { RpcMethods, ScreenEvent, ScreenSignal } from '@shared/companion/protocol'
import type { RemoteDesktopInit } from '@shared/types'

type Channels = typeof import('@shared/types').IPC
/** Spelled out instead of imported: see preload/screen.ts. */
const C: Pick<Channels, 'remoteDesktopInit' | 'remoteDesktopStart' | 'remoteDesktopSignal' | 'remoteDesktopStop' | 'remoteDesktopClipboard' | 'remoteDesktopEvent'> = {
  remoteDesktopInit: 'remoteDesktop:init',
  remoteDesktopStart: 'remoteDesktop:start',
  remoteDesktopSignal: 'remoteDesktop:signal',
  remoteDesktopStop: 'remoteDesktop:stop',
  remoteDesktopClipboard: 'remoteDesktop:clipboard',
  remoteDesktopEvent: 'remoteDesktop:event'
}

contextBridge.exposeInMainWorld('desktopApi', {
  init: (): Promise<RemoteDesktopInit> => ipcRenderer.invoke(C.remoteDesktopInit),
  start: (display: string | null, control: boolean): Promise<RpcMethods['screenStart'][1]> => ipcRenderer.invoke(C.remoteDesktopStart, display, control),
  signal: (signal: ScreenSignal): Promise<RpcMethods['screenSignal'][1]> => ipcRenderer.invoke(C.remoteDesktopSignal, signal),
  /** Ends that session (and not one started after it). */
  stop: (session: number): Promise<void> => ipcRenderer.invoke(C.remoteDesktopStop, session),
  clipboard: (direction: 'send' | 'fetch'): Promise<void> => ipcRenderer.invoke(C.remoteDesktopClipboard, direction),
  onEvent: (cb: (e: ScreenEvent) => void): void => void ipcRenderer.on(C.remoteDesktopEvent, (_e, ev: ScreenEvent) => cb(ev))
})
