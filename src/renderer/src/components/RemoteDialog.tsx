import { useEffect, useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { t } from '@shared/i18n'
import { emptyConnection, type RemoteConnection, type RemoteSecrets, type RemoteType } from '@shared/remote'

interface Props {
  /** The connection to edit, or null for a new one. */
  connection: RemoteConnection | null
  /** A new connection of this type instead of SFTP. */
  type?: RemoteType
  /** Another computer's pairing link, pasted elsewhere (Settings → Remote access): pairing starts at once. */
  link?: string
  onSaved(id: string): void
  onCancel(): void
}

type TestState = { state: 'idle' } | { state: 'testing' } | { state: 'ok' } | { state: 'error'; message: string }
/** aFinder on another computer: the link is pasted, both computers show a code, the other one confirms. */
type PairState = { state: 'idle' } | { state: 'waiting'; sas: string } | { state: 'paired' }

/** Add or edit an SFTP / S3 / Graph connection or pair another computer's aFinder. Saved secrets are never
 * sent back – empty fields keep them. */
export function RemoteDialog({ connection, type, link: pasted, onSaved, onCancel }: Props): React.JSX.Element {
  const editing = connection !== null
  const [c, setC] = useState<RemoteConnection>(connection ?? emptyConnection(type ?? 'sftp'))
  const [secrets, setSecrets] = useState<RemoteSecrets>({})
  const [test, setTest] = useState<TestState>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const [link, setLink] = useState(pasted ?? '')
  const [pairing, setPairing] = useState<PairState>({ state: 'idle' })
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  // Closing the dialog gives up a pairing that the other computer has not confirmed yet.
  useEffect(() => () => void window.api.remote.pairCancel().catch(() => {}), [])

  const pair = async (uri = link): Promise<void> => {
    setTest({ state: 'idle' })
    try {
      const { sas } = await window.api.remote.pairStart(uri.trim())
      setPairing({ state: 'waiting', sas })
      const paired = await window.api.remote.pairWait()
      setC((prev) => ({ ...paired, name: prev.name.trim() || paired.name }))
      setPairing({ state: 'paired' })
    } catch (err) {
      setPairing({ state: 'idle' })
      setTest({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }
  // A link pasted in the settings pairs right away. A tick later, so StrictMode's trial mount (and its
  // pairCancel on unmount) does not start and cancel a pairing of its own.
  useEffect(() => {
    if (!pasted?.trim()) return
    const timer = setTimeout(() => void pair(pasted), 0)
    return () => clearTimeout(timer)
  }, [])
  const unpaired = c.type === 'afinder' && !editing && pairing.state !== 'paired'

  const set = (patch: Partial<RemoteConnection>): void => {
    setC((prev) => ({ ...prev, ...patch }))
    setTest({ state: 'idle' })
  }
  const setSecret = (patch: RemoteSecrets): void => {
    setSecrets((prev) => ({ ...prev, ...patch }))
    setTest({ state: 'idle' })
  }
  const changeType = (type: RemoteType): void => setC((prev) => ({ ...emptyConnection(type), id: prev.id, name: prev.name }))

  const runTest = async (): Promise<void> => {
    setTest({ state: 'testing' })
    try {
      await window.api.remote.test(c, secrets)
      setTest({ state: 'ok' })
    } catch (err) {
      setTest({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      onSaved(await window.api.remote.save(c, secrets))
    } catch (err) {
      setTest({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      setSaving(false)
    }
  }

  const keepHint = editing ? t('remote.keepSecret') : ''
  const title = editing ? t('remote.editTitle') : t('remote.addTitle')

  return (
    <Dialog title={title} className="remote-dialog" onClose={onCancel} resizable onSubmit={() => void save()}>

        <div className="batch-form">
          <label>
            <span>{t('remote.type')}</span>
            <select value={c.type} disabled={editing} onChange={(e) => changeType(e.target.value as RemoteType)}>
              <option value="sftp">SFTP (SSH)</option>
              <option value="s3">{t('remote.type.s3')}</option>
              <option value="graph">SharePoint / OneDrive</option>
              <option value="afinder">{t('remote.type.afinder')}</option>
            </select>
          </label>
          <label>
            <span>{t('remote.name')}</span>
            <input ref={first} value={c.name} placeholder={t('remote.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} />
          </label>

          {c.type === 'sftp' ? (
            <>
              <div className="batch-row remote-host">
                <label>
                  <span>{t('remote.host')}</span>
                  <input value={c.host} spellCheck={false} placeholder="example.com" onChange={(e) => set({ host: e.target.value })} />
                </label>
                <label>
                  <span>{t('remote.port')}</span>
                  <input type="number" min={1} max={65535} value={c.port} onChange={(e) => set({ port: Number(e.target.value) })} />
                </label>
              </div>
              <label>
                <span>{t('remote.username')}</span>
                <input value={c.username} spellCheck={false} autoComplete="off" onChange={(e) => set({ username: e.target.value })} />
              </label>
              <label>
                <span>{t('remote.auth')}</span>
                <select value={c.sftpAuth} onChange={(e) => set({ sftpAuth: e.target.value as RemoteConnection['sftpAuth'] })}>
                  <option value="password">{t('remote.auth.password')}</option>
                  <option value="key">{t('remote.auth.key')}</option>
                  <option value="agent">{t('remote.auth.agent')}</option>
                </select>
              </label>
              {c.sftpAuth === 'password' && (
                <label>
                  <span>{t('remote.password')}</span>
                  <input type="password" autoComplete="new-password" placeholder={keepHint} value={secrets.password ?? ''} onChange={(e) => setSecret({ password: e.target.value })} />
                </label>
              )}
              {c.sftpAuth === 'key' && (
                <>
                  <label>
                    <span>{t('remote.keyPath')}</span>
                    <span className="remote-pick">
                      <input value={c.keyPath} spellCheck={false} placeholder="~/.ssh/id_ed25519" onChange={(e) => set({ keyPath: e.target.value })} />
                      <button type="button" className="xp-button" onClick={() => void window.api.remote.pickKey().then((p) => p && set({ keyPath: p }))}>
                        {t('remote.browse')}
                      </button>
                    </span>
                  </label>
                  <label>
                    <span>{t('remote.passphrase')}</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder={keepHint || t('remote.optional')}
                      value={secrets.passphrase ?? ''}
                      onChange={(e) => setSecret({ passphrase: e.target.value })}
                    />
                  </label>
                </>
              )}
              <label>
                <span>{t('remote.folder')}</span>
                <input value={c.root} spellCheck={false} placeholder="/" onChange={(e) => set({ root: e.target.value })} />
              </label>
            </>
          ) : c.type === 'afinder' ? (
            editing || pairing.state === 'paired' ? (
              <p className="remote-note">{t('remote.computerPaired')}</p>
            ) : (
              <>
                <label>
                  <span>{t('remote.pairingLink')}</span>
                  <span className="remote-pick">
                    <input value={link} spellCheck={false} placeholder="afinder://pair?…" disabled={pairing.state === 'waiting'} onChange={(e) => setLink(e.target.value)} />
                    <button type="button" className="xp-button" disabled={!link.trim() || pairing.state === 'waiting'} onClick={() => void pair()}>
                      {t('remote.pair')}
                    </button>
                  </span>
                </label>
                {pairing.state === 'waiting' && (
                  <div className="companion-pair">
                    <p className="companion-sas">{pairing.sas.replace(/(\d{3})(\d{3})/, '$1 $2')}</p>
                    <p className="settings-note">{t('remote.pairingConfirm')}</p>
                  </div>
                )}
              </>
            )
          ) : c.type === 'graph' ? (
            <>
              <label>
                <span>{t('remote.graphTarget')}</span>
                <select value={c.graphTarget} onChange={(e) => set({ graphTarget: e.target.value as RemoteConnection['graphTarget'] })}>
                  <option value="sharepoint">{t('remote.graphTarget.sharepoint')}</option>
                  <option value="onedrive">{t('remote.graphTarget.onedrive')}</option>
                </select>
              </label>
              {c.graphTarget === 'sharepoint' && (
                <>
                  <label>
                    <span>{t('remote.siteUrl')}</span>
                    <input value={c.siteUrl} spellCheck={false} placeholder="https://contoso.sharepoint.com/sites/Team" onChange={(e) => set({ siteUrl: e.target.value })} />
                  </label>
                  <label>
                    <span>{t('remote.library')}</span>
                    <input value={c.library} spellCheck={false} placeholder={t('remote.libraryPlaceholder')} onChange={(e) => set({ library: e.target.value })} />
                  </label>
                </>
              )}
              <label>
                <span>{t('remote.folder')}</span>
                <input value={c.root} spellCheck={false} placeholder={t('remote.optional')} onChange={(e) => set({ root: e.target.value })} />
              </label>
              <label>
                <span>{t('remote.clientId')}</span>
                <input value={c.clientId} spellCheck={false} placeholder="00000000-0000-0000-0000-000000000000" onChange={(e) => set({ clientId: e.target.value.trim() })} />
              </label>
              <label>
                <span>{t('remote.tenant')}</span>
                <input value={c.tenant} spellCheck={false} placeholder="organizations" onChange={(e) => set({ tenant: e.target.value.trim() })} />
              </label>
            </>
          ) : (
            <>
              <label>
                <span>{t('remote.bucket')}</span>
                <input value={c.bucket} spellCheck={false} placeholder="my-bucket" onChange={(e) => set({ bucket: e.target.value.toLowerCase() })} />
              </label>
              <label>
                <span>{t('remote.prefix')}</span>
                <input value={c.root} spellCheck={false} placeholder={t('remote.optional')} onChange={(e) => set({ root: e.target.value })} />
              </label>
              <label>
                <span>{t('remote.region')}</span>
                <input value={c.region} spellCheck={false} placeholder="us-east-1" onChange={(e) => set({ region: e.target.value })} />
              </label>
              <label>
                <span>{t('remote.endpoint')}</span>
                <input value={c.endpoint} spellCheck={false} placeholder={t('remote.endpointPlaceholder')} onChange={(e) => set({ endpoint: e.target.value })} />
              </label>
              <label>
                <span>{t('remote.accessKey')}</span>
                <input value={c.accessKeyId} spellCheck={false} autoComplete="off" placeholder={t('remote.accessKeyPlaceholder')} onChange={(e) => set({ accessKeyId: e.target.value })} />
              </label>
              <label>
                <span>{t('remote.secretKey')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={keepHint}
                  disabled={!c.accessKeyId}
                  value={secrets.secretAccessKey ?? ''}
                  onChange={(e) => setSecret({ secretAccessKey: e.target.value })}
                />
              </label>
            </>
          )}
          <p className="remote-note">{t(c.type === 'sftp' ? 'remote.note.sftp' : c.type === 'graph' ? 'remote.note.graph' : c.type === 'afinder' ? 'remote.note.afinder' : 'remote.note.s3')}</p>
        </div>

        <div className="dialog-buttons right">
          <span className={`batch-summary${test.state === 'error' ? ' error' : ''}`} title={test.state === 'error' ? test.message : undefined}>
            {test.state === 'testing' ? t(c.type === 'graph' ? 'remote.signingIn' : 'remote.testing') : test.state === 'ok' ? t('remote.testOk') : test.state === 'error' ? test.message : ''}
          </span>
          <button type="button" className="xp-button" disabled={test.state === 'testing' || unpaired} onClick={() => void runTest()}>
            {t('remote.test')}
          </button>
          <button type="submit" className="xp-button" disabled={saving || unpaired}>
            {t('remote.save')}
          </button>
          <button type="button" className="xp-button" onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
        </div>
    </Dialog>
  )
}
