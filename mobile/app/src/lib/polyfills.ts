import { getRandomValues } from 'expo-crypto'

// Hermes has no Web Crypto; the shared crypto (@noble) only needs secure random bytes from it.
const g = globalThis as { crypto?: Partial<Crypto> }
if (typeof g.crypto?.getRandomValues !== 'function') {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues: getRandomValues as Crypto['getRandomValues'] }
}
