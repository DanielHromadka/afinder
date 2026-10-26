// What the Tools area and the Task Manager get from main.


/** Checksums of a file, from the Tools area. */
export interface FileHashes {
  size: number
  md5: string
  sha1: string
  sha256: string
  sha512: string
}

/** Files with the same content (same size and SHA-256). */
export interface DuplicateGroup {
  size: number
  paths: string[]
}

/** One box of the disk map; folders deeper than the scanned levels have no children. */
export interface DiskNode {
  name: string
  path: string
  size: number
  dir: boolean
  /** Files below a folder. */
  files?: number
  children?: DiskNode[]
  /** The box that sums up this many smaller items. */
  other?: number
}

/** One reading for the Task Manager's graphs. Rates are bytes per second, null until a second reading or where
 *  the platform has no counter (disk I/O on Windows). */
export interface SysSample {
  /** Total CPU load and per logical core, 0–100. */
  cpu: number
  cores: number[]
  memUsed: number
  memTotal: number
  swapUsed: number
  swapTotal: number
  netRx: number | null
  netTx: number | null
  diskRead: number | null
  diskWrite: number | null
  /** 1, 5 and 15 minute load averages (zeros on Windows). */
  load: number[]
  /** Seconds since boot. */
  uptime: number
}

export interface SysProcess {
  pid: number
  ppid: number
  name: string
  user: string
  /** Percent of one core, as top shows it. */
  cpu: number
  /** Resident memory in bytes. */
  mem: number
  state: string
  command: string
}

/** Temperatures (°C) and fans: only what the platform exposes without root or native helpers. */
export interface SysSensors {
  cpu: number | null
  cpuMax: number | null
  cores: number[]
  gpus: { name: string; temp: number }[]
  fans: { name: string; rpm: number }[]
  battery: { percent: number; charging: boolean; plugged: boolean; cycles: number; health: number | null; minutesLeft: number | null } | null
}

export interface SysInfo {
  os: { name: string; version: string; build: string; kernel: string; arch: string; hostname: string; platform: string }
  machine: { vendor: string; model: string; virtual: boolean }
  cpu: { name: string; cores: number; physical: number; performance: number | null; efficiency: number | null; ghz: number; ghzMax: number | null; virtualization: boolean }
  memory: { total: number; modules: { size: number; type: string; mhz: number | null }[] }
  gpus: { name: string; vram: number | null; cores: number | null }[]
  displays: { name: string; width: number; height: number; hz: number | null; builtin: boolean }[]
  disks: { name: string; type: string; size: number; iface: string }[]
  volumes: { mount: string; fs: string; size: number; used: number }[]
  app: { electron: string; chrome: string; node: string }
}

/** Progress of a Tools job: bytes, or files counted while scanning. */
export interface ToolsProgress {
  done: number
  total: number
  phase?: 'scan' | 'compare'
  bytes?: number
}

export interface ClipboardEntry {
  text: string
  at: number
}
