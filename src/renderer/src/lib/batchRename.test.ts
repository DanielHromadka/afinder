import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, newNames, problems, splitName, type RenameOptions } from './batchRename'

const files = (...names: string[]): { name: string; isDir: boolean }[] => names.map((name) => ({ name, isDir: false }))
const opts = (o: Partial<RenameOptions>): RenameOptions => ({ ...DEFAULT_OPTIONS, ...o })

describe('batch rename', () => {
  it('splits extensions, not dot files or folders', () => {
    expect(splitName('report.final.pdf', false)).toEqual(['report.final', '.pdf'])
    expect(splitName('.zshrc', false)).toEqual(['.zshrc', ''])
    expect(splitName('v1.2', true)).toEqual(['v1.2', ''])
  })

  it('replaces text, case-insensitively by default, leaving the extension alone', () => {
    expect(newNames(files('IMG_001.JPG', 'img_002.jpg'), opts({ find: 'img_', replace: 'Lisbon ' }))).toEqual(['Lisbon 001.JPG', 'Lisbon 002.jpg'])
    expect(newNames(files('a.txt.txt'), opts({ find: 'txt', replace: 'md' }))).toEqual(['a.md.txt'])
    expect(newNames(files('a.txt'), opts({ find: 'txt', replace: 'md', keepExtension: false }))).toEqual(['a.md'])
  })

  it('supports regular expressions with groups', () => {
    expect(newNames(files('2026-10-08 notes.md'), opts({ find: '(\\d{4})-(\\d{2})-(\\d{2})', replace: '$3.$2.$1', regex: true }))).toEqual([
      '08.10.2026 notes.md'
    ])
    // An invalid pattern leaves names unchanged (the dialog reports it).
    expect(newNames(files('a.txt'), opts({ find: '(', regex: true }))).toEqual(['a.txt'])
  })

  it('adds text and numbers items', () => {
    expect(newNames(files('a.txt', 'b.txt'), opts({ mode: 'add', text: 'draft-', position: 'before' }))).toEqual(['draft-a.txt', 'draft-b.txt'])
    expect(newNames(files('x.jpg', 'y.png', 'z.jpg'), opts({ mode: 'format', base: 'Trip', start: 9, digits: 2 }))).toEqual([
      'Trip 09.jpg',
      'Trip 10.png',
      'Trip 11.jpg'
    ])
  })

  it('changes case', () => {
    expect(newNames(files('quarterly REPORT-final.PDF'), opts({ caseChange: 'title' }))).toEqual(['Quarterly Report-Final.PDF'])
    expect(newNames(files('Žluťoučký.txt'), opts({ caseChange: 'upper' }))).toEqual(['ŽLUŤOUČKÝ.txt'])
  })

  it('finds problems before renaming', () => {
    const old = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']
    expect(problems(old, ['x.txt', 'X.TXT', 'c/d.txt', '', 'other.txt'], ['other.txt'], 'darwin')).toEqual([
      'duplicate',
      'duplicate',
      'invalid',
      'empty',
      'exists'
    ])
    // Swapping two names within the batch is fine.
    expect(problems(['a', 'b'], ['b', 'a'], [], 'darwin')).toEqual([null, null])
    expect(problems(['a'], ['what?'], [], 'win32')).toEqual(['invalid'])
    expect(problems(['a'], ['A'], [], 'darwin')).toEqual([null]) // case-only rename
  })

  it('uses AI suggestions and keeps the original extensions', () => {
    const ai = opts({ mode: 'ai' })
    expect(newNames(files('IMG_1.JPG', 'scan.pdf', 'x.txt'), ai, 'cs', ['Lisabon 2026.jpeg', 'Smlouva.pdf'])).toEqual(['Lisabon 2026.JPG', 'Smlouva.pdf', 'x.txt'])
    expect(newNames(files('IMG_1.JPG'), { ...ai, keepExtension: false }, 'cs', ['Lisabon.jpeg'])).toEqual(['Lisabon.jpeg'])
  })
})
