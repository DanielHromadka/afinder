import { describe, expect, it } from 'vitest'
import { chars, match } from './matcher'

describe('match – substring', () => {
  it('returns [] for empty query', () => {
    expect(match('Dokumenty', '', false)).toEqual([])
    expect(match('Dokumenty', '   ', false)).toEqual([])
  })

  it('finds a case-insensitive substring', () => {
    expect(match('Dokumenty', 'KUM', false)).toEqual([2, 3, 4])
  })

  it('ignores diacritics in both directions', () => {
    expect(match('Česky', 'cesky', false)).toEqual([0, 1, 2, 3, 4])
    expect(match('cesky', 'Česky', false)).toEqual([0, 1, 2, 3, 4])
    expect(match('Stažené soubory', 'stazene', false)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('maps indexes onto the NFC form of NFD names (as macOS returns them)', () => {
    const nfd = 'Účty 2024'.normalize('NFD')
    expect(nfd.length).toBeGreaterThan('Účty 2024'.length)
    const hits = match(nfd, 'ty', false)!
    expect(hits).toEqual([2, 3])
    expect(hits.map((i) => chars(nfd)[i]).join('')).toBe('ty')
  })

  it('handles characters outside the BMP', () => {
    expect(match('🎵 hudba', 'hud', false)).toEqual([2, 3, 4])
  })

  it('returns null when there is no contiguous match', () => {
    expect(match('Dokumenty', 'dkm', false)).toBeNull()
  })
})

describe('match – fuzzy', () => {
  it('matches characters in order with gaps', () => {
    expect(match('Dokumenty', 'dkm', true)).toEqual([0, 2, 4])
  })

  it('prefers a contiguous match when one exists', () => {
    expect(match('a_b_ab', 'ab', true)).toEqual([4, 5])
  })

  it('returns null when characters are out of order', () => {
    expect(match('Dokumenty', 'mkd', true)).toBeNull()
  })
})
