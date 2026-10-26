import { describe, expect, it } from 'vitest'
import { autoMode, batchMode } from './transferMode'

const disk = (dev: number) => ({ connection: null, dev })
const server = (id: string) => ({ connection: id, dev: null })

describe('auto transfer mode', () => {
  it('moves within a volume or a connection and copies across them', () => {
    expect(autoMode(disk(1), disk(1))).toBe('move')
    expect(autoMode(disk(2), disk(1))).toBe('copy')
    expect(autoMode(server('a'), server('a'))).toBe('move')
    expect(autoMode(server('a'), server('b'))).toBe('copy')
    expect(autoMode(disk(1), server('a'))).toBe('copy')
    expect(autoMode(server('a'), disk(1))).toBe('copy')
  })

  it('decides each item of a mixed batch on its own; the batch reads as copying', () => {
    const dest = disk(1)
    const modes = [disk(1), disk(2), server('a')].map((src) => autoMode(src, dest))
    expect(modes).toEqual(['move', 'copy', 'copy'])
    expect(batchMode(modes)).toBe('copy')
    expect(batchMode(['move', 'move'])).toBe('move')
  })
})
