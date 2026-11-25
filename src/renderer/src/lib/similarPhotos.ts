// The renderer half of the similar photos search: the worker lists the photos below a folder, this draws
// each one at 9×8 pixels (Chromium's decoders, or the OS for HEIC and the like) and hashes it.

import { dHash, greyOf } from '@shared/phash'
import { baseName } from '@shared/paths'
import type { ImageFile } from '@shared/types'
import { renderPicture } from './thumbnails'

/** The photo's difference hash, or null when it cannot be drawn. */
export async function hashPhoto(file: ImageFile): Promise<[number, number] | null> {
  const picture = await renderPicture({ path: file.path, name: baseName(file.path), size: file.size }, 64, 64).catch(() => null)
  if (!picture) return null
  const small = new OffscreenCanvas(9, 8)
  const ctx = small.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(picture, 0, 0, 9, 8)
  return dHash(greyOf(ctx.getImageData(0, 0, 9, 8).data))
}
