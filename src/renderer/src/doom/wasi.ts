// A minimal WASI preview1 host for the Doom add-on: one preopened directory kept in memory, stdout/stderr
// as lines, and a monotonic clock the host sets. It implements exactly the calls doom.wasm imports; anything
// else would fail at instantiation, which is the point – the module gets no other way out.

const E = { SUCCESS: 0, ACCES: 2, BADF: 8, EXIST: 20, INVAL: 28, ISDIR: 31, NOENT: 44, NOTDIR: 54, NOTEMPTY: 55 }
const PREOPEN = 3
const RIGHT_WRITE = 1n << 6n
const O_CREAT = 1, O_DIRECTORY = 2, O_EXCL = 4, O_TRUNC = 8
const FD_APPEND = 1

/** proc_exit: thrown through the wasm stack so the caller sees how the program ended. */
export class WasiExit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

interface Open {
  path: string
  dir: boolean
  pos: number
  write: boolean
  append: boolean
}

/** Joins `rel` onto the directory `base` ('' is the preopen); null when it climbs out of it. */
export function resolvePath(base: string, rel: string): string | null {
  const parts = base ? base.split('/') : []
  for (const p of rel.split('/')) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(p)
  }
  return parts.join('/')
}

export class Wasi {
  /** Files by path relative to the preopen; read-only ones cannot be opened for writing. */
  readonly files = new Map<string, Uint8Array>()
  private readonly readonly = new Set<string>()
  private readonly dirs = new Set<string>([''])
  private readonly fds = new Map<number, Open>([[PREOPEN, { path: '', dir: true, pos: 0, write: false, append: false }]])
  private nextFd = PREOPEN + 1
  private memory: WebAssembly.Memory | null = null
  private lines = ['', '', '']
  private time = 0
  private reads = 0

  constructor(private readonly log: (line: string) => void = () => {}) {}

  addFile(path: string, data: Uint8Array, readonly = true): void {
    this.files.set(path, data)
    if (readonly) this.readonly.add(path)
  }

  /**
   * Game time in ms, set by the host before each tick, so a paused game does not race to catch up. Doom
   * busy-waits on its clock (its sleep is a no-op here), so within one tick repeated reads creep forward
   * and such a loop ends instead of freezing the window.
   */
  setTime(ms: number): void {
    this.time = ms
    this.reads = 0
  }
  private now(): number {
    if (++this.reads > 1000) this.time += 0.05
    return this.time
  }

  bind(memory: WebAssembly.Memory): void {
    this.memory = memory
  }

  private get view(): DataView {
    return new DataView(this.memory!.buffer)
  }
  private bytes(ptr: number, len: number): Uint8Array {
    return new Uint8Array(this.memory!.buffer, ptr, len)
  }
  private string(ptr: number, len: number): string {
    return new TextDecoder().decode(this.bytes(ptr, len))
  }
  private iovs(ptr: number, count: number): Array<[number, number]> {
    const v = this.view
    return Array.from({ length: count }, (_, i) => [v.getUint32(ptr + i * 8, true), v.getUint32(ptr + i * 8 + 4, true)])
  }

  private grow(path: string, size: number): Uint8Array {
    const data = this.files.get(path)!
    if (data.length >= size) return data
    // libc buffers writes, so files grow in a few large steps; exact sizes keep length == contents.
    const next = new Uint8Array(size)
    next.set(data)
    this.files.set(path, next)
    return next
  }

  private emit(fd: number, data: Uint8Array): void {
    const text = this.lines[fd] + new TextDecoder().decode(data)
    const parts = text.split('\n')
    this.lines[fd] = parts.pop()!
    for (const line of parts) this.log(line)
  }

  readonly imports: Record<string, (...args: never[]) => number | void> = {
    clock_time_get: (id: number, _precision: bigint, out: number): number => {
      const ns = id === 0 ? BigInt(Date.now()) * 1_000_000n : BigInt(Math.floor(this.now() * 1_000_000))
      this.view.setBigUint64(out, ns, true)
      return E.SUCCESS
    },
    fd_prestat_get: (fd: number, out: number): number => {
      if (fd !== PREOPEN) return E.BADF
      this.view.setUint8(out, 0)
      this.view.setUint32(out + 4, 1, true)
      return E.SUCCESS
    },
    fd_prestat_dir_name: (fd: number, ptr: number, len: number): number => {
      if (fd !== PREOPEN) return E.BADF
      if (len >= 1) this.view.setUint8(ptr, 46) // "."
      return E.SUCCESS
    },
    fd_fdstat_get: (fd: number, out: number): number => {
      const f = this.fds.get(fd)
      if (fd > 2 && !f) return E.BADF
      const v = this.view
      v.setUint8(out, fd <= 2 ? 2 : f!.dir ? 3 : 4) // character device, directory, regular file
      v.setUint16(out + 2, f?.append ? FD_APPEND : 0, true)
      v.setBigUint64(out + 8, 0xffffffffffffffffn, true)
      v.setBigUint64(out + 16, 0xffffffffffffffffn, true)
      return E.SUCCESS
    },
    fd_fdstat_set_flags: (fd: number, flags: number): number => {
      const f = this.fds.get(fd)
      if (!f) return fd <= 2 ? E.SUCCESS : E.BADF
      f.append = (flags & FD_APPEND) !== 0
      return E.SUCCESS
    },
    path_open: (dirFd: number, _dirFlags: number, ptr: number, len: number, oflags: number, rights: bigint, _inherit: bigint, fdflags: number, out: number): number => {
      const base = this.fds.get(dirFd)
      if (!base?.dir) return E.BADF
      const path = resolvePath(base.path, this.string(ptr, len))
      if (path === null) return E.ACCES
      const write = (rights & RIGHT_WRITE) !== 0n || (oflags & O_TRUNC) !== 0
      if (this.dirs.has(path)) {
        if (write) return E.ISDIR
        this.fds.set(this.nextFd, { path, dir: true, pos: 0, write: false, append: false })
      } else {
        if (oflags & O_DIRECTORY) return this.files.has(path) ? E.NOTDIR : E.NOENT
        const exists = this.files.has(path)
        if (exists && oflags & O_EXCL) return E.EXIST
        if (!exists && !(oflags & O_CREAT)) return E.NOENT
        if (write && this.readonly.has(path)) return E.ACCES
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        if (!this.dirs.has(parent)) return E.NOENT
        if (!exists || oflags & O_TRUNC) this.files.set(path, new Uint8Array(0))
        this.fds.set(this.nextFd, { path, dir: false, pos: 0, write, append: (fdflags & FD_APPEND) !== 0 })
      }
      this.view.setUint32(out, this.nextFd++, true)
      return E.SUCCESS
    },
    fd_read: (fd: number, iovs: number, count: number, out: number): number => {
      let read = 0
      const f = this.fds.get(fd)
      if (fd !== 0) {
        if (!f) return E.BADF
        if (f.dir) return E.ISDIR
        const data = this.files.get(f.path)!
        for (const [ptr, len] of this.iovs(iovs, count)) {
          const chunk = data.subarray(f.pos, Math.min(data.length, f.pos + len))
          this.bytes(ptr, chunk.length).set(chunk)
          f.pos += chunk.length
          read += chunk.length
          if (chunk.length < len) break
        }
      }
      this.view.setUint32(out, read, true)
      return E.SUCCESS
    },
    fd_write: (fd: number, iovs: number, count: number, out: number): number => {
      let written = 0
      const f = this.fds.get(fd)
      if (fd !== 1 && fd !== 2 && (!f || f.dir || !f.write)) return E.BADF
      for (const [ptr, len] of this.iovs(iovs, count)) {
        if (fd === 1 || fd === 2) this.emit(fd, this.bytes(ptr, len))
        else {
          if (f!.append) f!.pos = this.files.get(f!.path)!.length
          this.grow(f!.path, f!.pos + len).set(this.bytes(ptr, len), f!.pos)
          f!.pos += len
        }
        written += len
      }
      this.view.setUint32(out, written, true)
      return E.SUCCESS
    },
    fd_seek: (fd: number, offset: bigint, whence: number, out: number): number => {
      const f = this.fds.get(fd)
      if (!f || f.dir) return E.BADF
      const from = whence === 0 ? 0 : whence === 1 ? f.pos : this.files.get(f.path)!.length
      const pos = from + Number(offset)
      if (whence > 2 || pos < 0) return E.INVAL
      f.pos = pos
      this.view.setBigUint64(out, BigInt(pos), true)
      return E.SUCCESS
    },
    fd_close: (fd: number): number => (fd !== PREOPEN && this.fds.delete(fd) ? E.SUCCESS : E.BADF),
    path_create_directory: (dirFd: number, ptr: number, len: number): number => {
      const base = this.fds.get(dirFd)
      const path = base?.dir ? resolvePath(base.path, this.string(ptr, len)) : null
      if (path === null) return E.BADF
      if (this.dirs.has(path) || this.files.has(path)) return E.EXIST
      this.dirs.add(path)
      return E.SUCCESS
    },
    path_remove_directory: (dirFd: number, ptr: number, len: number): number => {
      const base = this.fds.get(dirFd)
      const path = base?.dir ? resolvePath(base.path, this.string(ptr, len)) : null
      if (!path || !this.dirs.has(path)) return E.NOENT
      if ([...this.files.keys(), ...this.dirs].some((p) => p.startsWith(`${path}/`))) return E.NOTEMPTY
      this.dirs.delete(path)
      return E.SUCCESS
    },
    path_unlink_file: (dirFd: number, ptr: number, len: number): number => {
      const base = this.fds.get(dirFd)
      const path = base?.dir ? resolvePath(base.path, this.string(ptr, len)) : null
      if (path === null || !this.files.has(path)) return E.NOENT
      if (this.readonly.has(path)) return E.ACCES
      this.files.delete(path)
      return E.SUCCESS
    },
    path_rename: (fromFd: number, fromPtr: number, fromLen: number, toFd: number, toPtr: number, toLen: number): number => {
      const a = this.fds.get(fromFd), b = this.fds.get(toFd)
      const from = a?.dir ? resolvePath(a.path, this.string(fromPtr, fromLen)) : null
      const to = b?.dir ? resolvePath(b.path, this.string(toPtr, toLen)) : null
      if (from === null || to === null || !this.files.has(from)) return E.NOENT
      if (this.readonly.has(from) || this.readonly.has(to)) return E.ACCES
      this.files.set(to, this.files.get(from)!)
      this.files.delete(from)
      return E.SUCCESS
    },
    proc_exit: (code: number): void => {
      throw new WasiExit(code)
    }
  }
}
