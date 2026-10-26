// One live connection per paired computer, shared by all screens. Connections wake up when the app
// returns to the foreground (iOS suspends sockets in the background) and close when a computer is removed.
// Each connection also syncs the files kept offline for that computer.

import { useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { HostClient, type Computer, type HostState } from './client'
import { sync } from './files'
import { loadIdentity } from './store'

const clients = new Map<string, HostClient>()
const pending = new Map<string, Promise<HostClient>>()

export function clientFor(computer: Computer): Promise<HostClient> {
  const live = clients.get(computer.id)
  if (live) return Promise.resolve(live)
  let p = pending.get(computer.id)
  if (!p) {
    p = loadIdentity().then((identity) => {
      const client = new HostClient(computer, identity)
      // Every (re)connection brings the offline files up to date in both directions.
      client.subscribe((s) => s.kind === 'ready' && void sync(client))
      clients.set(computer.id, client)
      pending.delete(computer.id)
      return client
    })
    pending.set(computer.id, p)
  }
  return p
}

/** Forgets the connection (the computer was removed or paired again). */
export function dropClient(id: string): void {
  clients.get(id)?.close()
  clients.delete(id)
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') for (const c of clients.values()) c.wake()
})

const CONNECTING: HostState = { kind: 'connecting' }

/** The connection to a computer and its state, re-rendering when it changes. */
export function useHost(computer: Computer | undefined): { client: HostClient | undefined; state: HostState } {
  useEffect(() => {
    if (computer) void clientFor(computer)
  }, [computer])
  const client = computer ? clients.get(computer.id) : undefined
  const state = useSyncExternalStore(
    (fn) => {
      if (!computer) return () => {}
      let off = (): void => {}
      let live = true
      void clientFor(computer).then((c) => {
        if (!live) return
        off = c.subscribe(fn)
        fn()
      })
      return () => {
        live = false
        off()
      }
    },
    () => (computer ? (clients.get(computer.id)?.state ?? CONNECTING) : CONNECTING)
  )
  return { client, state }
}
