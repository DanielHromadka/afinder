import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t, type MessageKey } from '@shared/i18n'
import type { DockerContainer, DockerInspect, DockerLogLine, DockerStatsPoint } from '@shared/docker'
import { formatDate, formatSize } from '@renderer/lib/format'
import { useStored } from '../tools/common'
import { Card, Graph, HISTORY, pct, rate } from '../tools/SystemMonitor'

// The lower half of the Docker area: the chosen container's live logs, its stats and what inspect says.

const api = window.api
/** Lines kept in the view; older ones scroll away (Save writes what is kept). */
const MAX_LINES = 5000
const TAILS = [100, 500, 1000, 5000, 0] as const

type Tab = 'logs' | 'stats' | 'inspect'

export function ContainerDetail({ container, onOpenFolder }: { container: DockerContainer; onOpenFolder(path: string): void }): React.JSX.Element {
  const [tab, setTab] = useStored<Tab>('docker.detail', 'logs')
  return (
    <section className="docker-detail" aria-label={container.name}>
      <div className="docker-detail-bar">
        <span className={`docker-dot ${container.state}`} />
        <strong className="docker-detail-name">{container.name}</strong>
        <span className="tool-muted docker-detail-status">{container.status}</span>
        <div className="toolbar-spacer" />
        <div className="todo-seg" role="tablist">
          {(['logs', 'stats', 'inspect'] as const).map((id) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {t(`docker.tab.${id}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      {tab === 'logs' && <Logs container={container} />}
      {tab === 'stats' && <Stats container={container} />}
      {tab === 'inspect' && <Inspect container={container} onOpenFolder={onOpenFolder} />}
    </section>
  )
}

/** Starts a stream for as long as the component lives (and `deps` stay), handing its events to `on`. */
function useStream(start: (() => Promise<string>) | null, on: (event: Parameters<Parameters<typeof api.docker.onStream>[0]>[0]) => void, deps: unknown[]): string | null {
  const [error, setError] = useState<string | null>(null)
  const handler = useRef(on)
  handler.current = on
  useEffect(() => {
    if (!start) return
    let id: string | null = null
    let gone = false
    setError(null)
    const off = api.docker.onStream((e) => e.id === id && handler.current(e))
    start().then(
      (streamId) => (gone ? api.docker.stop(streamId) : (id = streamId)),
      (err: Error) => !gone && setError(err.message)
    )
    return () => {
      gone = true
      off()
      if (id) api.docker.stop(id)
    }
    // The caller's deps: the stream restarts exactly when they change.
  }, deps)
  return error
}

// ---- logs --------------------------------------------------------------------------------------

function Logs({ container }: { container: DockerContainer }): React.JSX.Element {
  const [tail, setTail] = useStored<number>('docker.tail', 500)
  const [timestamps, setTimestamps] = useStored('docker.timestamps', false)
  const [wrap, setWrap] = useStored('docker.wrap', true)
  const [follow, setFollow] = useState(true)
  const [filter, setFilter] = useState('')
  const [lines, setLines] = useState<DockerLogLine[]>([])
  const [ended, setEnded] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // A stopped container's logs end; starting it again opens a fresh stream.
  const live = container.state === 'running' || container.state === 'paused' || container.state === 'restarting'
  const error = useStream(
    () => {
      setLines([])
      setEnded(false)
      return api.docker.logs(container.id, tail, timestamps)
    },
    (e) => {
      if (e.kind === 'log') setLines((l) => (l.length + e.lines.length > MAX_LINES ? [...l, ...e.lines].slice(-MAX_LINES) : [...l, ...e.lines]))
      if (e.kind === 'end') setEnded(true)
    },
    [container.id, tail, timestamps, live]
  )

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines
  }, [lines, filter])

  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown, follow])

  // Scrolling up stops following, as in a terminal; scrolling back to the end resumes it.
  const onScroll = (): void => {
    const el = box.current
    if (!el) return
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atEnd !== follow) setFollow(atEnd)
  }

  const text = (): string => shown.map((l) => l.text).join('\n')
  const flash = (message: string): void => {
    setNote(message)
    setTimeout(() => setNote(null), 2000)
  }

  return (
    <div className="docker-logs">
      <div className="tool-row">
        <input className="tool-input grow" type="search" value={filter} spellCheck={false} placeholder={t('docker.logFilter')} onChange={(e) => setFilter(e.target.value)} />
        <select className="tool-input" value={tail} onChange={(e) => setTail(Number(e.target.value))} title={t('docker.tailTitle')}>
          {TAILS.map((n) => (
            <option key={n} value={n}>
              {n ? t('docker.tailLines', { n }) : t('docker.tailAll')}
            </option>
          ))}
        </select>
        <label className="settings-check">
          <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} />
          {t('docker.timestamps')}
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          {t('docker.wrap')}
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          {t('docker.follow')}
        </label>
        <button className="todo-btn" onClick={() => setLines([])}>
          {t('docker.clear')}
        </button>
        <button className="todo-btn" disabled={!shown.length} onClick={() => void navigator.clipboard.writeText(text()).then(() => flash(t('docker.copied')))}>
          {t('docker.copy')}
        </button>
        <button className="todo-btn" disabled={!shown.length} onClick={() => void api.docker.saveLogs(container.name, text()).then((saved) => saved && flash(t('docker.saved')))}>
          {t('docker.save')}
        </button>
        {note && <span className="tool-ok">{note}</span>}
      </div>
      {error && <p className="tool-error">{error}</p>}
      <div ref={box} className={`docker-log${wrap ? ' wrap' : ''}`} onScroll={onScroll} role="log" aria-live="off">
        {shown.length === 0 && <p className="tool-muted">{filter ? t('docker.noMatch') : ended ? t('docker.noLogs') : t('tools.working')}</p>}
        {shown.map((l, i) => (
          <div key={i} className={l.stream === 'stderr' ? 'err' : undefined}>
            {l.text || ' '}
          </div>
        ))}
        {ended && shown.length > 0 && <div className="docker-log-end">{t(live ? 'docker.logEnded' : 'docker.logStopped')}</div>}
      </div>
    </div>
  )
}

// ---- stats -------------------------------------------------------------------------------------

function Stats({ container }: { container: DockerContainer }): React.JSX.Element {
  const [history, setHistory] = useState<DockerStatsPoint[]>([])
  const running = container.state === 'running'
  const error = useStream(
    running
      ? () => {
          setHistory([])
          return api.docker.stats(container.id)
        }
      : null,
    (e) => e.kind === 'stats' && setHistory((h) => [...h.slice(-(HISTORY - 1)), e.point]),
    [container.id, running]
  )
  if (!running) return <p className="tool-muted">{t('docker.statsStopped')}</p>
  const last = history.at(-1)
  if (!last) return error ? <p className="tool-error">{error}</p> : <p className="tool-muted">{t('tools.working')}</p>
  return (
    <div className="sys docker-stats">
      <div className="sys-cards">
        <Card title={t('tools.sysCpu')} value={`${pct(last.cpu)} · ${t('docker.pids', { n: last.pids })}`}>
          <Graph floor={100} series={[{ values: history.map((p) => p.cpu), className: 's1' }]} />
        </Card>
        <Card title={t('tools.sysMemory')} value={last.memLimit ? `${formatSize(last.mem)} / ${formatSize(last.memLimit)}` : formatSize(last.mem)}>
          <Graph max={last.memLimit ? 100 : undefined} series={[{ values: history.map((p) => (p.memLimit ? (p.mem / p.memLimit) * 100 : p.mem)), className: 's2' }]} />
        </Card>
        <Card
          title={t('tools.sysNetwork')}
          value={rate((last.netRx ?? 0) + (last.netTx ?? 0))}
          legend={[
            ['s3', t('tools.sysReceived'), rate(last.netRx)],
            ['s4', t('tools.sysSent'), rate(last.netTx)]
          ]}
        >
          <Graph
            series={[
              { values: history.map((p) => p.netRx), className: 's3' },
              { values: history.map((p) => p.netTx), className: 's4' }
            ]}
          />
        </Card>
        <Card
          title={t('tools.sysDisk')}
          value={last.blkRead === null ? t('tools.sysNoData') : rate((last.blkRead ?? 0) + (last.blkWrite ?? 0))}
          legend={
            last.blkRead === null
              ? undefined
              : [
                  ['s5', t('tools.sysRead'), rate(last.blkRead)],
                  ['s6', t('tools.sysWrite'), rate(last.blkWrite)]
                ]
          }
        >
          <Graph
            series={[
              { values: history.map((p) => p.blkRead), className: 's5' },
              { values: history.map((p) => p.blkWrite), className: 's6' }
            ]}
          />
        </Card>
      </div>
    </div>
  )
}

// ---- inspect -----------------------------------------------------------------------------------

function Inspect({ container, onOpenFolder }: { container: DockerContainer; onOpenFolder(path: string): void }): React.JSX.Element {
  const [info, setInfo] = useState<DockerInspect | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  useEffect(() => {
    let live = true
    api.docker.inspect(container.id).then(
      (i) => live && (setInfo(i), setError(null)),
      (err: Error) => live && setError(err.message)
    )
    return () => {
      live = false
    }
  }, [container.id, container.state, container.status])

  if (error) return <p className="tool-error">{error}</p>
  if (!info) return <p className="tool-muted">{t('tools.working')}</p>
  const when = (iso: string | null): string => (iso ? formatDate(Date.parse(iso)) : '')
  const rows: [string, React.ReactNode][] = [
    [t('docker.image'), info.image],
    [t('docker.command'), <code key="cmd">{info.command}</code>],
    [t('docker.created'), when(info.created)],
    [t('docker.started'), when(info.started)],
    [t('docker.finished'), info.finished ? `${when(info.finished)} · ${t('docker.exitCode', { code: info.exitCode ?? '?' })}` : ''],
    [t('docker.health'), info.health ?? ''],
    [t('docker.restartPolicy'), info.restartPolicy],
    [t('docker.ports'), info.ports.length ? <PortLinks key="ports" ports={info.ports} all /> : ''],
    [t('docker.networks'), info.networks.map((n) => [n.name, n.ip].filter(Boolean).join(' · ')).join(', ')],
    ['ID', <code key="id">{info.id.slice(0, 12)}</code>]
  ]
  return (
    <div className="docker-inspect">
      <div className="tool-grid">
        {rows
          .filter(([, v]) => v !== '' && v !== null)
          .map(([k, v]) => (
            <Fragment key={k}>
              <span className="tool-label">{k}</span>
              <span className="sys-cell">{v}</span>
            </Fragment>
          ))}
      </div>
      {info.mounts.length > 0 && (
        <>
          <h4 className="tool-subtitle">{t('docker.mounts')}</h4>
          <div className="docker-kv">
            {info.mounts.map((m) => (
              <div key={m.destination} className="docker-kv-row">
                <code>{m.destination}</code>
                <span className="tool-muted">←</span>
                <span className="sys-cell">{m.type === 'volume' ? `${t('docker.volume')} ${m.name}` : m.source}</span>
                {!m.rw && <span className="docker-badge">{t('docker.readOnly')}</span>}
                {m.type === 'bind' && (
                  <button className="todo-btn" onClick={() => onOpenFolder(m.source)}>
                    {t('docker.openFolder')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {info.env.length > 0 && (
        <>
          <div className="docker-subtitle">
            <h4 className="tool-subtitle">{t('docker.env')}</h4>
            <button className="todo-btn" onClick={() => setReveal(!reveal)}>
              {t(reveal ? 'docker.hideValues' : 'docker.showValues')}
            </button>
          </div>
          <div className="docker-kv">
            {info.env.map((pair, i) => {
              const at = pair.indexOf('=')
              const key = at < 0 ? pair : pair.slice(0, at)
              const value = at < 0 ? '' : pair.slice(at + 1)
              return (
                <div key={i} className="docker-kv-row">
                  <code>{key}</code>
                  <span className="sys-cell mono">{reveal ? value : value ? '••••••' : ''}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
      {Object.keys(info.labels).length > 0 && (
        <details className="docker-labels">
          <summary className="tool-subtitle">{t('docker.labels', { n: Object.keys(info.labels).length })}</summary>
          <div className="docker-kv">
            {Object.entries(info.labels).map(([k, v]) => (
              <div key={k} className="docker-kv-row">
                <code>{k}</code>
                <span className="sys-cell mono">{v}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/** Published ports as links to localhost; `all` also lists the unpublished ones, otherwise the first and "+n" (all in the tooltip). */
export function PortLinks({ ports, all = false }: { ports: DockerContainer['ports']; all?: boolean }): React.JSX.Element {
  const published = ports.filter((p) => p.public !== null)
  const shown = all ? ports : published.slice(0, 1)
  const more = all ? 0 : published.length - shown.length
  return (
    <span className="docker-ports" title={more ? published.map((p) => `${p.public} → ${p.private}/${p.type}`).join('\n') : undefined}>
      {shown.map((p) =>
        p.public !== null ? (
          <a
            key={`${p.public}-${p.private}-${p.type}`}
            href={`http://localhost:${p.public}`}
            title={`${p.ip ?? ''}:${p.public} → ${p.private}/${p.type}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void api.docker.openPort(p.public as number)
            }}
          >
            {p.public}
            {p.public !== p.private ? `→${p.private}` : ''}
          </a>
        ) : (
          <span key={`${p.private}-${p.type}`} className="tool-muted">
            {p.private}/{p.type}
          </span>
        )
      )}
      {more > 0 && <span className="tool-muted">+{more}</span>}
    </span>
  )
}
