import { describe, expect, it } from 'vitest'
import { rankCommands, type PaletteCommand } from './palette'

const cmd = (label: string, group = 'Akce', keywords?: string): PaletteCommand => ({ id: label, label, group, keywords, run: () => {} })

const commands = [cmd('Nová složka'), cmd('Nový tab', 'Okno'), cmd('Zobrazit skryté soubory', 'Zobrazení'), cmd('Vzhled: Moderní (macOS)', 'Vzhled', 'theme'), cmd('Přejít: Stažené', 'Přejít', '/Users/me/Downloads')]

const labels = (q: string): string[] => rankCommands(commands, q).map((r) => r.command.label)

describe('command palette ranking', () => {
  it('keeps the order for an empty query', () => {
    expect(labels('')).toEqual(commands.map((c) => c.label))
  })

  it('prefers contiguous matches at word starts, ignoring case and diacritics', () => {
    expect(labels('slozka')[0]).toBe('Nová složka')
    expect(labels('tab')[0]).toBe('Nový tab')
    expect(labels('skryt')[0]).toBe('Zobrazit skryté soubory')
  })

  it('matches scattered letters (fuzzy)', () => {
    expect(labels('nvsl')).toContain('Nová složka')
  })

  it('finds commands by group and keywords, below label matches', () => {
    expect(labels('theme')).toEqual(['Vzhled: Moderní (macOS)'])
    expect(labels('downloads')).toEqual(['Přejít: Stažené'])
    const r = rankCommands(commands, 'theme')[0]
    expect(r.hits).toEqual([])
  })

  it('underlines the matched label characters', () => {
    expect(rankCommands(commands, 'tab')[0].hits).toEqual([5, 6, 7])
  })
})
