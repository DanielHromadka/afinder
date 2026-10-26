import { useEffect, useState } from 'react'
import { locale, t } from '@shared/i18n'
import type { DeviceKind } from '@shared/companion/crypto'
import type { RemoteMount } from '@shared/remote'
import type { CompanionStatus, Settings } from '@shared/types'

const api = window.api

/**
 * One kind of device of the companion: phones (Settings → Phone: QR code, files and watching the screen) or other
 * computers with aFinder (Settings → Remote access: a link, files, screen and control). Each kind has its own switch,
 * pairing and list; both share the relay connection.
 */
/**
 * The other direction: computers this one connects to (remote connections of type afinder). A pasted link
 * opens the connection dialog, which pairs at once; each paired computer opens its remote desktop here.
 */
function ComputerConnections({ onConnect }: { onConnect(link: string): void }): React.JSX.Element {
  const [link, setLink] = useState('')
  const [mounts, setMounts] = useState<RemoteMount[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = (): void => void api.remote.list().then((l) => live && setMounts(l.filter((m) => m.connection.type === 'afinder')), () => {})
    load()
    const off = api.remote.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [])
  const valid = /^afinder:\/\/pair\?/.test(link.trim())
  return (
    <fieldset>
      <legend>{t('computers.outgoingTitle')}</legend>
      <p className="settings-note">{t('computers.outgoingHint')}</p>
      <form
        className="mcp-actions"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onConnect(link.trim())
        }}
      >
        <input className="companion-link" value={link} spellCheck={false} placeholder="afinder://pair?…" aria-label={t('remote.pairingLink')} onChange={(e) => setLink(e.target.value)} />
        <button className="xp-button" type="submit" disabled={!valid}>
          {t('remote.pair')}
        </button>
      </form>
      {mounts.length > 0 && (
        <ul className="companion-devices">
          {mounts.map((m) => (
            <li key={m.connection.id}>
              <span className={`companion-dot${m.connected ? ' on' : ''}`} aria-hidden />
              <span className="companion-name">
                <strong>{m.connection.name}</strong>
              </span>
              <button className="link-button" onClick={() => void api.remote.openDesktop(m.connection.id).catch((err: Error) => setError(err.message))}>
                {t('remoteDesktop.open')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="settings-note mcp-error" role="alert">{error}</p>}
    </fieldset>
  )
}

export function CompanionSettings({ kind, settings, onChange, onConnectComputer }: { kind: DeviceKind; settings: Settings; onChange(patch: Partial<Settings>): void; onConnectComputer?(link: string): void }): React.JSX.Element {
  const computer = kind === 'computer'
  const enabled = computer ? settings.computersEnabled : settings.companionEnabled
  const setEnabled = (on: boolean): void => onChange(computer ? { computersEnabled: on } : { companionEnabled: on })
  const [status, setStatus] = useState<CompanionStatus | null>(null)
  const [relay, setRelay] = useState(settings.companionRelay)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let live = true
    void api.companion.status().then((s) => live && setStatus(s), () => {})
    const off = api.companion.onChanged(setStatus)
    return () => {
      live = false
      off()
    }
  }, [enabled])

  // The countdown under the QR code.
  const pairing = status?.pairing?.kind === kind ? status.pairing : null
  const request = status?.request?.kind === kind ? status.request : null
  const devices = status?.devices.filter((d) => d.kind === kind) ?? []
  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pairing])

  // Closing the dialog withdraws a QR code nobody scanned yet.
  useEffect(() => () => void api.companion.cancelPair().catch(() => {}), [])

  const run = (work: Promise<unknown>): void => {
    setError(null)
    void work.catch((err: Error) => setError(err.message))
  }
  const saveRelay = (): void => {
    const value = relay.trim()
    if (value === settings.companionRelay) return
    if (value && !/^wss?:\/\/[^\s/]+(\/\S*)?$/.test(value)) return setError(t('companion.badRelay'))
    setError(null)
    onChange({ companionRelay: value })
  }

  const left = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0
  const stateText =
    !status || !enabled ? '' : status.state === 'online' ? t('companion.online') : status.state === 'connecting' ? t('companion.connecting') : t('companion.offline', { error: status.error ?? '' })
  const seen = (at: number | null): string => (at ? new Date(at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : t('companion.never'))

  return (
    <>
      {computer && onConnectComputer && <ComputerConnections onConnect={onConnectComputer} />}
      <fieldset>
        <legend>{t(computer ? 'computers.title' : 'companion.title')}</legend>
        <label className="settings-check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t(computer ? 'computers.enable' : 'companion.enable')}
        </label>
        <p className="settings-note">{t(computer ? 'computers.hint' : 'companion.hint')}</p>
        <label className="settings-field">
          <span>{t('companion.relay')}</span>
          <input value={relay} placeholder={t('companion.relayDefault')} spellCheck={false} onChange={(e) => setRelay(e.target.value)} onBlur={saveRelay} onKeyDown={(e) => e.key === 'Enter' && saveRelay()} />
        </label>
        {stateText && (
          <p className={`settings-note${status?.state === 'offline' ? ' mcp-error' : ''}`} role="status">
            {stateText}
          </p>
        )}
        {error && <p className="settings-note mcp-error" role="alert">{error}</p>}
      </fieldset>

      {enabled && status && (
        <fieldset>
          <legend>{t(computer ? 'computers.devices' : 'companion.devices')}</legend>
          {request ? (
            <div className="companion-pair">
              <p>{t('companion.confirm', { name: request.name })}</p>
              <p className="companion-sas">{request.sas.replace(/(\d{3})(\d{3})/, '$1 $2')}</p>
              <p className="settings-note">{t('companion.confirmHint')}</p>
              <div className="mcp-actions">
                <button className="xp-button" onClick={() => run(api.companion.answer(true))}>
                  {t('companion.accept')}
                </button>
                <button className="xp-button" onClick={() => run(api.companion.answer(false))}>
                  {t('companion.decline')}
                </button>
              </div>
            </div>
          ) : pairing ? (
            <div className="companion-pair">
              {computer ? (
                <>
                  <input className="companion-link" readOnly value={pairing.uri} onFocus={(e) => e.target.select()} aria-label={t('companion.copyLink')} />
                  <p className="settings-note">{t('computers.link')}</p>
                </>
              ) : (
                <>
                  <img className="companion-qr" src={pairing.qr} alt={t('companion.qrAlt')} width={200} height={200} />
                  <p className="settings-note">{t('companion.scan')}</p>
                </>
              )}
              <p className="settings-note">{t('companion.expires', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })}</p>
              <div className="mcp-actions">
                <button className="xp-button" onClick={() => run(api.companion.cancelPair())}>
                  {t('dialog.cancel')}
                </button>
                <button className="link-button" onClick={() => run(api.copyText(pairing.uri))}>
                  {t('companion.copyLink')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mcp-actions">
              <button className="xp-button" disabled={status.state !== 'online'} onClick={() => run(api.companion.pair(kind))}>
                {t(computer ? 'computers.pair' : 'companion.pair')}
              </button>
            </div>
          )}
          {devices.length === 0 ? (
            <p className="settings-note">{t(computer ? 'computers.none' : 'companion.none')}</p>
          ) : (
            <ul className="companion-devices">
              {devices.map((d) => (
                <li key={d.id}>
                  <span className={`companion-dot${d.online ? ' on' : ''}`} aria-hidden />
                  <span className="companion-name">
                    <strong>{d.name}</strong>
                    <small>{d.online ? t('companion.connected') : t('companion.lastSeen', { time: seen(d.lastSeen) })}</small>
                  </span>
                  <label className="settings-check">
                    <input type="checkbox" checked={d.write} onChange={(e) => run(api.companion.setWrite(d.id, e.target.checked))} />
                    {t('companion.write')}
                  </label>
                  <label className="settings-check">
                    <input type="checkbox" checked={d.screen} onChange={(e) => run(api.companion.setScreen(d.id, e.target.checked))} />
                    {t('companion.screen')}
                  </label>
                  {computer && status.controlSupported && (
                    <label className="settings-check" title={t('companion.controlHint')}>
                      <input type="checkbox" checked={d.control} disabled={!d.screen} onChange={(e) => run(api.companion.setControl(d.id, e.target.checked))} />
                      {t('companion.control')}
                    </label>
                  )}
                  <button className="link-button" onClick={() => run(api.companion.remove(d.id))}>
                    {t('companion.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </>
  )
}
