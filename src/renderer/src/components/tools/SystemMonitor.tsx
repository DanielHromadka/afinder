import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { t, tos, type MessageKey } from '@shared/i18n'
import type { SysInfo, SysProcess, SysSample, SysSensors } from '@shared/types'
import { formatSize, numberFormat } from '@renderer/lib/format'
import { api, ToolError, useStored, type ToolProps } from './common'

// The Task Manager: processes like htop, live graphs, and what the system tells about its hardware.
// Everything is polled from a worker, and only while the tool is visible.

const SAMPLE_MS = 1500
const PROCESSES_MS = 2500
const SENSORS_MS = 4000
/** Points kept per graph: 90 s at SAMPLE_MS. */
export const HISTORY = 60

type Tab = 'processes' | 'performance' | 'hardware'
type SortKey = 'pid' | 'name' | 'user' | 'cpu' | 'mem'

/** Calls `fn` every `ms` while `on`; a slow reading is never overlapped by the next one. */
export function usePoll(on: boolean, ms: number, fn: () => Promise<void>): void {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    if (!on) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async (): Promise<void> => {
      await latest.current().catch(() => undefined)
      if (!stopped) timer = setTimeout(() => void tick(), ms)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [on, ms])
}

export const pct = (n: number): string => `${numberFormat(n < 10 ? 1 : 0).format(n)} %`
export const rate = (n: number | null): string => (n === null ? '—' : `${formatSize(n)}/s`)
const temp = (n: number): string => `${numberFormat(0).format(n)} °C`

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return t('tools.sysDuration', { d, h, m })
}

export default function SystemMonitor({ visible }: Pick<ToolProps, 'visible'>): React.JSX.Element {
  const [tab, setTab] = useStored<Tab>('tasks.tab', 'performance')
  const [history, setHistory] = useState<SysSample[]>([])
  const [error, setError] = useState<string | null>(null)

  // Graphs keep filling on every tab, so switching to Performance shows the recent past.
  usePoll(visible, SAMPLE_MS, async () => {
    try {
      const s = await api.sys.sample()
      setHistory((h) => [...h.slice(-(HISTORY - 1)), s])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  })

  return (
    <div className={`tool sys${tab === 'processes' ? ' fill' : ''}`}>
      <div className="todo-seg sys-tabs" role="tablist">
        {(['processes', 'performance', 'hardware'] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {t(`tools.sysTab.${id}` as MessageKey)}
          </button>
        ))}
      </div>
      <ToolError text={error} />
      {tab === 'processes' && <Processes visible={visible} memTotal={history.at(-1)?.memTotal ?? 0}/>}
      {tab === 'performance' && <Performance history={history} />}
      {tab === 'hardware' && <Hardware visible={visible} />}
    </div>
  )
}

// ---- processes ---------------------------------------------------------------------------------

/** Columns of the process list; the file list's header and row classes draw it, so every theme styles both alike. */
const PROC_COLS = 'minmax(120px, 1.3fr) 60px minmax(70px, 0.6fr) 96px 112px 70px minmax(100px, 2fr)'

function Processes({ visible, memTotal }: { visible: boolean; memTotal: number }): React.JSX.Element {
  const [list, setList] = useState<SysProcess[] | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useStored<{ key: SortKey; desc: boolean }>('tasks.sort', { key: 'cpu', desc: true })
  const [selected, setSelected] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  usePoll(visible, PROCESSES_MS, async () => {
    try {
      setList(await api.sys.processes())
    } catch (err) {
      setError((err as Error).message)
    }
  })

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const shown = (list ?? []).filter((p) => !q || String(p.pid) === q || p.name.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) || p.command.toLowerCase().includes(q))
    const dir = sort.desc ? -1 : 1
    return shown.sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * dir || a.pid - b.pid
    })
  }, [list, filter, sort])

  const chosen = list?.find((p) => p.pid === selected) ?? null
  const end = async (force: boolean): Promise<void> => {
    if (!chosen) return
    setConfirm(null)
    try {
      await api.sys.kill(chosen.pid, force)
      setError(null)
      setList(await api.sys.processes())
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const header = (key: SortKey | null, label: MessageKey, right = false): React.JSX.Element => (
    <div
      role="columnheader"
      className={`col-header${right ? ' right' : ''}${key && sort.key === key ? ' sorted' : ''}`}
      aria-sort={key && sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}
      onClick={key ? () => setSort({ key, desc: sort.key === key ? !sort.desc : key === 'cpu' || key === 'mem' }) : undefined}
    >
      {t(label)}
      {key && sort.key === key && <span className="sort-arrow">{sort.desc ? '▼' : '▲'}</span>}
    </div>
  )
  // A small meter before the number: CPU against one core (where 100 % means a core is busy), memory against all of it.
  const meter = (share: number): React.JSX.Element => (
    <i className="sys-mini" aria-hidden="true">
      <b style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
    </i>
  )

  return (
    <>
      <div className="tool-row">
        <input className="tool-input grow" type="search" value={filter} spellCheck={false} placeholder={t('tools.sysFilter')} onChange={(e) => setFilter(e.target.value)} />
        {list && <span className="todo-count">{t('tools.sysCount', { shown: rows.length, total: list.length })}</span>}
        <button className="todo-btn" disabled={!chosen} onClick={() => setConfirm(false)}>
          {t('tools.sysEnd')}
        </button>
        <button className="todo-btn" disabled={!chosen} onClick={() => setConfirm(true)}>
          {t('tools.sysForce')}
        </button>
      </div>
      {chosen && confirm !== null && (
        <div className="tool-row sys-confirm">
          <span>{t('tools.sysConfirm', { name: chosen.name, pid: chosen.pid })}</span>
          <button className="todo-btn" onClick={() => void end(confirm)}>
            {t(confirm ? 'tools.sysForce' : 'tools.sysEnd')}
          </button>
          <button className="todo-btn" onClick={() => setConfirm(null)}>
            {t('dialog.cancel')}
          </button>
        </div>
      )}
      <ToolError text={error} />
      {list === null ? (
        <p className="tool-muted">{t('tools.working')}</p>
      ) : (
        <div className="sys-procs" role="table">
          <div className="list-header" role="row" style={{ gridTemplateColumns: PROC_COLS }}>
            {header('name', 'tools.sysName')}
            {header('pid', 'tools.sysPid', true)}
            {header('user', 'tools.sysUser')}
            {header('cpu', 'tools.sysCpu', true)}
            {header('mem', 'tools.sysMemory', true)}
            {header(null, 'tools.sysState')}
            {header(null, 'tools.sysCommand')}
          </div>
          {rows.map((p) => (
            <div
              key={p.pid}
              role="row"
              aria-selected={p.pid === selected}
              className={`row${p.pid === selected ? ' selected' : ''}`}
              style={{ gridTemplateColumns: PROC_COLS }}
              onClick={() => (setSelected(p.pid), setConfirm(null))}
            >
              <div className="cell" title={p.name}>{p.name}</div>
              <div className="cell right num muted">{p.pid}</div>
              <div className="cell muted">{p.user}</div>
              <div className="cell num sys-load cpu">
                {meter(p.cpu)}
                {pct(p.cpu)}
              </div>
              <div className="cell num sys-load mem" title={memTotal ? pct((p.mem / memTotal) * 100) : undefined}>
                {meter(memTotal ? (p.mem / memTotal) * 100 : 0)}
                {formatSize(p.mem)}
              </div>
              <div className="cell muted">{p.state}</div>
              <div className="cell muted" title={p.command}>
                {p.command}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ---- performance -------------------------------------------------------------------------------

interface Series {
  values: (number | null)[]
  className: string
}

/** A line graph over the last HISTORY readings; `max` fixes the scale (percent), otherwise it follows the peak, at least `floor`. */
export function Graph({ series, max, floor = 1024 }: { series: Series[]; max?: number; floor?: number }): React.JSX.Element {
  const peak = max ?? Math.max(floor, ...series.flatMap((s) => s.values.map((v) => v ?? 0))) * 1.1
  const x = (i: number, n: number): number => HISTORY - n + i
  const y = (v: number): number => 100 - (Math.min(v, peak) / peak) * 100
  return (
    <svg className="sys-graph" viewBox={`0 0 ${HISTORY - 1} 100`} preserveAspectRatio="none" aria-hidden="true">
      {[25, 50, 75].map((g) => (
        <line key={g} className="grid" x1={0} x2={HISTORY - 1} y1={g} y2={g} />
      ))}
      {series.map((s) => {
        const pts = s.values.map((v, i) => `${x(i, s.values.length) - 1},${y(v ?? 0)}`)
        if (pts.length < 2) return null
        const first = x(0, s.values.length) - 1
        return (
          <g key={s.className} className={s.className}>
            <path className="area" d={`M${first},100 L${pts.join(' L')} L${HISTORY - 1},100 Z`} />
            <polyline className="line" points={pts.join(' ')} />
          </g>
        )
      })}
    </svg>
  )
}

export function Card({ title, value, children, legend }: { title: string; value: string; children: React.ReactNode; legend?: [string, string, string][] }): React.JSX.Element {
  return (
    <section className="sys-card">
      <header>
        <span className="tool-label">{title}</span>
        <span className="sys-value">{value}</span>
      </header>
      {children}
      {legend && (
        <div className="sys-legend">
          {legend.map(([className, label, v]) => (
            <span key={className}>
              <i className={className} /> {label} {v}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function Performance({ history }: { history: SysSample[] }): React.JSX.Element {
  const last = history.at(-1)
  if (!last) return <p className="tool-muted">{t('tools.working')}</p>
  const memPct = (s: SysSample): number => (s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0)
  const noDisk = last.diskRead === null && last.diskWrite === null && history.length > 2
  return (
    <>
      <div className="sys-cards">
        <Card title={t('tools.sysCpu')} value={pct(last.cpu)}>
          <Graph max={100} series={[{ values: history.map((s) => s.cpu), className: 's1' }]} />
        </Card>
        <Card title={t('tools.sysMemory')} value={`${formatSize(last.memUsed)} / ${formatSize(last.memTotal)}`} legend={last.swapTotal ? [['s2', t('tools.sysSwap'), `${formatSize(last.swapUsed)} / ${formatSize(last.swapTotal)}`]] : undefined}>
          <Graph max={100} series={[{ values: history.map(memPct), className: 's2' }]} />
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
              { values: history.map((s) => s.netRx), className: 's3' },
              { values: history.map((s) => s.netTx), className: 's4' }
            ]}
          />
        </Card>
        <Card
          title={t('tools.sysDisk')}
          value={noDisk ? t('tools.sysNoData') : rate((last.diskRead ?? 0) + (last.diskWrite ?? 0))}
          legend={
            noDisk
              ? undefined
              : [
                  ['s5', t('tools.sysRead'), rate(last.diskRead)],
                  ['s6', t('tools.sysWrite'), rate(last.diskWrite)]
                ]
          }
        >
          <Graph
            series={[
              { values: history.map((s) => s.diskRead), className: 's5' },
              { values: history.map((s) => s.diskWrite), className: 's6' }
            ]}
          />
        </Card>
      </div>
      <h4 className="tool-subtitle">{t('tools.sysCores', { n: last.cores.length })}</h4>
      <div className="sys-cores">
        {last.cores.map((load, i) => (
          <div key={i} className="sys-core" title={pct(load)}>
            <span className="tool-muted">{i + 1}</span>
            <div className="sys-meter">
              <div style={{ width: `${Math.min(100, load)}%` }} />
            </div>
            <span className="num">{pct(load)}</span>
          </div>
        ))}
      </div>
      <div className="tool-grid">
        {last.load.some((l) => l > 0) && (
          <>
            <span className="tool-label">{t('tools.sysLoad')}</span>
            <span>{last.load.map((l) => numberFormat(2).format(l)).join('  ')}</span>
          </>
        )}
        <span className="tool-label">{t('tools.sysUptime')}</span>
        <span>{duration(last.uptime)}</span>
      </div>
    </>
  )
}

// ---- hardware ----------------------------------------------------------------------------------

function Rows({ rows }: { rows: [string, React.ReactNode][] }): React.JSX.Element {
  return (
    <div className="tool-grid">
      {rows
        .filter(([, v]) => v !== '' && v !== null && v !== undefined)
        .map(([k, v], i) => (
          <Fragment key={i}>
            <span className="tool-label">{k}</span>
            <span className="sys-cell">{v}</span>
          </Fragment>
        ))}
    </div>
  )
}

function Hardware({ visible }: { visible: boolean }): React.JSX.Element {
  const [info, setInfo] = useState<SysInfo | null>(null)
  const [sensors, setSensors] = useState<SysSensors | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.sys.info().then(setInfo, (err: Error) => setError(err.message))
  }, [])
  usePoll(visible, SENSORS_MS, async () => setSensors(await api.sys.sensors()))

  const ghz = (n: number): string => `${numberFormat(2).format(n)} GHz`
  const temps: [string, React.ReactNode][] = sensors
    ? [
        ...(sensors.cpu !== null ? [[t('tools.sysTempCpu'), sensors.cpuMax && sensors.cpuMax > sensors.cpu ? `${temp(sensors.cpu)} (max ${temp(sensors.cpuMax)})` : temp(sensors.cpu)] as [string, string]] : []),
        ...(sensors.cores.length ? [[t('tools.sysTempCores'), sensors.cores.map(temp).join(', ')] as [string, string]] : []),
        ...sensors.gpus.map((g) => [g.name, temp(g.temp)] as [string, string]),
        ...sensors.fans.map((f) => [f.name, `${numberFormat(0).format(f.rpm)} RPM`] as [string, string])
      ]
    : []
  const battery = sensors?.battery

  return (
    <>
      <ToolError text={error} />
      {!info ? (
        !error && <p className="tool-muted">{t('tools.working')}</p>
      ) : (
        <>
          <h4 className="tool-subtitle">{t('tools.sysSystem')}</h4>
          <Rows
            rows={[
              [t('tools.sysOs'), info.os.name],
              [t('tools.sysVersion'), info.os.version],
              [t('tools.sysBuild'), info.os.build],
              [t('tools.sysKernel'), info.os.kernel],
              [t('tools.sysArch'), info.os.arch],
              [t('tools.sysHost'), info.os.hostname],
              [t('tools.sysMachine'), [info.machine.vendor, info.machine.model].filter(Boolean).join(' ') + (info.machine.virtual ? ` ${t('tools.sysVirtual')}` : '')],
              ['aFinder', `Electron ${info.app.electron} · Chromium ${info.app.chrome} · Node ${info.app.node}`]
            ]}
          />
          <h4 className="tool-subtitle">{t('tools.sysHardware')}</h4>
          <Rows
            rows={[
              [t('tools.sysProcessor'), info.cpu.name],
              [
                t('tools.sysCoresLabel'),
                t('tools.sysCoresValue', { cores: info.cpu.cores, physical: info.cpu.physical }) +
                  (info.cpu.performance && info.cpu.efficiency ? ` · ${t('tools.sysCoresSplit', { p: info.cpu.performance, e: info.cpu.efficiency })}` : '')
              ],
              [t('tools.sysFrequency'), info.cpu.ghz ? (info.cpu.ghzMax && info.cpu.ghzMax > info.cpu.ghz ? `${ghz(info.cpu.ghz)} – ${ghz(info.cpu.ghzMax)}` : ghz(info.cpu.ghz)) : ''],
              [
                t('tools.sysMemory'),
                formatSize(info.memory.total) + (info.memory.modules.length ? ` (${info.memory.modules.map((m) => [formatSize(m.size), m.type, m.mhz && `${m.mhz} MHz`].filter(Boolean).join(' ')).join(', ')})` : '')
              ],
              ...info.gpus.map((g) => [t('tools.sysGraphics'), [g.name, g.vram && formatSize(g.vram * 1024 * 1024), g.cores && t('tools.sysGpuCores', { n: g.cores })].filter(Boolean).join(' · ')] as [string, string]),
              ...info.displays.map(
                (d) => [t('tools.sysDisplay'), [d.name, d.width && `${d.width} × ${d.height}`, d.hz && `${d.hz} Hz`, d.builtin && t('tools.sysBuiltin')].filter(Boolean).join(' · ')] as [string, string]
              ),
              ...info.disks.map((d) => [t('tools.sysDiskDevice'), [d.name, d.type, d.iface, formatSize(d.size)].filter(Boolean).join(' · ')] as [string, string])
            ]}
          />
          {info.volumes.length > 0 && (
            <>
              <h4 className="tool-subtitle">{t('tools.sysVolumes')}</h4>
              <div className="sys-volumes">
                {info.volumes.map((v) => (
                  <div key={v.mount} className="sys-core" title={v.mount}>
                    <span className="sys-mount">{v.mount}</span>
                    <div className="sys-meter">
                      <div style={{ width: `${Math.min(100, (v.used / v.size) * 100)}%` }} />
                    </div>
                    <span className="tool-muted">{t('tools.sysVolumeValue', { used: formatSize(v.used), size: formatSize(v.size), fs: v.fs })}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <h4 className="tool-subtitle">{t('tools.sysSensors')}</h4>
      {!sensors ? (
        <p className="tool-muted">{t('tools.working')}</p>
      ) : temps.length ? (
        <Rows rows={temps} />
      ) : (
        <p className="tool-muted">{tos('tools.sysSensorsNone')}</p>
      )}
      {battery && (
        <>
          <h4 className="tool-subtitle">{t('tools.sysBattery')}</h4>
          <Rows
            rows={[
              [t('tools.sysCharge'), `${pct(battery.percent)} · ${t(battery.charging ? 'tools.sysCharging' : battery.plugged ? 'tools.sysOnPower' : 'tools.sysOnBattery')}`],
              [t('tools.sysTimeLeft'), battery.minutesLeft && !battery.plugged ? duration(battery.minutesLeft * 60) : ''],
              [t('tools.sysHealth'), battery.health !== null ? pct(battery.health) : ''],
              [t('tools.sysCycles'), battery.cycles > 0 ? String(battery.cycles) : '']
            ]}
          />
        </>
      )}
    </>
  )
}
