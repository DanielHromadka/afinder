// S3 backend (AWS and S3-compatible services: MinIO, Cloudflare R2, Wasabi, Backblaze B2 …). S3 has
// no folders, only keys: "a/b/c.txt" shows as folder a, folder b, file c.txt, and an empty folder is a
// zero-byte "a/b/" marker object – the same convention the AWS console uses.

import { createReadStream, createWriteStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { S3Client as S3ClientType } from '@aws-sdk/client-s3'
import { t } from '@shared/i18n'
import type { RemoteConnection, RemoteSecrets } from '@shared/remote'
import { fsError, type RemoteItem, type RemoteProvider } from './provider'

const MAX_LIST = 100_000

export async function connectS3(c: RemoteConnection, secrets: RemoteSecrets): Promise<RemoteProvider> {
  const s3 = await import('@aws-sdk/client-s3')
  const { Upload } = await import('@aws-sdk/lib-storage')
  const custom = c.endpoint.trim() !== ''
  const client: S3ClientType = new s3.S3Client({
    region: c.region || 'us-east-1',
    ...(custom ? { endpoint: c.endpoint.trim(), forcePathStyle: true } : {}),
    // Without keys the SDK's default chain applies (environment, ~/.aws profiles, SSO).
    ...(c.accessKeyId ? { credentials: { accessKeyId: c.accessKeyId, secretAccessKey: secrets.secretAccessKey ?? '' } } : {}),
    // Many S3-compatible services reject the newer default integrity checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  })
  const Bucket = c.bucket
  const prefix = c.root.replace(/^\/+|\/+$/g, '')
  const keyOf = (segments: string[]): string => [prefix, ...segments].filter(Boolean).join('/')
  const dirKey = (segments: string[]): string => {
    const k = keyOf(segments)
    return k ? `${k}/` : ''
  }

  const mapError = (err: unknown, key: string): never => {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    const status = e.$metadata?.httpStatusCode
    if (e.name === 'NoSuchKey' || e.name === 'NotFound' || status === 404) throw fsError('ENOENT', t('error.notFound'), key)
    if (e.name === 'AccessDenied' || status === 403) throw fsError('EACCES', t('error.denied'), key)
    if (e.name === 'NoSuchBucket') throw new Error(t('remote.error.noBucket', { bucket: Bucket }))
    throw err
  }

  /** Every key below a prefix (for renaming and deleting folders). */
  const allKeys = async (p: string): Promise<string[]> => {
    const keys: string[] = []
    let token: string | undefined
    do {
      const res = await client.send(new s3.ListObjectsV2Command({ Bucket, Prefix: p, ContinuationToken: token })).catch((err) => mapError(err, p))
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key)
      token = res.IsTruncated ? res.NextContinuationToken : undefined
      if (keys.length > MAX_LIST) throw new Error(t('remote.error.tooMany'))
    } while (token)
    return keys
  }

  const copySource = (key: string): string => `${Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`

  const deleteKeys = async (keys: string[]): Promise<void> => {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      const res = await client
        .send(new s3.DeleteObjectsCommand({ Bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }))
        .catch((err) => mapError(err, batch[0]))
      if (res.Errors?.length) throw new Error(res.Errors[0].Message ?? t('error.denied'))
    }
  }

  const provider: RemoteProvider = {
    async list(dir) {
      const p = dirKey(dir)
      const items: RemoteItem[] = []
      let token: string | undefined
      let any = false
      do {
        const res = await client
          .send(new s3.ListObjectsV2Command({ Bucket, Prefix: p, Delimiter: '/', ContinuationToken: token }))
          .catch((err) => mapError(err, p))
        for (const cp of res.CommonPrefixes ?? []) {
          const name = cp.Prefix!.slice(p.length, -1)
          if (name) items.push({ name, isDir: true, size: 0, modified: 0 })
        }
        for (const o of res.Contents ?? []) {
          any = true
          if (!o.Key || o.Key === p) continue // the folder's own marker
          items.push({ name: o.Key.slice(p.length), isDir: false, size: o.Size ?? 0, modified: o.LastModified?.getTime() ?? 0 })
        }
        any ||= (res.CommonPrefixes?.length ?? 0) > 0
        token = res.IsTruncated ? res.NextContinuationToken : undefined
        if (items.length > MAX_LIST) throw new Error(t('remote.error.tooMany'))
      } while (token)
      // An empty listing of a key that does not exist at all is a missing folder, not an empty one.
      if (!any && dir.length > 0 && !(await provider.stat(dir))?.isDir) throw fsError('ENOENT', t('error.notFound'), p)
      return items
    },
    async stat(item) {
      if (item.length === 0) return { name: '', isDir: true, size: 0, modified: 0 }
      const name = item.at(-1)!
      try {
        const head = await client.send(new s3.HeadObjectCommand({ Bucket, Key: keyOf(item) }))
        return { name, isDir: false, size: head.ContentLength ?? 0, modified: head.LastModified?.getTime() ?? 0 }
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        if (status !== 404) mapError(err, keyOf(item))
      }
      const res = await client.send(new s3.ListObjectsV2Command({ Bucket, Prefix: dirKey(item), MaxKeys: 1 })).catch((err) => mapError(err, keyOf(item)))
      return (res.KeyCount ?? 0) > 0 ? { name, isDir: true, size: 0, modified: 0 } : null
    },
    async download(file, localTarget) {
      const key = keyOf(file)
      const res = await client.send(new s3.GetObjectCommand({ Bucket, Key: key })).catch((err) => mapError(err, key))
      await pipeline(res.Body as Readable, createWriteStream(localTarget))
    },
    async upload(localSource, file) {
      const key = keyOf(file)
      // Multipart for large files, a single PUT for small ones.
      await new Upload({ client, params: { Bucket, Key: key, Body: createReadStream(localSource) } }).done().catch((err) => mapError(err, key))
    },
    async mkdir(dir) {
      const key = dirKey(dir)
      await client.send(new s3.PutObjectCommand({ Bucket, Key: key, Body: '' })).catch((err) => mapError(err, key))
    },
    async rename(from, to) {
      // S3 cannot rename: copy every object, then delete the originals.
      const st = await provider.stat(from)
      if (!st) throw fsError('ENOENT', t('error.notFound'), keyOf(from))
      const pairs = st.isDir
        ? (await allKeys(dirKey(from))).map((k) => [k, dirKey(to) + k.slice(dirKey(from).length)] as const)
        : [[keyOf(from), keyOf(to)] as const]
      for (const [src, dst] of pairs) {
        await client.send(new s3.CopyObjectCommand({ Bucket, CopySource: copySource(src), Key: dst })).catch((err) => mapError(err, src))
      }
      await deleteKeys(pairs.map(([src]) => src))
    },
    async remove(item, isDir) {
      if (item.length === 0) throw new Error(t('error.invalidPath'))
      if (isDir) await deleteKeys(await allKeys(dirKey(item)))
      else await client.send(new s3.DeleteObjectCommand({ Bucket, Key: keyOf(item) })).catch((err) => mapError(err, keyOf(item)))
    },
    async close() {
      client.destroy()
    }
  }
  return provider
}
