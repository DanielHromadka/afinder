import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createZstdDecompress } from 'node:zlib'
import * as tar from 'tar-stream'
import * as yauzl from 'yauzl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArchiveFormat } from '@shared/archive'
import { writeArchive } from './archiveWriter'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-archive-'))
  await mkdir(path.join(dir, 'project/src'), { recursive: true })
  await mkdir(path.join(dir, 'project/empty'))
  await writeFile(path.join(dir, 'project/readme.txt'), 'hello '.repeat(1000))
  await writeFile(path.join(dir, 'project/src/main.ts'), 'export {}\n')
  if (process.platform !== 'win32') await symlink('readme.txt', path.join(dir, 'project/link'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

/** Member name → file content (null for folders, "-> target" for symlinks). */
async function read(file: string, format: ArchiveFormat): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>()
  const text = async (s: NodeJS.ReadableStream): Promise<string> => {
    const chunks: Buffer[] = []
    for await (const c of s) chunks.push(c as Buffer)
    return Buffer.concat(chunks).toString()
  }
  if (format === 'zip') {
    const zip = await yauzl.openPromise(file)
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName.endsWith('/')) found.set(entry.fileName.slice(0, -1), null)
      else {
        const body = await text(await zip.openReadStreamPromise(entry))
        found.set(entry.fileName, (entry.externalFileAttributes >>> 16) >> 12 === 0o12 ? `-> ${body}` : body)
      }
    }
    zip.close()
    return found
  }
  const source = createReadStream(file)
  const extract = tar.extract()
  const done = pipeline(format === 'tgz' ? source.pipe(createGunzip()) : format === 'tzst' ? source.pipe(createZstdDecompress()) : source, extract)
  for await (const entry of extract) {
    const h = entry.header
    found.set(h.name, h.type === 'directory' ? null : h.type === 'symlink' ? `-> ${h.linkname}` : await text(entry as unknown as NodeJS.ReadableStream))
  }
  await done
  return found
}

describe('writeArchive', () => {
  for (const format of ['zip', 'tgz', 'tzst', 'tar'] as const) {
    it(`packs a folder as ${format} with its structure, contents and symlinks`, async () => {
      const target = path.join(dir, `out.${format}`)
      const events: number[] = []
      expect(await writeArchive({ sources: [path.join(dir, 'project')], target, format, level: 'normal' }, { cancelled: false }, (p) => events.push(p.done))).toBe(true)
      const members = await read(target, format)
      expect(members.get('project')).toBeNull()
      expect(members.get('project/empty')).toBeNull()
      expect(members.get('project/readme.txt')).toBe('hello '.repeat(1000))
      expect(members.get('project/src/main.ts')).toBe('export {}\n')
      if (process.platform !== 'win32') expect(members.get('project/link')).toBe('-> readme.txt')
      expect(events.at(-1)).toBe(2)
    })
  }

  it('stores zip members uncompressed at the store level', async () => {
    const stored = path.join(dir, 'stored.zip')
    const packed = path.join(dir, 'packed.zip')
    const sources = [path.join(dir, 'project/readme.txt')]
    await writeArchive({ sources, target: stored, format: 'zip', level: 'store' }, { cancelled: false }, () => {})
    await writeArchive({ sources, target: packed, format: 'zip', level: 'max' }, { cancelled: false }, () => {})
    expect((await stat(stored)).size).toBeGreaterThan(6000)
    expect((await stat(packed)).size).toBeLessThan(500)
  })

  it('skips the archive itself when it is written into a folder being archived', async () => {
    const target = path.join(dir, 'project/self.zip')
    await writeArchive({ sources: [path.join(dir, 'project')], target, format: 'zip', level: 'fast' }, { cancelled: false }, () => {})
    expect([...(await read(target, 'zip')).keys()]).not.toContain('project/self.zip')
  })

  it('never overwrites an existing file', async () => {
    const target = path.join(dir, 'taken.zip')
    await writeFile(target, 'keep')
    await expect(writeArchive({ sources: [path.join(dir, 'project')], target, format: 'zip', level: 'fast' }, { cancelled: false }, () => {})).rejects.toThrow()
    expect((await stat(target)).size).toBe(4)
  })

  it('removes the partial archive when cancelled', async () => {
    const control = { cancelled: false }
    const target = path.join(dir, 'cancel.tar.gz')
    const result = await writeArchive({ sources: [path.join(dir, 'project')], target, format: 'tgz', level: 'fast' }, control, (p) => {
      if (p.current) control.cancelled = true
    })
    expect(result).toBe(false)
    expect(await readdir(dir)).not.toContain('cancel.tar.gz')
  })

  it('renames items that share a name', async () => {
    await mkdir(path.join(dir, 'other'))
    await writeFile(path.join(dir, 'other/readme.txt'), 'second')
    const target = path.join(dir, 'both.tar')
    const sources = [path.join(dir, 'project/readme.txt'), path.join(dir, 'other/readme.txt')]
    await writeArchive({ sources, target, format: 'tar', level: 'normal' }, { cancelled: false }, () => {})
    expect((await read(target, 'tar')).get('readme.txt 2')).toBe('second')
  })
})
