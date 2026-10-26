import { describe, expect, it } from 'vitest'
import { archiveFormat, isInsideArchive, memberSegments, splitArchivePath, withArchiveExtension, levelsFor, compressionLevel } from './archive'

describe('archives', () => {
  it('recognizes formats', () => {
    expect(archiveFormat('photos.ZIP')).toBe('zip')
    expect(archiveFormat('src.tar.gz')).toBe('tgz')
    expect(archiveFormat('src.tgz')).toBe('tgz')
    expect(archiveFormat('backup.tar')).toBe('tar')
    expect(archiveFormat('lib.jar')).toBe('zip')
    expect(archiveFormat('.zip')).toBeNull()
    expect(archiveFormat('notes.gz')).toBeNull()
  })

  it('splits paths at the archive', () => {
    expect(splitArchivePath('/Users/alex/photos.zip')).toEqual({ archive: '/Users/alex/photos.zip', inner: [] })
    expect(splitArchivePath('/Users/alex/photos.zip/2026/a.jpg')).toEqual({ archive: '/Users/alex/photos.zip', inner: ['2026', 'a.jpg'] })
    expect(splitArchivePath('C:\\Users\\alex\\src.tar.gz\\lib')).toEqual({ archive: 'C:\\Users\\alex\\src.tar.gz', inner: ['lib'] })
    expect(splitArchivePath('/Users/alex/Documents')).toBeNull()
    expect(isInsideArchive('/a/b.zip')).toBe(false)
    expect(isInsideArchive('/a/b.zip/c')).toBe(true)
  })

  it('rejects member names that escape the archive', () => {
    expect(memberSegments('a/./b/c.txt')).toEqual(['a', 'b', 'c.txt'])
    expect(memberSegments('dir\\file.txt')).toEqual(['dir', 'file.txt'])
    expect(memberSegments('../etc/passwd')).toBeNull()
    expect(memberSegments('/etc/passwd')).toBeNull()
    expect(memberSegments('C:/Windows/x')).toBeNull()
  })

  it('recognizes zstd tarballs', () => {
    expect(archiveFormat('src.tar.zst')).toBe('tzst')
    expect(archiveFormat('src.tzst')).toBe('tzst')
  })

  it('swaps or appends the archive extension', () => {
    expect(withArchiveExtension('photos', 'zip')).toBe('photos.zip')
    expect(withArchiveExtension('photos.zip', 'tgz')).toBe('photos.tar.gz')
    expect(withArchiveExtension('photos.tar.gz', 'tzst')).toBe('photos.tar.zst')
    expect(withArchiveExtension('notes.txt', 'tar')).toBe('notes.txt.tar')
    expect(withArchiveExtension('.zip', 'tar')).toBe('.zip.tar')
  })

  it('offers only meaningful compression levels', () => {
    expect(levelsFor('tar')).toEqual([])
    expect(levelsFor('zip')).toContain('store')
    expect(levelsFor('tgz')).not.toContain('store')
    expect(compressionLevel('zip', 'store')).toBe(0)
    expect(compressionLevel('tzst', 'max')).toBe(19)
  })
})
