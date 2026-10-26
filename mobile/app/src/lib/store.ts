// What the phone keeps: its own key pair and the computers it paired with. Both live in the Keychain
// (iOS) / Keystore-backed storage (Android), never in plain app files.

import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { fromB64, toB64 } from '../../../../src/shared/companion/bytes'
import { keyPairOf, newKeyPair, type KeyPair } from '../../../../src/shared/companion/crypto'
import type { Computer } from './client'

const IDENTITY = 'afinder.identity'
const COMPUTERS = 'afinder.computers'
/** Readable only while the device is unlocked, and never restored to another device from a backup. */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }

let identity: KeyPair | null = null

export async function loadIdentity(): Promise<KeyPair> {
  if (identity) return identity
  const saved = await SecureStore.getItemAsync(IDENTITY, OPTIONS)
  if (saved) return (identity = keyPairOf(fromB64(saved)))
  identity = newKeyPair()
  await SecureStore.setItemAsync(IDENTITY, toB64(identity.secretKey), OPTIONS)
  return identity
}

let computers: Computer[] = []
let loaded = false
const listeners = new Set<() => void>()

export async function loadComputers(): Promise<Computer[]> {
  if (loaded) return computers
  try {
    const parsed = JSON.parse((await SecureStore.getItemAsync(COMPUTERS, OPTIONS)) ?? '[]') as Computer[]
    computers = Array.isArray(parsed) ? parsed.filter((c) => typeof c?.id === 'string' && typeof c.relay === 'string' && typeof c.key === 'string') : []
  } catch {
    computers = []
  }
  loaded = true
  for (const fn of listeners) fn()
  return computers
}

async function save(next: Computer[]): Promise<void> {
  computers = next
  for (const fn of listeners) fn()
  await SecureStore.setItemAsync(COMPUTERS, JSON.stringify(next), OPTIONS)
}

/** Pairing again with the same computer replaces the old entry. */
export const addComputer = (c: Computer): Promise<void> => save([...computers.filter((x) => x.id !== c.id), c])
export const removeComputer = (id: string): Promise<void> => save(computers.filter((x) => x.id !== id))
export const computerById = (id: string): Computer | undefined => computers.find((c) => c.id === id)

export function useComputers(): { computers: Computer[]; loaded: boolean } {
  const list = useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => computers
  )
  return { computers: list, loaded }
}
