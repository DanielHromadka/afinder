import { describe, expect, it } from 'vitest'
import { canEditImage, dragRect, editedCopyName, filterString, imageOutput, NEUTRAL, rotatedSize, scaledSize } from './imageEdit'

describe('imageEdit', () => {
  it('opens images the browser can draw', () => {
    expect(canEditImage('Photo.JPG')).toBe(true)
    expect(canEditImage('logo.svg')).toBe(true)
    expect(canEditImage('scan.tiff')).toBe(false)
    expect(canEditImage('IMG_0001.HEIC')).toBe(false)
  })

  it('overwrites only formats it can encode', () => {
    expect(imageOutput('a.jpeg')).toEqual({ mime: 'image/jpeg', ext: 'jpeg', overwrite: true })
    expect(imageOutput('a.webp').overwrite).toBe(true)
    expect(imageOutput('anim.gif')).toEqual({ mime: 'image/png', ext: 'png', overwrite: false })
    expect(imageOutput('logo.svg').ext).toBe('png')
  })

  it('names copies after the first free slot', () => {
    const taken = new Set(['photo (edited).jpg', 'photo (edited 2).jpg'])
    expect(editedCopyName('photo.jpg', 'jpg', 'edited', (n) => taken.has(n))).toBe('photo (edited 3).jpg')
    expect(editedCopyName('logo.svg', 'png', 'upraveno', () => false)).toBe('logo (upraveno).png')
    expect(editedCopyName('.hidden', 'png', 'edited', () => false)).toBe('.hidden (edited).png')
  })

  it('normalizes and clamps drag rectangles', () => {
    expect(dragRect(50, 40, 10, 5, 100, 100)).toEqual({ x: 10, y: 5, width: 40, height: 35 })
    expect(dragRect(-20, -20, 300, 30.6, 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 31 })
  })

  it('swaps sides on odd quarter turns', () => {
    expect(rotatedSize(400, 300, 1)).toEqual({ width: 300, height: 400 })
    expect(rotatedSize(400, 300, -1)).toEqual({ width: 300, height: 400 })
    expect(rotatedSize(400, 300, 2)).toEqual({ width: 400, height: 300 })
  })

  it('scales keeping the aspect ratio', () => {
    expect(scaledSize(4000, 3000, 800)).toEqual({ width: 800, height: 600 })
    expect(scaledSize(1000, 1, 10)).toEqual({ width: 10, height: 1 })
  })

  it('builds a canvas filter only when something changes', () => {
    expect(filterString(NEUTRAL)).toBe('none')
    expect(filterString({ ...NEUTRAL, brightness: 120, invert: true })).toBe('brightness(120%) contrast(100%) saturate(100%) hue-rotate(0deg) invert(1)')
  })
})
