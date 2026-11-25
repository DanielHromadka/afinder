import { describe, expect, it } from 'vitest'
import { addCut, canCutVideo, formatVideoTime, isUncut, keptSpans, normalizeSpans, skipTarget, totalLength } from './videoCut'

describe('videoCut', () => {
  it('opens containers it can write back', () => {
    expect(canCutVideo('Clip.MP4')).toBe(true)
    expect(canCutVideo('screen.mov')).toBe(true)
    expect(canCutVideo('talk.webm')).toBe(true)
    expect(canCutVideo('old.ogv')).toBe(false)
    expect(canCutVideo('movie.avi')).toBe(false)
  })

  it('merges, sorts and clamps cut pieces', () => {
    expect(normalizeSpans([{ start: 8, end: 5 }, { start: 1, end: 3 }, { start: 2, end: 4 }, { start: 9, end: 20 }], 10)).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 8 },
      { start: 9, end: 10 }
    ])
    expect(normalizeSpans([{ start: 3, end: 3.01 }], 10)).toEqual([])
    expect(addCut([{ start: 1, end: 2 }], { start: 2, end: 3 }, 10)).toEqual([{ start: 1, end: 3 }])
  })

  it('keeps what lies between the trimmed ends and outside the cuts', () => {
    const edit = { trim: { start: 1, end: 9 }, cuts: [{ start: 3, end: 4 }, { start: 0, end: 2 }, { start: 8.5, end: 12 }] }
    const kept = keptSpans(edit, 10)
    expect(kept).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 8.5 }
    ])
    expect(totalLength(kept)).toBe(5.5)
    expect(keptSpans({ trim: { start: 0, end: 10 }, cuts: [{ start: 0, end: 10 }] }, 10)).toEqual([])
  })

  it('tells playback where to jump over removed parts', () => {
    const edit = { trim: { start: 1, end: 9 }, cuts: [{ start: 3, end: 4 }] }
    expect(skipTarget(edit, 10, 0.5)).toBe(1)
    expect(skipTarget(edit, 10, 2)).toBeNull()
    expect(skipTarget(edit, 10, 3.2)).toBe(4)
    expect(skipTarget(edit, 10, 9.5)).toBeNull()
  })

  it('knows an untouched edit', () => {
    expect(isUncut({ trim: { start: 0, end: 10 }, cuts: [] }, 10)).toBe(true)
    expect(isUncut({ trim: { start: 0, end: 10 }, cuts: [{ start: 4, end: 5 }] }, 10)).toBe(false)
    expect(isUncut({ trim: { start: 1, end: 10 }, cuts: [] }, 10)).toBe(false)
  })

  it('formats times with tenths', () => {
    expect(formatVideoTime(0)).toBe('0:00.0')
    expect(formatVideoTime(75.25)).toBe('1:15.2')
    expect(formatVideoTime(3725)).toBe('1:02:05.0')
  })
})
