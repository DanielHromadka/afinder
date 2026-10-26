import { describe, expect, it } from 'vitest'
import { displayPath, emptyConnection, mountOf, parseSiteUrl, remoteUrl, resolveDisplayPath, slugify, type RemoteMount } from './remote'

const sftp: RemoteMount = {
  connection: { ...emptyConnection('sftp'), id: 'web', name: 'Web', host: 'example.com', username: 'me', root: '/var/www' },
  path: '/data/Remote/web',
  url: 'sftp://me@example.com/var/www',
  connected: false
}
const s3: RemoteMount = {
  connection: { ...emptyConnection('s3'), id: 'b', name: 'B', bucket: 'bucket' },
  path: '/data/Remote/b',
  url: 's3://bucket',
  connected: false
}
const mounts = [sftp, s3]

describe('remote', () => {
  it('builds URLs', () => {
    expect(remoteUrl(sftp.connection)).toBe('sftp://me@example.com/var/www')
    expect(remoteUrl({ ...sftp.connection, port: 2222, root: '/' })).toBe('sftp://me@example.com:2222')
    expect(remoteUrl({ ...s3.connection, root: 'photos/' })).toBe('s3://bucket/photos')
  })

  it('builds Graph URLs', () => {
    const g = { ...emptyConnection('graph'), siteUrl: 'https://contoso.sharepoint.com/sites/Team/', library: 'Dokumenty', root: '/Projekty/' }
    expect(remoteUrl(g)).toBe('sharepoint://contoso.sharepoint.com/sites/Team/Dokumenty/Projekty')
    expect(remoteUrl({ ...g, library: '', root: '' })).toBe('sharepoint://contoso.sharepoint.com/sites/Team')
    expect(remoteUrl({ ...g, graphTarget: 'onedrive', root: '' })).toBe('onedrive://me')
    const od: RemoteMount = { connection: { ...g, graphTarget: 'onedrive', root: '' }, path: '/data/Remote/od', url: 'onedrive://me', connected: false }
    expect(displayPath('/data/Remote/od/a b', [od])).toBe('onedrive://me/a b')
    expect(resolveDisplayPath('onedrive://me/a b/', [od])).toBe('/data/Remote/od/a b')
  })

  it('parses SharePoint site addresses', () => {
    expect(parseSiteUrl('https://contoso.sharepoint.com/sites/Team')).toEqual({ host: 'contoso.sharepoint.com', path: '/sites/Team' })
    expect(parseSiteUrl('https://contoso.sharepoint.com/sites/Team/Shared%20Documents/Forms/AllItems.aspx')).toEqual({
      host: 'contoso.sharepoint.com',
      path: '/sites/Team'
    })
    expect(parseSiteUrl('https://contoso.sharepoint.com/teams/Dev/SitePages/Home.aspx').path).toBe('/teams/Dev')
    expect(parseSiteUrl('https://contoso.sharepoint.com/').path).toBe('')
  })

  it('slugifies names', () => {
    expect(slugify('Webový server č. 1')).toBe('webovy-server-c-1')
    expect(slugify('***')).toBe('remote')
  })

  it('finds the mount of a path', () => {
    expect(mountOf('/data/Remote/web/a/b', mounts)).toBe(sftp)
    expect(mountOf('/data/Remote/web', mounts)).toBe(sftp)
    expect(mountOf('/data/Remote/webx', mounts)).toBeNull()
  })

  it('shows remote paths as URLs and back', () => {
    expect(displayPath('/data/Remote/web/a/b.txt', mounts)).toBe('sftp://me@example.com/var/www/a/b.txt')
    expect(displayPath('/data/Remote/b', mounts)).toBe('s3://bucket')
    expect(displayPath('/Users/me', mounts)).toBe('/Users/me')
    expect(resolveDisplayPath('sftp://me@example.com/var/www/a/b.txt', mounts)).toBe('/data/Remote/web/a/b.txt')
    expect(resolveDisplayPath('S3://bucket/', mounts)).toBe('/data/Remote/b')
    expect(resolveDisplayPath('sftp://other/x', mounts)).toBe('sftp://other/x')
  })

  it('works with Windows mount folders', () => {
    const win = { ...sftp, path: 'C:\\Users\\me\\AppData\\Roaming\\aFinder\\Remote\\web' }
    expect(displayPath(`${win.path}\\a\\b`, [win])).toBe('sftp://me@example.com/var/www/a/b')
    expect(resolveDisplayPath('sftp://me@example.com/var/www/a/b', [win])).toBe(`${win.path}\\a\\b`)
  })
})
