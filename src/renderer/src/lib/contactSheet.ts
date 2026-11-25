// A contact sheet: the chosen photos and video frames in a grid with their names, drawn into one image.

import { SHEET_LABEL, SHEET_PAD, sheetCapacity, sheetLayout, shortName, type SheetOptions } from '@shared/contactSheet'
import { t } from '@shared/i18n'
import type { FileEntry } from '@shared/types'
import { renderPicture } from './thumbnails'

export async function contactSheet(entries: FileEntry[], title: string, o: SheetOptions, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Uint8Array> {
  if (entries.length > sheetCapacity(o)) throw new Error(t('contact.tooMany', { n: sheetCapacity(o) }))
  const layout = sheetLayout(entries.length, o)
  const canvas = new OffscreenCanvas(layout.width, layout.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.fillStyle = '#000'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, SHEET_PAD, 18, layout.width - 2 * SHEET_PAD)
  ctx.font = '12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  const maxChars = Math.max(8, Math.floor(o.thumbWidth / 7))
  for (let i = 0; i < entries.length; i++) {
    signal.throwIfAborted()
    const { x, y } = layout.cells[i]
    const picture = await renderPicture(entries[i], o.thumbWidth, layout.thumbHeight).catch(() => null)
    if (picture) {
      // Centred in its box.
      ctx.drawImage(picture, x + (o.thumbWidth - picture.width) / 2, y + (layout.thumbHeight - picture.height) / 2)
    } else {
      ctx.strokeStyle = '#ccc'
      ctx.strokeRect(x + 0.5, y + 0.5, o.thumbWidth - 1, layout.thumbHeight - 1)
    }
    if (o.names) {
      ctx.fillStyle = '#333'
      ctx.fillText(shortName(entries[i].name, maxChars), x + o.thumbWidth / 2, y + layout.thumbHeight + SHEET_LABEL / 2 + 2, o.thumbWidth)
    }
    onProgress((i + 1) / entries.length)
  }
  const blob = await canvas.convertToBlob(o.format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 })
  return new Uint8Array(await blob.arrayBuffer())
}
