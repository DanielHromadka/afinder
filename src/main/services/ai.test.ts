import { describe, expect, it, vi } from 'vitest'

vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('electron', () => ({}))

const { parseSuggestions, renamePrompt } = await import('./ai')

const answer = (result: string, extra: object = {}): string => JSON.stringify({ type: 'result', is_error: false, result, ...extra })

describe('AI rename suggestions', () => {
  it('reads the JSON array from Claude’s answer, ignoring shell noise', () => {
    const out = `Welcome to zsh!\n${answer('Here you go:\n["Lisabon 2026.jpg", "Smlouva.pdf"]')}\n`
    expect(parseSuggestions(out, 2)).toEqual(['Lisabon 2026.jpg', 'Smlouva.pdf'])
  })

  it('rejects answers that do not fit', () => {
    expect(() => parseSuggestions(answer('["one"]'), 2)).toThrow()
    expect(() => parseSuggestions(answer('no list here'), 1)).toThrow()
    expect(() => parseSuggestions(answer('[1, 2]'), 2)).toThrow()
    expect(() => parseSuggestions('not json at all', 1)).toThrow()
    expect(() => parseSuggestions(answer('Not logged in', { is_error: true }), 1)).toThrow('Not logged in')
  })

  it('puts the names as data into the prompt', () => {
    const prompt = renamePrompt([{ name: 'IMG_1.JPG', isDir: false }, { name: 'stuff', isDir: true }], 'use dates', 'cs')
    expect(prompt).toContain('[{"name":"IMG_1.JPG"},{"name":"stuff","folder":true}]')
    expect(prompt).toContain('The user asks: use dates')
    expect(prompt).toContain('language "cs"')
  })
})
