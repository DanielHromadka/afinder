// Runs in an Electron utilityProcess: the Task Manager's readings, off the main process. systeminformation
// spawns ps, powershell, system_profiler and friends, and parsing their output for hundreds of processes
// every couple of seconds has no place on the main thread.
//
// Parent → worker: { id, type: 'sample' | 'processes' | 'sensors' | 'info' }
// Worker → parent: { id, result } | { id, error }

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import si from 'systeminformation'
import type { SysInfo, SysProcess, SysSample, SysSensors } from '@shared/types'

const parentPort = process.parentPort
const LOOPBACK = /^lo\d*$|loopback/i
/** Volumes nobody looks for: kernel and package mounts, macOS system snapshots. */
const HIDDEN_FS = /^(tmpfs|devtmpfs|devfs|squashfs|overlay|autofs|proc|sysfs|ramfs|efivarfs|nullfs)$/i
const HIDDEN_MOUNT = /^\/(System\/Volumes\/(?!Data$)|snap\/|boot\/efi|dev\/|run\/|private\/|Library\/Developer\/CoreSimulator\/)/
/** Joins parts, dropping empty ones and repeats ("Apple" + "Apple M5" is just "Apple M5"). */
const label = (...parts: (string | undefined)[]): string =>
  parts.filter((p, i): p is string => !!p && p !== '-' && !parts.slice(i + 1).some((q) => q?.startsWith(p)) && parts.indexOf(p) === i).join(' ')

// One PowerShell kept open instead of a new one for every query (seconds each on Windows).
if (process.platform === 'win32') si.powerShellStart()

const positive = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null)
const settle = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback)

async function sample(): Promise<SysSample> {
  const [load, mem, net, disk] = await Promise.all([si.currentLoad(), si.mem(), settle(si.networkStats('*'), []), process.platform === 'win32' ? null : settle(si.fsStats(), null)])
  const ifaces = net.filter((n) => !LOOPBACK.test(n.iface))
  const rate = (k: 'rx_sec' | 'tx_sec'): number | null => (ifaces.some((n) => typeof n[k] === 'number' && n[k] >= 0) ? ifaces.reduce((a, n) => a + Math.max(0, n[k] ?? 0), 0) : null)
  const disks = (v: number | null | undefined): number | null => (typeof v === 'number' && v >= 0 ? v : null)
  return {
    cpu: load.currentLoad,
    cores: load.cpus.map((c) => c.load),
    // available, not free: caches the system gives back on demand are not "used".
    memUsed: mem.total - mem.available,
    memTotal: mem.total,
    swapUsed: mem.swapused,
    swapTotal: mem.swaptotal,
    netRx: rate('rx_sec'),
    netTx: rate('tx_sec'),
    diskRead: disks(disk?.rx_sec),
    diskWrite: disks(disk?.wx_sec),
    load: os.loadavg(),
    uptime: os.uptime()
  }
}

async function processes(): Promise<SysProcess[]> {
  const { list } = await si.processes()
  return list.map((p) => ({
    pid: p.pid,
    ppid: p.parentPid,
    name: p.name,
    user: p.user,
    cpu: p.cpu,
    // ps and /proc report kilobytes.
    mem: p.memRss * 1024,
    state: p.state,
    command: [p.path && !p.command.includes('/') && !p.command.includes('\\') ? path.join(p.path, p.command) : p.command, p.params].filter(Boolean).join(' ')
  }))
}

/** Linux exposes fans in hwmon; macOS (SMC) and Windows (vendor WMI) would need native code or admin rights. */
async function linuxFans(): Promise<SysSensors['fans']> {
  if (process.platform !== 'linux') return []
  const root = '/sys/class/hwmon'
  const fans: SysSensors['fans'] = []
  for (const dir of await settle(fs.readdir(root), [])) {
    const base = path.join(root, dir)
    const chip = (await settle(fs.readFile(path.join(base, 'name'), 'utf8'), dir)).trim()
    for (const file of await settle(fs.readdir(base), [])) {
      const m = /^fan(\d+)_input$/.exec(file)
      if (!m) continue
      const rpm = Number((await settle(fs.readFile(path.join(base, file), 'utf8'), '')).trim())
      const label = (await settle(fs.readFile(path.join(base, `fan${m[1]}_label`), 'utf8'), '')).trim()
      if (Number.isFinite(rpm)) fans.push({ name: label || `${chip} ${m[1]}`, rpm })
    }
  }
  return fans
}

async function sensors(): Promise<SysSensors> {
  // GPU temperatures come from nvidia-smi; on macOS graphics() is a slow system_profiler run with none.
  const [temp, fans, battery, graphics] = await Promise.all([
    settle(si.cpuTemperature(), null),
    linuxFans(),
    settle(si.battery(), null),
    process.platform === 'darwin' ? null : settle(si.graphics(), null)
  ])
  return {
    cpu: positive(temp?.main),
    cpuMax: positive(temp?.max),
    cores: (temp?.cores ?? []).filter((c) => positive(c) !== null),
    gpus: (graphics?.controllers ?? []).flatMap((g) => (positive(g.temperatureGpu) ? [{ name: g.model || g.name || g.vendor, temp: g.temperatureGpu! }] : [])),
    fans,
    battery: battery?.hasBattery
      ? {
          percent: battery.percent,
          charging: battery.isCharging,
          plugged: battery.acConnected,
          cycles: battery.cycleCount,
          health: positive(battery.maxCapacity) && positive(battery.designedCapacity) ? Math.min(100, (battery.maxCapacity / battery.designedCapacity) * 100) : null,
          minutesLeft: positive(battery.timeRemaining)
        }
      : null
  }
}

let cachedInfo: Promise<SysInfo> | null = null

async function info(): Promise<SysInfo> {
  const [o, sys, cpu, mem, modules, graphics, disks, volumes] = await Promise.all([
    si.osInfo(),
    settle(si.system(), null),
    si.cpu(),
    si.mem(),
    settle(si.memLayout(), []),
    settle(si.graphics(), null),
    settle(si.diskLayout(), []),
    settle(si.fsSize(), [])
  ])
  return {
    os: { name: o.distro || o.platform, version: [o.release, o.codename].filter(Boolean).join(' '), build: o.build, kernel: o.kernel, arch: o.arch, hostname: o.hostname, platform: o.platform },
    machine: { vendor: sys?.manufacturer ?? '', model: [sys?.model, sys?.version].filter((v) => v && v !== '-').join(' '), virtual: sys?.virtual ?? false },
    cpu: {
      name: label(cpu.manufacturer, cpu.brand),
      cores: cpu.cores,
      physical: cpu.physicalCores,
      performance: positive(cpu.performanceCores),
      efficiency: positive(cpu.efficiencyCores),
      ghz: cpu.speed,
      ghzMax: positive(cpu.speedMax),
      virtualization: cpu.virtualization
    },
    memory: { total: mem.total, modules: modules.filter((m) => m.size > 0).map((m) => ({ size: m.size, type: m.type, mhz: positive(m.clockSpeed) })) },
    gpus: (graphics?.controllers ?? []).map((g) => ({ name: label(g.vendor, g.model) || g.name || '?', vram: positive(g.vram), cores: positive(g.cores) })),
    displays: (graphics?.displays ?? []).map((d) => ({
      name: d.model || d.deviceName || '',
      width: d.currentResX ?? d.resolutionX ?? 0,
      height: d.currentResY ?? d.resolutionY ?? 0,
      hz: positive(d.currentRefreshRate),
      builtin: d.builtin
    })),
    // Mounted .dmg files are listed as disks too.
    disks: disks.filter((d) => !/disk image/i.test(`${d.type} ${d.name}`)).map((d) => ({ name: d.name || d.device, type: d.type, size: d.size, iface: d.interfaceType })),
    volumes: volumes
      .filter((v) => v.size > 0 && !HIDDEN_FS.test(v.type) && !HIDDEN_MOUNT.test(v.mount))
      .slice(0, 24)
      .map((v) => ({ mount: v.mount, fs: v.type, size: v.size, used: v.used })),
    app: { electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '', node: process.versions.node }
  }
}

const HANDLERS = {
  sample,
  processes,
  sensors,
  // Hardware does not change while the worker lives; a failed read is retried next time.
  info: () => (cachedInfo ??= info().catch((err) => ((cachedInfo = null), Promise.reject(err))))
}

parentPort.on('message', async (e: { data: { id: string; type: keyof typeof HANDLERS } }) => {
  const { id, type } = e.data
  try {
    parentPort.postMessage({ id, result: await HANDLERS[type]() })
  } catch (err) {
    parentPort.postMessage({ id, error: (err as Error).message ?? String(err) })
  }
})
