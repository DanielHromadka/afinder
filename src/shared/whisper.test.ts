import { describe, expect, it } from 'vitest'
import { logMel, melFilters, nextToken, segmentsOf, srtTime, toSrt, toText, type TokenIds } from './whisper'

const ids: TokenIds = { endOfText: 10, timestampBegin: 20, suppress: new Set([11]), beginSuppress: new Set([5]) }
const logits = (hot: number, size = 100): Float32Array => {
  const l = new Float32Array(size).fill(-5)
  l[hot] = 5
  return l
}

describe('whisper features', () => {
  it('builds Slaney mel filters like librosa', () => {
    const f = melFilters(80)
    expect(f.length).toBe(80 * 201)
    // Each filter is a triangle: some positive weights, none negative.
    for (let m = 0; m < 80; m++) {
      const row = f.subarray(m * 201, (m + 1) * 201)
      expect(Math.max(...row)).toBeGreaterThan(0)
      expect(Math.min(...row)).toBeGreaterThanOrEqual(0)
    }
    // librosa.filters.mel(sr=16000, n_fft=400, n_mels=80)[0, 1] ≈ 0.02486.
    expect(f[1]).toBeCloseTo(0.02486, 3)
  })
  it('makes 80 × 3000 values in the expected range', () => {
    const tone = Float32Array.from({ length: 16000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5)
    const mel = logMel(tone, melFilters(80), 80)
    expect(mel.length).toBe(80 * 3000)
    let max = -Infinity
    let min = Infinity
    for (const v of mel) {
      max = Math.max(max, v)
      min = Math.min(min, v)
    }
    expect(max).toBeLessThanOrEqual(1.5)
    expect(min).toBeGreaterThanOrEqual(max - 2.01)
  })
})

describe('whisper decoding', () => {
  it('starts with a timestamp near the start', () => {
    expect(nextToken(logits(3), [], ids)).toBeGreaterThanOrEqual(20)
    expect(nextToken(logits(90), [], ids)).toBeLessThanOrEqual(70)
  })
  it('pairs timestamps and never goes back', () => {
    // After an opening timestamp no further timestamp before text… unless it closes after text.
    expect(nextToken(logits(25), [22], ids)).toBeLessThan(20)
    // After text, a timestamp may close, but not before the opening one.
    expect(nextToken(logits(21), [22, 3], ids)).not.toBe(21)
    expect(nextToken(logits(30), [22, 3], ids)).toBe(30)
    // After a closing pair: text or a new opening timestamp at or after the close.
    expect(nextToken(logits(28), [22, 3, 30], ids)).toBeGreaterThanOrEqual(30)
    expect(nextToken(logits(11), [22, 3], ids)).not.toBe(11)
  })
  it('turns tokens into segments and SRT', () => {
    const text = (t: number[]): string => t.map((x) => String.fromCharCode(96 + x)).join('')
    const segs = segmentsOf([20, 1, 2, 70, 70, 3, 4], 20, 30, 30, text)
    expect(segs).toEqual([
      { start: 30, end: 31, text: 'ab' },
      { start: 31, end: 60, text: 'cd' }
    ])
    expect(srtTime(3723.4567)).toBe('01:02:03,457')
    expect(toSrt(segs)).toBe('1\n00:00:30,000 --> 00:00:31,000\nab\n\n2\n00:00:31,000 --> 00:01:00,000\ncd\n')
    expect(toText([{ start: 0, end: 1, text: 'Ahoj. Jak' }, { start: 1, end: 2, text: 'se máš?' }])).toBe('Ahoj.\nJak se máš?\n')
  })
})
