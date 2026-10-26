import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { McpStatus, Settings } from '@shared/types'

const api = window.api

type Info = McpStatus & { token: string }

/** The local MCP server: on/off, whether agents may change files, and how to connect an agent. */
export function McpSettings({ settings, onChange }: { settings: Settings; onChange(patch: Partial<Settings>): void }): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // The server starts and stops in the main process after the setting is saved; follow it.
  useEffect(() => {
    let live = true
    const refresh = (): void => void api.mcp.info().then((i) => live && setInfo(i), () => {})
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  const copy = (key: string, text: string): void => {
    void api.copyText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    })
  }

  const url = info?.url
  const claudeCommand = url && info.token ? `claude mcp add --transport http afinder ${url} --header "Authorization: Bearer ${info.token}"` : ''
  const json = url && info.token ? JSON.stringify({ mcpServers: { afinder: { type: 'http', url, headers: { Authorization: `Bearer ${info.token}` } } } }, null, 2) : ''

  return (
    <fieldset>
      <legend>{t('mcp.title')}</legend>
      <label className="settings-check">
        <input type="checkbox" checked={settings.mcpEnabled} onChange={(e) => onChange({ mcpEnabled: e.target.checked })} />
        {t('mcp.enable')}
      </label>
      <p className="settings-note">{t('mcp.hint')}</p>
      <label className="settings-check">
        <input type="checkbox" checked={settings.mcpAllowWrite} disabled={!settings.mcpEnabled} onChange={(e) => onChange({ mcpAllowWrite: e.target.checked })} />
        {t('mcp.allowWrite')}
      </label>
      <p className="settings-note">{t('mcp.allowWriteHint')}</p>
      {settings.mcpEnabled && info && (
        <>
          <p className={`settings-note${info.error ? ' mcp-error' : ''}`} role="status">
            {info.error ? t('mcp.error', { error: info.error }) : info.running ? t('mcp.running', { url: info.url ?? '' }) : t('mcp.starting')}
          </p>
          {info.running && (
            <div className="mcp-actions">
              <button className="xp-button" onClick={() => copy('claude', claudeCommand)}>
                {copied === 'claude' ? t('mcp.copied') : t('mcp.copyClaude')}
              </button>
              <button className="xp-button" onClick={() => copy('json', json)}>
                {copied === 'json' ? t('mcp.copied') : t('mcp.copyJson')}
              </button>
              <button className="link-button" onClick={() => void api.mcp.newToken().then(setInfo)}>
                {t('mcp.newToken')}
              </button>
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}
