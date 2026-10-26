import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { FileHashes } from '@shared/types'
import { formatSize } from '@renderer/lib/format'
import { api, Output, PathField, Progress, ToolError, useJob, useStored, type ToolProps } from './common'

const ALGOS = ['md5', 'sha1', 'sha256', 'sha512'] as const
const LABEL: Record<(typeof ALGOS)[number], string> = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' }
const SUBTLE: Partial<Record<(typeof ALGOS)[number], string>> = { sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' }

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Checksums of a file (in the worker, any size) or of typed text, and a check against a given hash. */
export default function Checksums({ folder }: Pick<ToolProps, 'folder'>): React.JSX.Element {
  const [mode, setMode] = useStored<'file' | 'text'>('hash.mode', 'file')
  const [file, setFile] = useState('')
  const [text, setText] = useState('')
  const [hashes, setHashes] = useState<Partial<FileHashes> | null>(null)
  const [expected, setExpected] = useState('')
  const job = useJob<FileHashes>()

  // Text hashes follow the typing; MD5 is not in Web Crypto and only offered for files.
  useEffect(() => {
    if (mode !== 'text') return
    let live = true
    const bytes = new TextEncoder().encode(text)
    void Promise.all(Object.entries(SUBTLE).map(async ([k, algo]) => [k, hex(await crypto.subtle.digest(algo!, bytes))] as const)).then(
      (list) => live && setHashes({ size: bytes.length, ...Object.fromEntries(list) })
    )
    return () => {
      live = false
    }
  }, [mode, text])

  const compute = async (): Promise<void> => {
    setHashes(null)
    const result = await job.run((id) => api.tools.hash(id, file.trim()))
    if (result) setHashes(result)
  }

  const wanted = expected.trim().toLowerCase().replace(/\s/g, '')
  const match = wanted && hashes ? ALGOS.find((a) => hashes[a] === wanted) : undefined

  return (
    <div className="tool">
      <div className="todo-seg">
        {(['file', 'text'] as const).map((m) => (
          <button
            key={m}
            className={m === mode ? 'on' : ''}
            onClick={() => {
              setMode(m)
              setHashes(null)
            }}
          >
            {t(m === 'file' ? 'tools.hashFile' : 'tools.hashText')}
          </button>
        ))}
      </div>
      {mode === 'file' ? (
        <>
          <PathField value={file} onChange={setFile} kind="file" folder={folder} />
          {job.busy ? (
            <Progress progress={job.progress} onCancel={job.cancel} />
          ) : (
            <div className="tool-row">
              <button className="todo-btn" disabled={!file.trim()} onClick={() => void compute()}>
                {t('tools.compute')}
              </button>
            </div>
          )}
          <ToolError text={job.error} />
        </>
      ) : (
        <textarea className="tool-input tool-text" rows={4} value={text} placeholder={t('tools.textPlaceholder')} onChange={(e) => setText(e.target.value)} />
      )}
      {hashes && (
        <>
          {hashes.size !== undefined && <p className="tool-muted">{formatSize(hashes.size)}</p>}
          {ALGOS.filter((a) => hashes[a]).map((a) => (
            <Output key={a} label={LABEL[a]} value={hashes[a]!} />
          ))}
          <div className="tool-row">
            <input className="tool-input grow" value={expected} spellCheck={false} placeholder={t('tools.hashCompare')} onChange={(e) => setExpected(e.target.value)} />
            {wanted && <span className={match ? 'tool-ok' : 'tool-error'}>{match ? t('tools.hashMatch', { algo: LABEL[match] }) : t('tools.hashMismatch')}</span>}
          </div>
        </>
      )}
    </div>
  )
}
