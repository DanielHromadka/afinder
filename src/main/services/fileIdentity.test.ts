import { mkdtemp, rm, writeFile, link, symlink, rename, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { identity, sameIdentity, takenByAnother } from './fileIdentity'

const dirs: string[] = []
const tmp = async (): Promise<string> => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'afinder-identity-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

/** Whether the temp disk tells names apart by case (Linux, case-sensitive APFS) – decides which case runs. */
async function caseSensitive(dir: string): Promise<boolean> {
  await writeFile(path.join(dir, 'probe'), '')
  return (await identity(path.join(dir, 'PROBE'))) === null
}

describe('file identity for renames', () => {
  it('tells two different files apart and finds an item by its own path', async () => {
    const d = await tmp()
    await writeFile(path.join(d, 'a.txt'), 'a')
    await writeFile(path.join(d, 'b.txt'), 'b')
    expect(await takenByAnother(path.join(d, 'a.txt'), path.join(d, 'b.txt'))).toBe(true)
    expect(await takenByAnother(path.join(d, 'a.txt'), path.join(d, 'free.txt'))).toBe(false)
    expect(await takenByAnother(path.join(d, 'a.txt'), path.join(d, 'a.txt'))).toBe(false)
  })

  it('treats hard links as one item and a symlink as its own', async () => {
    const d = await tmp()
    await writeFile(path.join(d, 'a.txt'), 'a')
    await link(path.join(d, 'a.txt'), path.join(d, 'hard.txt'))
    await symlink(path.join(d, 'a.txt'), path.join(d, 'soft.txt'))
    const [a, hard, soft] = await Promise.all(['a.txt', 'hard.txt', 'soft.txt'].map((n) => identity(path.join(d, n))))
    expect(sameIdentity(a!, hard!)).toBe(true)
    expect(sameIdentity(a!, soft!)).toBe(false)
  })

  it('allows a case-only rename only where the new name is the item itself', async () => {
    const d = await tmp()
    if (await caseSensitive(d)) {
      // The reported data loss: foto.txt → FOTO.txt next to an existing FOTO.txt.
      await writeFile(path.join(d, 'foto.txt'), 'mine')
      await writeFile(path.join(d, 'FOTO.txt'), 'theirs')
      expect(await takenByAnother(path.join(d, 'foto.txt'), path.join(d, 'FOTO.txt'))).toBe(true)
      expect(await readFile(path.join(d, 'FOTO.txt'), 'utf8')).toBe('theirs')
    } else {
      await writeFile(path.join(d, 'foto.txt'), 'mine')
      expect(await takenByAnother(path.join(d, 'foto.txt'), path.join(d, 'FOTO.txt'))).toBe(false)
      await rename(path.join(d, 'foto.txt'), path.join(d, 'FOTO.txt'))
      expect(await readFile(path.join(d, 'FOTO.txt'), 'utf8')).toBe('mine')
    }
  })

  it('compares by canonical path where the disk has no inode numbers', () => {
    const base = { dev: 1n, ino: 0n }
    expect(sameIdentity({ ...base, real: '/v/Foto.txt' }, { ...base, real: '/v/Foto.txt' })).toBe(true)
    expect(sameIdentity({ ...base, real: '/v/Foto.txt' }, { ...base, real: '/v/FOTO.txt' })).toBe(false)
    expect(sameIdentity({ dev: 1n, ino: 5n, real: '/a' }, { dev: 2n, ino: 5n, real: '/a' })).toBe(false)
  })
})
