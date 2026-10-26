// Screenshots: the native interactive tool on macOS, Electron's desktopCapturer elsewhere (the whole
// display under the cursor – the region or window is then cut out in the image editor).

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, constants, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, nativeImage, screen } from 'electron'
import { t } from '@shared/i18n'
import { screenshotName } from '@shared/recents'
import type { ScreenshotMode, ScreenshotResult } from '@shared/types'
import { validatePath } from './fileSystem'
import { isMas } from '../mas'
import * as vfs from './vfs'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The current folder when it is local and writable, else Pictures. */
async function targetFolder(folder: unknown): Promise<string> {
  try {
    const dir = validatePath(folder)
    if ((await vfs.locate(dir)).kind === 'local') {
      await access(dir, constants.W_OK)
      return dir
    }
  } catch {
    // fall through to Pictures
  }
  return isMas ? path.join(os.homedir(), 'Pictures') : app.getPath('pictures')
}

export async function capture(folder: unknown, mode: unknown): Promise<ScreenshotResult | null> {
  const kind: ScreenshotMode = mode === 'window' || mode === 'screen' ? mode : 'region'
  const dir = await targetFolder(folder)
  const target = path.join(dir, screenshotName(t('screenshot.fileName'), new Date(), (n) => existsSync(path.join(dir, n))))
  // aFinder steps out of the picture and comes back afterwards.
  const shown = BrowserWindow.getAllWindows().filter((w) => w.isVisible() && !w.isMinimized())
  const focused = BrowserWindow.getFocusedWindow()
  for (const w of shown) w.hide()
  await sleep(process.platform === 'darwin' ? 250 : 400) // let the window animations finish
  try {
    if (process.platform === 'darwin') {
      const args = kind === 'region' ? ['-i', '-x'] : kind === 'window' ? ['-i', '-W', '-x'] : ['-x', '-m']
      await new Promise<void>((resolve, reject) => execFile('/usr/sbin/screencapture', [...args, target], (err) => (err ? reject(err) : resolve())))
      // Esc in the interactive mode exits cleanly without a file.
      return existsSync(target) ? { path: target, crop: false } : null
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error(t('screenshot.failed'))
    await writeFile(target, source.thumbnail.toPNG(), { flag: 'wx' })
    return { path: target, crop: kind !== 'screen' }
  } finally {
    for (const w of shown) w.show()
    focused?.focus()
  }
}

/** Puts an image file on the clipboard as a picture (not as a path). */
export async function copyImage(p: unknown): Promise<void> {
  const image = nativeImage.createFromPath(validatePath(p))
  if (image.isEmpty()) throw new Error(t('screenshot.failed'))
  const png = image.toPNG()
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
}
