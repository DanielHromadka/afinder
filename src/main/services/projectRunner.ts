// "Run" commands for project folders: the scripts of a package.json (npm, pnpm, yarn, bun), the
// entry points of a Python project and a static server for plain HTML, run in an integrated console session.
//
// The renderer only ever gets the list and sends back an id; the command line is worked out here
// again from the files on disk, so nothing the renderer sends is typed into the shell.

import { promises as fs } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { RunTarget } from '@shared/types'
import { shellQuote } from './terminals'

const isWindows = process.platform === 'win32'

/** How many parent folders are searched for the project root. */
const MAX_UP = 4
/** Python files at the project root read to find `if __name__ == "__main__"`. */
const MAX_PY_FILES = 40
const MAX_READ = 64 * 1024

/** Shown first, in this order; the rest follow in package.json order. */
const PREFERRED_SCRIPTS = ['dev', 'start', 'serve', 'preview', 'build', 'test']
/** npm runs these by itself around install and publish. */
const LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack'])
const PYTHON_ENTRIES = ['main.py', 'app.py', 'run.py', '__main__.py', 'manage.py']
const PYTHON_MARKERS = ['pyproject.toml', 'uv.lock', 'poetry.lock', 'Pipfile', 'requirements.txt', 'setup.py']
const VENV_DIRS = ['.venv', 'venv', 'env']
/** Static servers start at this port and take the next free one. */
const WEB_PORT = 8000
const WEB_PORT_TRIES = 50

/** Run commands for a folder, or for a file (a Python script runs itself) – empty when nothing is runnable. */
export async function runTargets(target: string): Promise<RunTarget[]> {
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) return []
  const dir = stat.isDirectory() ? target : path.dirname(target)
  const file = stat.isFile() ? target : null
  const [node, python] = await Promise.all([nodeTargets(dir), pythonTargets(dir, file)])
  // Node projects serve their pages with their own dev/preview scripts.
  const web = node.length ? [] : await webTargets(dir, file)
  const all = [...node, ...python, ...web]
  // The clicked file first, then the project's commands.
  return [...all.filter((t) => t.file), ...all.filter((t) => !t.file)]
}

/** The command for one of the folder's targets, looked up again on disk. */
export async function findTarget(target: string, id: string): Promise<RunTarget> {
  const found = (await runTargets(target)).find((t) => t.id === id)
  if (!found) throw new Error('Unknown run command.')
  return found
}

// ---- Node.js ------------------------------------------------------------------------------------

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

async function nodeTargets(dir: string): Promise<RunTarget[]> {
  const root = await findUp(dir, (d) => exists(path.join(d, 'package.json')))
  if (!root) return []
  const pkg = await readJson(path.join(root, 'package.json'))
  if (!pkg) return []
  const pm = await packageManager(root, pkg)
  const scripts = isRecord(pkg.scripts) ? Object.keys(pkg.scripts).filter((k) => typeof (pkg.scripts as Record<string, unknown>)[k] === 'string') : []
  const names = new Set(scripts)
  const visible = scripts.filter((s) => !LIFECYCLE_SCRIPTS.has(s) && !isHook(s, names))
  const ordered = [...PREFERRED_SCRIPTS.filter((s) => names.has(s)), ...visible.filter((s) => !PREFERRED_SCRIPTS.includes(s))]

  const targets: RunTarget[] = ordered.map((name) => ({
    id: `script:${name}`,
    command: `${pm} run ${arg(name)}`,
    cwd: root,
    kind: 'node'
  }))
  // A bare Vite project without a dev script.
  if (!names.has('dev') && (await viteConfig(root))) {
    targets.unshift({ id: 'vite', command: pm === 'npm' ? 'npx vite' : `${pm === 'bun' ? 'bunx' : pm} vite`, cwd: root, kind: 'node' })
  }
  if (!(await exists(path.join(root, 'node_modules')))) {
    targets.unshift({ id: 'install', command: `${pm} install`, cwd: root, kind: 'node' })
  }
  return targets
}

/** `prebuild` / `postbuild` run on their own with `build`. */
const isHook = (name: string, all: Set<string>): boolean => /^(pre|post)./.test(name) && all.has(name.replace(/^(pre|post)/, ''))

async function packageManager(root: string, pkg: Record<string, unknown>): Promise<PackageManager> {
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : ''
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') return declared
  const lockfiles: [string, PackageManager][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun']
  ]
  for (const [lock, pm] of lockfiles) if (await exists(path.join(root, lock))) return pm
  return 'npm'
}

async function viteConfig(root: string): Promise<boolean> {
  for (const ext of ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts']) if (await exists(path.join(root, `vite.config.${ext}`))) return true
  return false
}

// ---- Python -------------------------------------------------------------------------------------

/** How a Python project runs its code: `uv run`, `poetry run`, a virtualenv or the system Python. */
interface PythonRunner {
  /** Runs a .py file (`… file.py`). */
  python: string
  /** Runs a console script declared by the project; null when it cannot be run without installing. */
  script: ((name: string) => string) | null
}

async function pythonTargets(dir: string, file: string | null): Promise<RunTarget[]> {
  const isPy = file !== null && file.endsWith('.py')
  const root = (await findUp(dir, isPythonRoot)) ?? (isPy || (await hasEntry(dir)) ? dir : null)
  if (!root) return []
  const pyproject = await readText(path.join(root, 'pyproject.toml'))
  const runner = await pythonRunner(root, pyproject)
  const rel = (p: string): string => arg(path.relative(root, p) || path.basename(p))
  const targets: RunTarget[] = []

  if (isPy) targets.push({ id: `file:${path.basename(file)}`, command: `${runner.python} ${rel(file)}`, cwd: root, kind: 'python', file: true })

  for (const entry of await entryFiles(root)) {
    const full = path.join(root, entry)
    if (full === file) continue
    const extra = entry === 'manage.py' ? ' runserver' : ''
    targets.push({ id: `entry:${entry}`, command: `${runner.python} ${rel(full)}${extra}`, cwd: root, kind: 'python' })
  }

  if (runner.script && pyproject) {
    const scripts = [...tomlKeys(pyproject, 'project.scripts'), ...tomlKeys(pyproject, 'tool.poetry.scripts')]
    for (const name of new Set(scripts)) targets.push({ id: `pyscript:${name}`, command: runner.script(name), cwd: root, kind: 'python' })
  }
  const pipfile = await readText(path.join(root, 'Pipfile'))
  if (pipfile) {
    for (const name of tomlKeys(pipfile, 'scripts')) targets.push({ id: `pipenv:${name}`, command: `pipenv run ${arg(name)}`, cwd: root, kind: 'python' })
  }
  return targets
}

async function isPythonRoot(dir: string): Promise<boolean> {
  for (const marker of PYTHON_MARKERS) if (await exists(path.join(dir, marker))) return true
  return (await venv(dir)) !== null
}

async function hasEntry(dir: string): Promise<boolean> {
  return (await entryFiles(dir)).length > 0
}

/** The usual entry files, and any top-level script with an `if __name__ == "__main__"` block. */
async function entryFiles(root: string): Promise<string[]> {
  const names = await fs.readdir(root).catch(() => [] as string[])
  const py = names.filter((n) => n.endsWith('.py')).sort()
  const known = PYTHON_ENTRIES.filter((e) => py.includes(e))
  const others: string[] = []
  for (const name of py.filter((n) => !known.includes(n)).slice(0, MAX_PY_FILES)) {
    const text = await readText(path.join(root, name), MAX_READ)
    if (text && /if\s+__name__\s*==\s*['"]__main__['"]/.test(text)) others.push(name)
  }
  return [...known, ...others]
}

async function pythonRunner(root: string, pyproject: string | null): Promise<PythonRunner> {
  if ((await exists(path.join(root, 'uv.lock'))) || /^\[tool\.uv[\].]/m.test(pyproject ?? '')) {
    return { python: 'uv run', script: (name) => `uv run ${arg(name)}` }
  }
  if ((await exists(path.join(root, 'poetry.lock'))) || /^\[tool\.poetry[\].]/m.test(pyproject ?? '')) {
    return { python: 'poetry run python', script: (name) => `poetry run ${arg(name)}` }
  }
  if (await exists(path.join(root, 'Pipfile'))) return { python: 'pipenv run python', script: (name) => `pipenv run ${arg(name)}` }
  const env = await venv(root)
  if (env) {
    const bin = isWindows ? path.join(env, 'Scripts') : path.join(env, 'bin')
    const python = path.join(bin, isWindows ? 'python.exe' : 'python')
    // Relative to the project root, which is the session's folder.
    const local = (p: string): string => {
      const rel = path.relative(root, p)
      return isWindows ? `& ${shellQuote(`.\\${rel}`)}` : arg(`./${rel}`)
    }
    return { python: local(python), script: (name) => local(path.join(bin, name)) }
  }
  return { python: isWindows ? 'python' : 'python3', script: null }
}

/** A virtualenv inside the project (it has a pyvenv.cfg). */
async function venv(root: string): Promise<string | null> {
  for (const name of VENV_DIRS) {
    const dir = path.join(root, name)
    if (await exists(path.join(dir, 'pyvenv.cfg'))) return dir
  }
  return null
}

/**
 * The keys of one table of a TOML file – enough for `[project.scripts]` and Pipfile `[scripts]`,
 * which hold only `name = "…"` lines.
 */
export function tomlKeys(toml: string, table: string): string[] {
  const keys: string[] = []
  let inside = false
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      const header = /^\[([^[\]]+)\]\s*(#.*)?$/.exec(line)
      inside = header !== null && header[1].replace(/[\s"']/g, '') === table
      continue
    }
    if (!inside) continue
    const key = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=/.exec(line)
    if (key) keys.push(key[1] ?? key[2] ?? key[3])
  }
  return keys
}

// ---- static HTML ------------------------------------------------------------------------------

/** A plain folder of HTML pages: Python's or Node's static server, bound to this computer only. */
async function webTargets(dir: string, file: string | null): Promise<RunTarget[]> {
  const isHtml = file !== null && /\.html?$/i.test(file)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  if (!isHtml && !names.some((n) => /\.html?$/i.test(n))) return []
  const port = await freePort()
  if (port === null) return []
  const python = `${isWindows ? 'python' : 'python3'} -m http.server ${port} --bind 127.0.0.1`
  const base = `http://localhost:${port}/`
  const targets: RunTarget[] = [
    { id: 'http:python', command: python, cwd: dir, kind: 'web' },
    { id: 'http:npx', command: `npx serve -l tcp://127.0.0.1:${port}`, cwd: dir, kind: 'web' }
  ]
  if (isHtml) {
    const page = path.basename(file)
    targets.unshift({ id: `http:open:${page}`, command: python, cwd: dir, kind: 'web', file: true, url: base + encodeURIComponent(page) })
  }
  return targets
}

async function freePort(): Promise<number | null> {
  for (let port = WEB_PORT; port < WEB_PORT + WEB_PORT_TRIES; port++) if (await portFree(port)) return port
  return null
}

const portFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })

/** Resolves once something accepts connections on the port; false after the timeout. */
export async function whenListening(port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => (socket.destroy(), resolve(true)))
      socket.once('error', () => resolve(false))
    })
    if (up) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

// ---- helpers ------------------------------------------------------------------------------------

/** The folder or its nearest parent (up to MAX_UP; never the home folder or a disk root) that matches. */
async function findUp(dir: string, test: (dir: string) => Promise<boolean>): Promise<string | null> {
  const home = os.homedir()
  let current = dir
  for (let i = 0; i <= MAX_UP; i++) {
    if (await test(current)) return current
    const parent = path.dirname(current)
    if (parent === home || path.dirname(parent) === parent) return null
    current = parent
  }
  return null
}

/** Plain words go as they are (`npm run dev`), anything else quoted for the shell. */
const arg = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : shellQuote(s))

const exists = (p: string): Promise<boolean> =>
  fs.access(p).then(
    () => true,
    () => false
  )

async function readText(p: string, max = 1024 * 1024): Promise<string | null> {
  const handle = await fs.open(p, 'r').catch(() => null)
  if (!handle) return null
  try {
    const buf = Buffer.alloc(max)
    const { bytesRead } = await handle.read(buf, 0, max, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse((await readText(p)) ?? '')
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
