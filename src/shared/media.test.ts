import { describe, expect, it } from 'vitest'
import { channelsLabel, codecLabel, formatBitrate, formatDuration, formatFps, timeForName, addPeaks, remix } from './media'

describe('media formatting', () => {
  it('names codecs', () => {
    expect(codecLabel('avc')).toBe('H.264')
    expect(codecLabel('pcm-s16')).toBe('PCM s16')
    expect(codecLabel('pcm-s24be')).toBe('PCM s24 BE')
    expect(codecLabel('xyz')).toBe('XYZ')
    expect(codecLabel(null)).toBeUndefined()
  })
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(75.9)).toBe('1:15')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(NaN)).toBe('')
  })
  it('formats bit rates, frame rates and channels', () => {
    expect(formatBitrate(320_000)).toBe('320 kb/s')
    expect(formatBitrate(12_400_000)).toBe('12.4 Mb/s')
    expect(formatBitrate(0)).toBe('')
    expect(formatFps(29.97002997)).toBe('29.97 fps')
    expect(channelsLabel(6)).toBe('5.1')
    expect(timeForName(65.4)).toBe('1m05s')
    expect(timeForName(3725)).toBe('1h02m05s')
  })
  it('collects waveform peaks per bucket', () => {
    const peaks = new Float32Array(4)
    // 4 s at 2 samples per second: one bucket per second.
    addPeaks(peaks, 4, 0, 2, Float32Array.from([0.1, -0.5, 0.2, 0.3]))
    addPeaks(peaks, 4, 2, 2, Float32Array.from([-0.9, 0, 2, 0.4, 7]))
    expect([...peaks].map((x) => Number(x.toFixed(2)))).toEqual([0.5, 0.3, 0.9, 1])
  })
  it('remixes channels and resamples', () => {
    const mono = Float32Array.from([0, 1, 0, -1])
    expect(remix([mono], 4, 4, 2).map((p) => [...p])).toEqual([[0, 1, 0, -1], [0, 1, 0, -1]])
    expect([...remix([Float32Array.from([1, 1]), Float32Array.from([0, 0])], 2, 2, 1)[0]]).toEqual([0.5, 0.5])
    const up = remix([Float32Array.from([0, 1])], 1, 2, 1)[0]
    expect([...up]).toEqual([0, 0.5, 1, 1])
    expect(remix([mono], 4, 2, 1)[0].length).toBe(2)
  })
})
