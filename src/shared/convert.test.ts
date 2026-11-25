import { describe, expect, it } from 'vitest'
import { convertedName, convertKind, convertTargets } from './convert'

describe('convert', () => {
  it('tells images and videos apart', () => {
    expect(convertKind('IMG_0001.HEIC')).toBe('image')
    expect(convertKind('clip.MKV')).toBe('video')
    expect(convertKind('notes.txt')).toBeNull()
  })

  it('offers the other formats of one kind', () => {
    expect(convertTargets(['a.png'])).toEqual({ kind: 'image', targets: ['jpg', 'webp'] })
    expect(convertTargets(['a.jpeg', 'b.jpg'])).toEqual({ kind: 'image', targets: ['png', 'webp'] })
    expect(convertTargets(['a.heic'])).toEqual({ kind: 'image', targets: ['png', 'jpg', 'webp'] })
    expect(convertTargets(['a.png', 'b.webp'])).toEqual({ kind: 'image', targets: ['png', 'jpg', 'webp'] })
    expect(convertTargets(['clip.m4v'])).toEqual({ kind: 'video', targets: ['webm', 'mov'] })
    expect(convertTargets(['a.png', 'clip.mp4'])).toBeNull()
    expect(convertTargets(['a.txt'])).toBeNull()
    expect(convertTargets([])).toBeNull()
  })

  it('picks a free name next to the original', () => {
    const taken = new Set(['clip.mp4', 'clip 2.mp4'])
    expect(convertedName('clip.mov', 'mp4', (n) => taken.has(n))).toBe('clip 3.mp4')
    expect(convertedName('photo.heic', 'jpg', () => false)).toBe('photo.jpg')
  })
})
