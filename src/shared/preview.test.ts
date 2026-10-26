import { describe, expect, it } from 'vitest'
import { looksLikeText, parseRange, sniffable, pathFromPreviewUrl, previewKind, previewUrl, textLanguage } from './preview'

describe('preview', () => {
  it('picks a viewer by name', () => {
    expect(previewKind('Photo.JPG')).toBe('image')
    expect(previewKind('logo.svg')).toBe('image')
    expect(previewKind('Tax return.pdf')).toBe('pdf')
    expect(previewKind('clip.mov')).toBe('video')
    expect(previewKind('Robot.GLB')).toBe('model')
    expect(previewKind('bracket.stl')).toBe('model')
    expect(previewKind('part.3mf')).toBe('model')
    expect(previewKind('song.flac')).toBe('audio')
    expect(previewKind('Report.docx')).toBe('docx')
    expect(previewKind('Budget.xlsx')).toBe('sheet')
    expect(previewKind('index.ts')).toBe('text')
    expect(previewKind('Dockerfile')).toBe('text')
    expect(previewKind('.zshrc')).toBe('text')
    expect(previewKind('Deck.pptx')).toBe('thumbnail')
    expect(previewKind('Notes.rtf')).toBe('thumbnail')
    expect(previewKind('archive.zip')).toBe('thumbnail')
    expect(previewKind('noextension')).toBe('thumbnail')
  })

  it('sniffs only unknown types', () => {
    expect(sniffable('build.output')).toBe(true)
    expect(sniffable('Notes.rtf')).toBe(false)
    expect(sniffable('photo.png')).toBe(false)
  })

  it('maps names to editor languages', () => {
    expect(textLanguage('App.tsx')).toBe('typescript')
    expect(textLanguage('package.json')).toBe('javascript')
    expect(textLanguage('README.md')).toBe('markdown')
    expect(textLanguage('README')).toBe('markdown')
    expect(textLanguage('main.go')).toBe('go')
    expect(textLanguage('.env.local')).toBe('ini')
    expect(textLanguage('notes.txt')).toBe('plaintext')
    expect(textLanguage('.gitignore')).toBe('plaintext')
    expect(textLanguage('image.png')).toBeNull()
  })

  it('round-trips paths through the protocol URL', () => {
    for (const p of ['/Users/alex/Trip to Lisbon #2.pdf', 'C:\\Users\\alex\\Účty 100%.xlsx', '/a/b?c=d']) {
      expect(pathFromPreviewUrl(previewUrl(p))).toBe(p)
    }
    expect(pathFromPreviewUrl('https://example.com/x')).toBeNull()
  })

  it('sniffs text', () => {
    expect(looksLikeText(new TextEncoder().encode('Ahoj, světe!\n\tindent'))).toBe(true)
    expect(looksLikeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))).toBe(false)
    expect(looksLikeText(new Uint8Array(0))).toBe(true)
  })

  it('parses range headers', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('items=1-2', 100)).toBeNull()
  })
})
