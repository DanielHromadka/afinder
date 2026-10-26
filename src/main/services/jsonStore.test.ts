import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJsonFile, writeJsonFile } from './jsonStore'

const dirs: string[] = []
const tmp = async (): Promise<string> => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'afinder-json-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('json store', () => {
  it('writes through a temporary file and reads back', async () => {
    const d = await tmp()
    const file = path.join(d, 'settings.json')
    writeJsonFile(file, { theme: 'xp' })
    expect(readJsonFile(file)).toEqual({ status: 'ok', value: { theme: 'xp' } })
    expect(await readdir(d)).toEqual(['settings.json'])
  })

  it('tells a missing file from a broken one and keeps the broken one aside', async () => {
    const d = await tmp()
    const file = path.join(d, 'settings.json')
    expect(readJsonFile(file)).toEqual({ status: 'missing' })
    await writeFile(file, '{"theme": "xp"')
    const read = readJsonFile(file)
    expect(read.status).toBe('corrupt')
    const backup = read.status === 'corrupt' ? read.backup : null
    expect(backup && (await readFile(backup, 'utf8'))).toBe('{"theme": "xp"')
    expect((await readdir(d)).some((f) => f === 'settings.json')).toBe(false)
  })

  it('throws when it cannot write and leaves the old file and no temporary behind', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const d = await tmp()
    const file = path.join(d, 'settings.json')
    writeJsonFile(file, { a: 1 })
    await chmod(d, 0o500)
    try {
      expect(() => writeJsonFile(file, { a: 2 })).toThrow()
    } finally {
      await chmod(d, 0o700)
    }
    expect(readJsonFile(file)).toEqual({ status: 'ok', value: { a: 1 } })
    expect(await readdir(d)).toEqual(['settings.json'])
  })
})
