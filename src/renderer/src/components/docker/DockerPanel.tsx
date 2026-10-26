import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { plural, t, tos, type MessageKey } from '@shared/i18n'
import {
  groupContainers,
  shortId,
  type ComposeAction,
  type ContainerAction,
  type DockerContainer,
  type DockerDiskUsage,
  type DockerImage,
  type DockerNetwork,
  type DockerPruneKind,
  type DockerStatus,
  type DockerUsage,
  type DockerVolume
} from '@shared/docker'
import { baseName } from '@shared/paths'
import { formatRelative, formatSize } from '@renderer/lib/format'
import { useStored } from '../tools/common'
import { pct, usePoll } from '../tools/SystemMonitor'
import { ContainerDetail, PortLinks } from './ContainerDetail'

// The Docker area: the engine's state, containers grouped by compose project with their live logs, stats
// and details, images, volumes, networks and clean-up – what one would otherwise type in a terminal.
// Everything is loaded while the area is visible; engine events tell it when to reload.

const api = window.api
const USAGE_MS = 3000
/** While the engine is down: how often to look whether it came up (e.g. after starting Docker Desktop). */
const STATUS_MS = 4000

type Tab = 'containers' | 'images' | 'volumes' | 'networks' | 'cleanup'
const TABS: Tab[] = ['containers', 'images', 'volumes', 'networks', 'cleanup']

interface Props {
  visible: boolean
  /** The folder of the focused file list: its compose file can be started from here. */
  folder: string
  onShell(id: string, name: string): void
  onOpenFolder(path: string): void
}

/** An action waiting for a second click, shown as a bar like the Task Manager's. */
interface Confirm {
  text: string
  label: string
  run(): Promise<unknown>
}

export default function DockerPanel({ visible, folder, onShell, onOpenFolder }: Props): React.JSX.Element {
  const [status, setStatus] = useState<DockerStatus | null>(null)
  const [tab, setTab] = useStored<Tab>('docker.tab', 'containers')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  /** Bumped by engine events: the tabs reload what they show. */
  const [epoch, setEpoch] = useState(0)

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.docker.status())
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    if (visible) void loadStatus()
  }, [visible, loadStatus])
  const running = status?.state === 'running'
  usePoll(visible && status !== null && !running, STATUS_MS, loadStatus)

  // Engine events while visible; when the stream ends the engine probably stopped, so its state is asked again.
  useEffect(() => {
    if (!visible || !running) return
    let id: string | null = null
    let gone = false
    const off = api.docker.onStream((e) => {
      if (e.id !== id) return
      if (e.kind === 'changed') setEpoch((n) => n + 1)
      if (e.kind === 'end' && !gone) void loadStatus()
    })
    api.docker.events().then(
      (streamId) => (gone ? api.docker.stop(streamId) : (id = streamId)),
      () => {}
    )
    return () => {
      gone = true
      off()
      if (id) api.docker.stop(id)
    }
  }, [visible, running, loadStatus])

  /** Runs an action with the area marked busy; errors show above the tab, output (compose) below it. */
  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setConfirm(null)
    setBusy(label)
    setError(null)
    try {
      const result = await fn()
      if (typeof result === 'string' && result.trim()) setOutput(result.trim())
      setEpoch((n) => n + 1)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const ask = (c: Confirm): void => setConfirm(c)
  const ctx: Ctx = { visible, epoch, busy, run, ask, onShell, onOpenFolder, folder }

  return (
    <div className="tool sys docker fill">
      <div className="docker-bar">
        <span className={`docker-dot ${running ? 'running' : 'exited'}`} />
        <span className="docker-engine" title={status?.host ?? undefined}>
          {status === null ? t('tools.working') : running ? engineLine(status) : t(status.state === 'missing' ? 'docker.missing' : 'docker.stopped')}
        </span>
        <div className="toolbar-spacer" />
        {running && (
          <div className="todo-seg" role="tablist">
            {TABS.map((id) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {t(`docker.tab.${id}` as MessageKey)}
              </button>
            ))}
          </div>
        )}
      </div>
      {confirm && (
        <div className="tool-row sys-confirm">
          <span>{confirm.text}</span>
          <button className="todo-btn" onClick={() => void run(confirm.label, confirm.run)}>
            {confirm.label}
          </button>
          <button className="todo-btn" onClick={() => setConfirm(null)}>
            {t('dialog.cancel')}
          </button>
        </div>
      )}
      {busy && <p className="tool-muted docker-busy">{t('docker.busy', { action: busy })}</p>}
      {error && <p className="tool-error docker-error">{error}</p>}
      {output && (
        <div className="docker-output">
          <pre className="tool-block mono">{output}</pre>
          <button className="todo-btn" onClick={() => setOutput(null)}>
            {t('docker.hideOutput')}
          </button>
        </div>
      )}
      {status && !running && <EngineDown status={status} onStart={() => void run(t('docker.starting'), () => api.docker.startDesktop())} onRetry={() => void loadStatus()} />}
      {running && tab === 'containers' && <Containers {...ctx} />}
      {running && tab === 'images' && <Images {...ctx} />}
      {running && tab === 'volumes' && <Volumes {...ctx} />}
      {running && tab === 'networks' && <Networks {...ctx} />}
      {running && tab === 'cleanup' && <Cleanup {...ctx} />}
    </div>
  )
}

interface Ctx {
  visible: boolean
  epoch: number
  busy: string | null
  folder: string
  run(label: string, fn: () => Promise<unknown>): Promise<void>
  ask(c: Confirm): void
  onShell(id: string, name: string): void
  onOpenFolder(path: string): void
}

const engineLine = (s: DockerStatus): string =>
  [`Docker ${s.version ?? ''}`.trim(), s.os, s.running !== undefined && s.containers !== undefined ? t('docker.runningOf', { running: s.running, total: s.containers }) : null].filter(Boolean).join(' · ')

function EngineDown({ status, onStart, onRetry }: { status: DockerStatus; onStart(): void; onRetry(): void }): React.JSX.Element {
  return (
    <div className="docker-empty">
      <p>{status.state === 'missing' ? t('docker.missingHint') : tos('docker.stoppedHint')}</p>
      <div className="tool-row">
        {status.desktop && (
          <button className="todo-btn" onClick={onStart}>
            {t('docker.startDesktop', { name: status.desktop })}
          </button>
        )}
        <button className="todo-btn" onClick={onRetry}>
          {t('docker.retry')}
        </button>
      </div>
    </div>
  )
}

/** Loads a list with the area, again on engine events and after actions. */
function useList<T>(ctx: Ctx, load: () => Promise<T>): [T | null, string | null] {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(load)
  latest.current = load
  useEffect(() => {
    if (!ctx.visible) return
    let live = true
    latest.current().then(
      (v) => live && (setValue(v), setError(null)),
      (err: Error) => live && setError(err.message)
    )
    return () => {
      live = false
    }
  }, [ctx.visible, ctx.epoch])
  return [value, error]
}

/** One header cell of a list; the file list's classes, so every theme draws it like the file list. */
const Head = ({ label, right = false }: { label: MessageKey; right?: boolean }): React.JSX.Element => (
  <div role="columnheader" className={`col-header${right ? ' right' : ''}`}>
    {t(label)}
  </div>
)

function Meter({ share }: { share: number }): React.JSX.Element {
  return (
    <i className="sys-mini" aria-hidden="true">
      <b style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
    </i>
  )
}

// ---- containers --------------------------------------------------------------------------------

const CONTAINER_COLS = 'minmax(150px, 1.4fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(70px, 0.7fr) 92px 104px'

function Containers(ctx: Ctx): React.JSX.Element {
  const [list, listError] = useList(ctx, () => api.docker.containers())
  const [usage, setUsage] = useState<Map<string, DockerUsage>>(new Map())
  const [onlyRunning, setOnlyRunning] = useStored('docker.onlyRunning', false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [composeFile, setComposeFile] = useState<string | null>(null)

  usePoll(ctx.visible && (list?.some((c) => c.state === 'running') ?? false), USAGE_MS, async () => {
    setUsage(new Map((await api.docker.usage()).map((u) => [u.id, u])))
  })
  useEffect(() => {
    if (!ctx.visible) return
    let live = true
    api.docker.composeFile(ctx.folder).then((f) => live && setComposeFile(f), () => live && setComposeFile(null))
    return () => {
      live = false
    }
  }, [ctx.visible, ctx.folder])

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const shown = (list ?? []).filter(
      (c) => (!onlyRunning || c.state === 'running' || c.state === 'paused' || c.state === 'restarting') && (!q || [c.name, c.image, c.project ?? '', c.service ?? '', c.id].some((s) => s.toLowerCase().includes(q)))
    )
    return groupContainers(shown)
  }, [list, onlyRunning, filter])

  const chosen = list?.find((c) => c.id === selected) ?? null
  const act = (c: DockerContainer, action: ContainerAction): void => void ctx.run(t(`docker.action.${action}` as MessageKey), () => api.docker.action(c.id, action))
  const compose = (project: string, action: ComposeAction): void => void ctx.run(t(`docker.compose.${action}` as MessageKey), () => api.docker.compose(project, action))
  const projectFolder = (project: string): string | null => list?.find((c) => c.project === project && c.workingDir)?.workingDir ?? null
  const disabled = ctx.busy !== null

  return (
    <>
      {composeFile && !list?.some((c) => c.workingDir === ctx.folder) && (
        <div className="tool-row docker-hint">
          <span>{t('docker.composeHere', { file: composeFile, folder: baseName(ctx.folder) || ctx.folder })}</span>
          <button className="todo-btn" disabled={disabled} onClick={() => void ctx.run(t('docker.compose.up'), () => api.docker.composeUp(ctx.folder))}>
            {t('docker.composeUp')}
          </button>
        </div>
      )}
      <div className="tool-row">
        <input className="tool-input grow" type="search" value={filter} spellCheck={false} placeholder={t('docker.filter')} onChange={(e) => setFilter(e.target.value)} />
        <label className="settings-check">
          <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} />
          {t('docker.onlyRunning')}
        </label>
      </div>
      <div className="tool-row docker-actions">
        {chosen ? (
          <>
            {chosen.state === 'running' || chosen.state === 'restarting' ? (
              <button className="todo-btn" disabled={disabled} onClick={() => act(chosen, 'stop')}>
                {t('docker.action.stop')}
              </button>
            ) : chosen.state === 'paused' ? (
              <button className="todo-btn" disabled={disabled} onClick={() => act(chosen, 'unpause')}>
                {t('docker.action.unpause')}
              </button>
            ) : (
              <button className="todo-btn" disabled={disabled} onClick={() => act(chosen, 'start')}>
                {t('docker.action.start')}
              </button>
            )}
            <button className="todo-btn" disabled={disabled} onClick={() => act(chosen, 'restart')}>
              {t('docker.action.restart')}
            </button>
            {chosen.state === 'running' && (
              <button className="todo-btn" disabled={disabled} onClick={() => act(chosen, 'pause')}>
                {t('docker.action.pause')}
              </button>
            )}
            <button className="todo-btn" disabled={disabled || chosen.state !== 'running'} onClick={() => ctx.onShell(chosen.id, chosen.name)}>
              {t('docker.shell')}
            </button>
            <div className="toolbar-spacer" />
            <button
              className="todo-btn"
              disabled={disabled || (chosen.state !== 'running' && chosen.state !== 'paused')}
              onClick={() => ctx.ask({ text: t('docker.confirmKill', { name: chosen.name }), label: t('docker.action.kill'), run: () => api.docker.action(chosen.id, 'kill') })}
            >
              {t('docker.action.kill')}
            </button>
            <button
              className="todo-btn"
              disabled={disabled}
              onClick={() =>
                ctx.ask({
                  text: t(chosen.state === 'running' ? 'docker.confirmRemoveRunning' : 'docker.confirmRemove', { name: chosen.name }),
                  label: t('docker.action.remove'),
                  run: async () => {
                    await api.docker.action(chosen.id, 'remove')
                    setSelected(null)
                  }
                })
              }
            >
              {t('docker.action.remove')}
            </button>
          </>
        ) : (
          <span className="tool-muted">{list ? plural('docker.containerCount', list.length, { n: list.length }) + ' · ' + t('docker.pickHint') : ''}</span>
        )}
      </div>
      {listError && <p className="tool-error">{listError}</p>}
      <div className={`docker-split${chosen ? ' with-detail' : ''}`}>
        <div className="sys-procs docker-list" role="table">
          <div className="list-header" role="row" style={{ gridTemplateColumns: CONTAINER_COLS }}>
            <Head label="docker.col.name" />
            <Head label="docker.col.image" />
            <Head label="docker.col.status" />
            <Head label="docker.col.ports" />
            <Head label="tools.sysCpu" right />
            <Head label="tools.sysMemory" right />
          </div>
          {list === null && !listError && <p className="tool-muted docker-pad">{t('tools.working')}</p>}
          {list !== null && groups.length === 0 && <p className="tool-muted docker-pad">{t(list.length ? 'docker.noMatch' : 'docker.noContainers')}</p>}
          {groups.map((g) => {
            const up = g.containers.filter((c) => c.state === 'running').length
            const dir = g.project ? projectFolder(g.project) : null
            return (
              <div key={g.project ?? ''} role="rowgroup">
                <div className="docker-group">
                  <strong>{g.project ?? t('docker.standalone')}</strong>
                  <span className="tool-muted">{t('docker.runningOf', { running: up, total: g.containers.length })}</span>
                  {g.project && (
                    <span className="docker-group-actions">
                      {up < g.containers.length && (
                        <button className="todo-btn" disabled={disabled || !dir} onClick={() => compose(g.project as string, 'up')}>
                          {t('docker.compose.up')}
                        </button>
                      )}
                      {up > 0 && (
                        <button className="todo-btn" disabled={disabled || !dir} onClick={() => compose(g.project as string, 'restart')}>
                          {t('docker.compose.restart')}
                        </button>
                      )}
                      {up > 0 && (
                        <button className="todo-btn" disabled={disabled || !dir} onClick={() => compose(g.project as string, 'stop')}>
                          {t('docker.compose.stop')}
                        </button>
                      )}
                      <button className="todo-btn" disabled={disabled || !dir} onClick={() => compose(g.project as string, 'pull')}>
                        {t('docker.compose.pull')}
                      </button>
                      <button
                        className="todo-btn"
                        disabled={disabled || !dir}
                        onClick={() => ctx.ask({ text: t('docker.confirmDown', { project: g.project as string }), label: t('docker.compose.down'), run: () => api.docker.compose(g.project as string, 'down') })}
                      >
                        {t('docker.compose.down')}
                      </button>
                      {dir && (
                        <button className="todo-btn" title={dir} onClick={() => ctx.onOpenFolder(dir)}>
                          {t('docker.openFolder')}
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {g.containers.map((c) => {
                  const u = usage.get(c.id)
                  return (
                    <div
                      key={c.id}
                      role="row"
                      aria-selected={c.id === selected}
                      className={`row${c.id === selected ? ' selected' : ''}`}
                      style={{ gridTemplateColumns: CONTAINER_COLS }}
                      onClick={() => setSelected(c.id === selected ? null : c.id)}
                      onDoubleClick={() => c.state === 'running' && ctx.onShell(c.id, c.name)}
                    >
                      <div className="cell docker-name" title={c.name}>
                        <span className={`docker-dot ${c.state}`} title={t(`docker.state.${c.state}` as MessageKey)} />
                        {c.service ?? c.name}
                      </div>
                      <div className="cell muted" title={c.image}>
                        {c.image}
                      </div>
                      <div className="cell muted" title={c.status}>
                        {c.status}
                      </div>
                      <div className="cell">
                        <PortLinks ports={c.ports} />
                      </div>
                      <div className="cell num sys-load cpu">
                        {u && (
                          <>
                            <Meter share={u.cpu} />
                            {pct(u.cpu)}
                          </>
                        )}
                      </div>
                      <div className="cell num sys-load mem" title={u?.memLimit ? pct((u.mem / u.memLimit) * 100) : undefined}>
                        {u && (
                          <>
                            <Meter share={u.memLimit ? (u.mem / u.memLimit) * 100 : 0} />
                            {formatSize(u.mem)}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
        {chosen && <ContainerDetail key={chosen.id} container={chosen} onOpenFolder={ctx.onOpenFolder} />}
      </div>
    </>
  )
}

// ---- images ------------------------------------------------------------------------------------

const IMAGE_COLS = 'minmax(180px, 2fr) 110px 90px 110px 90px'

function Images(ctx: Ctx): React.JSX.Element {
  const [list, listError] = useList(ctx, () => api.docker.images())
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [image, setImage] = useState('')
  const [pull, setPull] = useState<{ id: string | null; status: string; percent: number | null; error?: string; done?: boolean } | null>(null)

  useEffect(() => {
    if (!pull?.id) return
    return api.docker.onStream((e) => {
      if (e.id !== pull.id) return
      if (e.kind === 'pull') setPull((p) => p && { ...p, status: e.status, percent: e.percent ?? p.percent })
      if (e.kind === 'end') setPull((p) => p && { ...p, id: null, done: !e.error, error: e.error })
    })
  }, [pull?.id])

  const startPull = async (): Promise<void> => {
    const ref = image.trim()
    if (!ref) return
    setPull({ id: null, status: t('docker.pullStarting'), percent: null })
    try {
      const id = await api.docker.pull(ref)
      setPull((p) => p && { ...p, id })
    } catch (err) {
      setPull({ id: null, status: '', percent: null, error: (err as Error).message })
    }
  }

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (list ?? []).filter((i) => !q || i.tags.some((tag) => tag.toLowerCase().includes(q)) || i.id.includes(q)).sort((a, b) => b.created - a.created)
  }, [list, filter])
  const chosen = list?.find((i) => i.id === selected) ?? null
  const name = (i: DockerImage): string => i.tags[0] ?? shortId(i.id)

  return (
    <>
      <div className="tool-row">
        <input
          className="tool-input grow"
          value={image}
          spellCheck={false}
          placeholder={t('docker.pullPlaceholder')}
          onChange={(e) => setImage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void startPull()}
        />
        <button className="todo-btn" disabled={!image.trim() || Boolean(pull?.id)} onClick={() => void startPull()}>
          {t('docker.pull')}
        </button>
      </div>
      {pull && (
        <div className="tool-row docker-pull">
          {pull.error ? (
            <span className="tool-error">{pull.error}</span>
          ) : (
            <>
              <div className="sys-meter">
                <div style={{ width: `${pull.done ? 100 : (pull.percent ?? 0)}%` }} />
              </div>
              <span className={pull.done ? 'tool-ok' : 'tool-muted'}>{pull.done ? t('docker.pullDone') : pull.status}</span>
            </>
          )}
          {(pull.done || pull.error) && (
            <button className="todo-btn" onClick={() => setPull(null)}>
              {t('docker.hideOutput')}
            </button>
          )}
        </div>
      )}
      <div className="tool-row docker-actions">
        <input className="tool-input grow" type="search" value={filter} spellCheck={false} placeholder={t('docker.filter')} onChange={(e) => setFilter(e.target.value)} />
        <button
          className="todo-btn"
          disabled={!chosen || ctx.busy !== null}
          onClick={() =>
            chosen &&
            ctx.ask({
              text: t(chosen.containers ? 'docker.confirmRemoveImageUsed' : 'docker.confirmRemoveImage', { name: name(chosen), n: chosen.containers }),
              label: t('docker.action.remove'),
              run: () => api.docker.removeImage(chosen.id, chosen.containers > 0)
            })
          }
        >
          {t('docker.action.remove')}
        </button>
      </div>
      {listError && <p className="tool-error">{listError}</p>}
      <div className="sys-procs docker-list" role="table">
        <div className="list-header" role="row" style={{ gridTemplateColumns: IMAGE_COLS }}>
          <Head label="docker.col.image" />
          <Head label="docker.col.id" />
          <Head label="docker.col.size" right />
          <Head label="docker.col.created" />
          <Head label="docker.col.used" right />
        </div>
        {list !== null && rows.length === 0 && <p className="tool-muted docker-pad">{t('docker.noImages')}</p>}
        {rows.map((i) => (
          <div key={i.id} role="row" aria-selected={i.id === selected} className={`row${i.id === selected ? ' selected' : ''}`} style={{ gridTemplateColumns: IMAGE_COLS }} onClick={() => setSelected(i.id === selected ? null : i.id)}>
            <div className="cell" title={i.tags.join('\n')}>
              {i.dangling ? <span className="muted">{t('docker.untagged')}</span> : i.tags.join(', ')}
            </div>
            <div className="cell muted mono">{shortId(i.id)}</div>
            <div className="cell num">{formatSize(i.size)}</div>
            <div className="cell muted">{formatRelative(i.created)}</div>
            <div className="cell num muted">{i.containers || '—'}</div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---- volumes and networks ----------------------------------------------------------------------

const VOLUME_COLS = 'minmax(180px, 2fr) 80px minmax(120px, 1.5fr) 110px'

function Volumes(ctx: Ctx): React.JSX.Element {
  const [list, listError] = useList(ctx, () => api.docker.volumes())
  const [selected, setSelected] = useState<string | null>(null)
  const chosen = list?.find((v) => v.name === selected) ?? null
  return (
    <>
      <div className="tool-row docker-actions">
        <span className="tool-muted">{list ? plural('docker.volumeCount', list.length, { n: list.length }) : ''}</span>
        <div className="toolbar-spacer" />
        <button
          className="todo-btn"
          disabled={!chosen || chosen.usedBy.length > 0 || ctx.busy !== null}
          title={chosen?.usedBy.length ? t('docker.inUse', { names: chosen.usedBy.join(', ') }) : undefined}
          onClick={() => chosen && ctx.ask({ text: t('docker.confirmRemoveVolume', { name: chosen.name }), label: t('docker.action.remove'), run: () => api.docker.removeVolume(chosen.name) })}
        >
          {t('docker.action.remove')}
        </button>
      </div>
      {listError && <p className="tool-error">{listError}</p>}
      <div className="sys-procs docker-list" role="table">
        <div className="list-header" role="row" style={{ gridTemplateColumns: VOLUME_COLS }}>
          <Head label="docker.col.name" />
          <Head label="docker.col.driver" />
          <Head label="docker.col.usedBy" />
          <Head label="docker.col.created" />
        </div>
        {list !== null && list.length === 0 && <p className="tool-muted docker-pad">{t('docker.noVolumes')}</p>}
        {(list ?? []).map((v: DockerVolume) => (
          <div key={v.name} role="row" aria-selected={v.name === selected} className={`row${v.name === selected ? ' selected' : ''}`} style={{ gridTemplateColumns: VOLUME_COLS }} onClick={() => setSelected(v.name === selected ? null : v.name)}>
            <div className="cell" title={v.mountpoint}>
              {v.name.length === 64 && /^[0-9a-f]+$/.test(v.name) ? <span className="muted mono">{shortId(v.name)}</span> : v.name}
            </div>
            <div className="cell muted">{v.driver}</div>
            <div className="cell muted">{v.usedBy.join(', ') || '—'}</div>
            <div className="cell muted">{v.created ? formatRelative(Date.parse(v.created)) : ''}</div>
          </div>
        ))}
      </div>
    </>
  )
}

const NETWORK_COLS = 'minmax(160px, 1.5fr) 90px 70px minmax(120px, 2fr)'

function Networks(ctx: Ctx): React.JSX.Element {
  const [list, listError] = useList(ctx, () => api.docker.networks())
  const [selected, setSelected] = useState<string | null>(null)
  const chosen = list?.find((n) => n.id === selected) ?? null
  return (
    <>
      <div className="tool-row docker-actions">
        <span className="tool-muted">{list ? plural('docker.networkCount', list.length, { n: list.length }) : ''}</span>
        <div className="toolbar-spacer" />
        <button
          className="todo-btn"
          disabled={!chosen || chosen.builtin || chosen.containers.length > 0 || ctx.busy !== null}
          onClick={() => chosen && ctx.ask({ text: t('docker.confirmRemoveNetwork', { name: chosen.name }), label: t('docker.action.remove'), run: () => api.docker.removeNetwork(chosen.id) })}
        >
          {t('docker.action.remove')}
        </button>
      </div>
      {listError && <p className="tool-error">{listError}</p>}
      <div className="sys-procs docker-list" role="table">
        <div className="list-header" role="row" style={{ gridTemplateColumns: NETWORK_COLS }}>
          <Head label="docker.col.name" />
          <Head label="docker.col.driver" />
          <Head label="docker.col.scope" />
          <Head label="docker.col.containers" />
        </div>
        {(list ?? []).map((n: DockerNetwork) => (
          <div key={n.id} role="row" aria-selected={n.id === selected} className={`row${n.id === selected ? ' selected' : ''}`} style={{ gridTemplateColumns: NETWORK_COLS }} onClick={() => setSelected(n.id === selected ? null : n.id)}>
            <div className="cell">
              {n.name}
              {n.builtin && <span className="docker-badge">{t('docker.builtin')}</span>}
            </div>
            <div className="cell muted">{n.driver}</div>
            <div className="cell muted">{n.scope}</div>
            <div className="cell muted">{n.containers.join(', ') || '—'}</div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---- clean-up ----------------------------------------------------------------------------------

const DF_COLS = 'minmax(140px, 1.5fr) 80px 100px 120px 110px'

function Cleanup(ctx: Ctx): React.JSX.Element {
  const [df, dfError] = useList<DockerDiskUsage>(ctx, () => api.docker.diskUsage())
  const [freed, setFreed] = useState<string | null>(null)
  const kinds: DockerPruneKind[] = ['containers', 'images', 'volumes', 'networks', 'buildCache']
  const row = (k: DockerPruneKind): { count: number; size: number; reclaimable: number } | null => (df && k !== 'networks' ? df[k] : null)
  return (
    <>
      <p className="tool-muted">{t('docker.cleanupHint')}</p>
      {freed && <p className="tool-ok">{freed}</p>}
      {dfError && <p className="tool-error">{dfError}</p>}
      <div className="sys-procs docker-list docker-df" role="table">
        <div className="list-header" role="row" style={{ gridTemplateColumns: DF_COLS }}>
          <Head label="docker.col.kind" />
          <Head label="docker.col.count" right />
          <Head label="docker.col.size" right />
          <Head label="docker.col.reclaimable" right />
          <div role="columnheader" className="col-header" />
        </div>
        {kinds.map((k) => {
          const r = row(k)
          return (
            <div key={k} role="row" className="row" style={{ gridTemplateColumns: DF_COLS }}>
              <div className="cell">{t(`docker.kind.${k}` as MessageKey)}</div>
              <div className="cell num">{r ? r.count : ''}</div>
              <div className="cell num">{r ? formatSize(r.size) : ''}</div>
              <div className="cell num">{r ? formatSize(r.reclaimable) : ''}</div>
              <div className="cell">
                <button
                  className="todo-btn"
                  disabled={ctx.busy !== null || (r !== null && r.reclaimable === 0 && k !== 'containers')}
                  onClick={() =>
                    ctx.ask({
                      text: t(`docker.confirmPrune.${k}` as MessageKey, { size: r ? formatSize(r.reclaimable) : '' }),
                      label: t('docker.prune'),
                      run: async () => {
                        const bytes = await api.docker.prune(k)
                        setFreed(t('docker.freed', { size: formatSize(bytes) }))
                      }
                    })
                  }
                >
                  {t('docker.prune')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
