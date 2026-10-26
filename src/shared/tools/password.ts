// Passwords from the system's secure random generator (crypto.getRandomValues), with rejection
// sampling so no character is more likely than another.

export interface PasswordOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  /** Leaves out 0 O o 1 l I |, which are easy to misread. */
  unambiguous: boolean
}

const SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.?/~' }
const AMBIGUOUS = /[0Oo1lI|]/g

export function passwordAlphabet(o: PasswordOptions): string[] {
  const sets = (Object.keys(SETS) as (keyof typeof SETS)[]).filter((k) => o[k]).map((k) => (o.unambiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]))
  return sets
}

/** `random(n)` fills n random bytes; injectable for tests. */
export function generatePassword(o: PasswordOptions, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const sets = passwordAlphabet(o)
  if (!sets.length) return ''
  const alphabet = sets.join('')
  const length = Math.max(4, Math.min(128, Math.floor(o.length)))
  // Rejection sampling: a byte is only used below the largest multiple of n (n ≤ 256 here).
  const randomInt = (n: number): number => {
    const limit = 256 - (256 % n)
    for (;;) {
      const [b] = random(1)
      if (b < limit) return b % n
    }
  }
  const pick = (chars: string): string => chars[randomInt(chars.length)]
  // One character from every chosen set, the rest from all of them, then shuffled (Fisher–Yates).
  const chars = sets.map(pick)
  while (chars.length < length) chars.push(pick(alphabet))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** Bits of entropy of a random password of this length over this alphabet. */
export const passwordBits = (o: PasswordOptions): number => {
  const size = passwordAlphabet(o).join('').length
  return size ? Math.floor(o.length * Math.log2(size)) : 0
}
