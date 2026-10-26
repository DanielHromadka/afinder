import { describe, expect, it } from 'vitest'
import { ancestors, baseName, dirOf, isInside, isRoot, joinPath, parentOf, relativeDir, rootOf, samePath } from './paths'

describe('POSIX paths', () => {
  it('splits paths', () => {
    expect(parentOf('/Users/me/Docs')).toBe('/Users/me')
    expect(parentOf('/Users')).toBe('/')
    expect(parentOf('/')).toBeNull()
    expect(baseName('/Users/me/a.txt')).toBe('a.txt')
    expect(baseName('/')).toBe('/')
    expect(dirOf('/a/b.txt')).toBe('/a')
    expect(joinPath('/a', 'b')).toBe('/a/b')
    expect(joinPath('/', 'b')).toBe('/b')
  })

  it('compares containment exactly', () => {
    expect(isInside('/a/b/c', '/a/b')).toBe(true)
    expect(isInside('/a/bc', '/a/b')).toBe(false)
    expect(isInside('/a/B', '/a/b')).toBe(false)
    expect(isInside('/x', '/')).toBe(true)
  })

  it('builds ancestors and relative folders', () => {
    expect(ancestors('/Users/me/Docs', '/Users/me')).toEqual(['/Users/me', '/Users/me/Docs'])
    expect(ancestors('/etc', '/Users/me')).toEqual([])
    expect(ancestors('/a/b', '/')).toEqual(['/', '/a', '/a/b'])
    expect(relativeDir('/r/sub/deep/f.txt', '/r')).toBe('sub/deep')
    expect(relativeDir('/r/f.txt', '/r')).toBe('')
    expect(relativeDir('/x/sub/f.txt', '/')).toBe('x/sub')
  })
})

describe('Windows paths', () => {
  it('finds roots', () => {
    expect(rootOf('C:\\Users\\me')).toBe('C:\\')
    expect(rootOf('d:\\')).toBe('D:\\')
    expect(rootOf('\\\\srv\\share\\dir')).toBe('\\\\srv\\share\\')
    expect(isRoot('C:\\')).toBe(true)
    expect(isRoot('C:')).toBe(true)
    expect(isRoot('\\\\srv\\share\\')).toBe(true)
    expect(isRoot('C:\\Users')).toBe(false)
  })

  it('splits paths', () => {
    expect(parentOf('C:\\Users\\me')).toBe('C:\\Users')
    expect(parentOf('C:\\Users')).toBe('C:\\')
    expect(parentOf('C:\\')).toBeNull()
    expect(parentOf('\\\\srv\\share\\dir')).toBe('\\\\srv\\share\\')
    expect(baseName('C:\\Users\\me\\a.txt')).toBe('a.txt')
    expect(joinPath('C:\\Users', 'me')).toBe('C:\\Users\\me')
    expect(joinPath('C:\\', 'Users')).toBe('C:\\Users')
  })

  it('compares case-insensitively', () => {
    expect(samePath('C:\\Users\\Me', 'c:\\users\\me\\')).toBe(true)
    expect(isInside('C:\\Users\\me\\Docs', 'c:\\users')).toBe(true)
    expect(isInside('C:\\Users2', 'C:\\Users')).toBe(false)
  })

  it('builds ancestors and relative folders', () => {
    expect(ancestors('C:\\Users\\me\\Docs', 'C:\\')).toEqual(['C:\\', 'C:\\Users', 'C:\\Users\\me', 'C:\\Users\\me\\Docs'])
    expect(relativeDir('C:\\r\\sub\\deep\\f.txt', 'C:\\r')).toBe('sub\\deep')
    expect(relativeDir('C:\\r\\f.txt', 'C:\\r')).toBe('')
  })
})
