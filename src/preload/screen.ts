// Preload of the hidden screen-capture window (main/services/screenCapture.ts): the page gets the phone's
// offer and ICE servers, and hands back its answer, its candidates and the end of the capture.
import { contextBridge, ipcRenderer } from 'electron'
import type { IceCandidate, IceServer } from '@shared/companion/protocol'

type Channels = typeof import('@shared/types').IPC
/** Spelled out instead of imported: a value import from @shared would become a chunk shared with the main
 * preload, which a sandboxed preload cannot load. The type keeps them equal to the IPC constants. */
const C: Pick<Channels, 'screenReady' | 'screenAnswer' | 'screenCandidate' | 'screenEnded' | 'screenRelayed' | 'screenInput'> = {
  screenReady: 'screen:ready',
  screenAnswer: 'screen:answer',
  screenCandidate: 'screen:candidate',
  screenEnded: 'screen:ended',
  screenRelayed: 'screen:relayed',
  screenInput: 'screen:input'
}

contextBridge.exposeInMainWorld('screenApi', {
  ready: (): Promise<{ iceServers: IceServer[]; offer: string; control: boolean }> => ipcRenderer.invoke(C.screenReady),
  input: (raw: string): void => ipcRenderer.send(C.screenInput, raw),
  answer: (sdp: string): void => ipcRenderer.send(C.screenAnswer, sdp),
  candidate: (c: IceCandidate): void => ipcRenderer.send(C.screenCandidate, c),
  ended: (reason: 'permission' | 'failed', detail?: string): void => ipcRenderer.send(C.screenEnded, reason, detail),
  relayed: (): void => ipcRenderer.send(C.screenRelayed),
  onCandidate: (cb: (c: IceCandidate) => void): void => void ipcRenderer.on(C.screenCandidate, (_e, c: IceCandidate) => cb(c))
})
