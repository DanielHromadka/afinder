// Image conversion in the renderer, shared by the Tools converter and the context menu's "Convert to".

import { baseName, dirOf } from '@shared/paths'
import { previewUrl } from '@shared/preview'

const api = window.api

export const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

/** Chromium decodes most formats itself; HEIC, TIFF and the like go through the system (main). */
export async function decodeImage(path: string): Promise<ImageBitmap> {
  try {
    const res = await fetch(previewUrl(path))
    if (!res.ok) throw new Error(String(res.status))
    return await createImageBitmap(await res.blob())
  } catch {
    const png = await api.tools.decodeImage(path)
    return createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
  }
}

/** Draws the bitmap at w×h and encodes it; JPEG has no transparency, so white instead of black. */
export async function encodeImage(bitmap: ImageBitmap, w: number, h: number, ext: string, quality: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  if (ext === 'jpg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await canvas.convertToBlob({ type: IMAGE_MIME[ext], quality })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Converts the image at path to png, jpg or webp at full size, as `name.<ext>` next to it. Returns the new path. */
export async function convertImage(path: string, ext: string): Promise<string> {
  const bitmap = await decodeImage(path)
  try {
    const data = await encodeImage(bitmap, bitmap.width, bitmap.height, ext, 0.92)
    return await api.tools.saveImage(dirOf(path), `${baseName(path).replace(/\.[^.]+$/, '')}.${ext}`, data)
  } finally {
    bitmap.close()
  }
}
