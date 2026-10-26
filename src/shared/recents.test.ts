import { describe, expect, it } from 'vitest'
import { addRecent, MAX_RECENTS, sanitizeRecents, screenshotName } from './recents'

describe('recents', () => {
  it('moves a touched file to the top without duplicates', () => {
    const list = [
      { path: '/a', at: 2, action: 'opened' as const },
      { path: '/b', at: 1, action: 'created' as const }
    ]
    expect(addRecent(list, { path: '/b', at: 3, action: 'edited' }).map((r) => r.path)).toEqual(['/b', '/a'])
  })

  it('caps the list', () => {
    let list = sanitizeRecents([])
    for (let i = 0; i < MAX_RECENTS + 5; i++) list = addRecent(list, { path: `/f${i}`, at: i, action: 'opened' })
    expect(list).toHaveLength(MAX_RECENTS)
    expect(list[0].path).toBe(`/f${MAX_RECENTS + 4}`)
  })

  it('drops malformed and duplicate entries', () => {
    const clean = sanitizeRecents([
      { path: '/x', at: 1, action: 'opened' },
      { path: '/x', at: 5, action: 'opened' },
      { path: '/y', at: 3, action: 'deleted' },
      { path: 42, at: 3, action: 'opened' },
      null,
      { path: '/z', at: 9, action: 'screenshot' }
    ])
    expect(clean.map((r) => r.path)).toEqual(['/z', '/x'])
  })

  it('names screenshots by local time and avoids collisions', () => {
    const date = new Date(2026, 9, 12, 16, 5, 9)
    expect(screenshotName('Screenshot {time}', date, () => false)).toBe('Screenshot 2026-10-12 16.05.09.png')
    const taken = new Set(['Snímek 2026-10-12 16.05.09.png'])
    expect(screenshotName('Snímek {time}', date, (n) => taken.has(n))).toBe('Snímek 2026-10-12 16.05.09 (2).png')
  })
})
