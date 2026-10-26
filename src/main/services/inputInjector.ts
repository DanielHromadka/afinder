// Replays a remote viewer's mouse and keyboard on this computer (companion.ts, sessions with control).
// The work is done by native/afinder-input (Rust + enigo), started for the session and stopped after it:
// one JSON command per line on its stdin. Events are validated and mapped here (shared/companion/input.ts),
// so the helper only ever sees well-formed commands. Loaded lazily with the first control session.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { app, screen } from 'electron'
import { helperCommand, KeyMapper, parseInput, screenPoint, type DisplayGeometry, type HelperCommand } from '@shared/companion/input'

const START_MS = 5000
const EXE = process.platform === 'win32' ? 'afinder-input.exe' : 'afinder-input'

/** Packaged: resources/bin (copied by scripts/after-pack.cjs); dev: what npm run build:input made. */
export function helperPath(): string {
  if (process.env.AFINDER_INPUT_HELPER) return process.env.AFINDER_INPUT_HELPER
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', EXE)
  return path.join(app.getAppPath(), 'native/afinder-input/dist', `${process.platform}-${process.arch}`, EXE)
}

function geometry(display: string): DisplayGeometry | null {
  const d = screen.getAllDisplays().find((x) => String(x.id) === display)
  return d ? { bounds: d.bounds, scaleFactor: d.scaleFactor } : null
}

export class InputInjector {
  private keys = new KeyMapper()
  private geometry: DisplayGeometry | null
  private stopped = false
  private readonly refresh = (): void => void (this.geometry = geometry(this.display) ?? this.geometry)
  /** The helper ended on its own (crashed, killed): the session cannot be controlled any more. */
  onExit: (() => void) | null = null

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly display: string
  ) {
    this.geometry = geometry(display)
    // Resolution, arrangement or scaling may change during a session.
    screen.on('display-metrics-changed', this.refresh)
    screen.on('display-added', this.refresh)
    screen.on('display-removed', this.refresh)
    child.on('exit', () => !this.stopped && this.onExit?.())
    child.stdin.on('error', () => {})
  }

  /** Starts the helper; rejects with "permission" when macOS has not allowed aFinder to control the computer. */
  static start(display: string): Promise<InputInjector> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(helperPath(), [], { stdio: 'pipe', windowsHide: true })
      } catch (err) {
        return reject(err)
      }
      let out = ''
      const fail = (err: Error): void => {
        clearTimeout(timer)
        child.kill()
        reject(err)
      }
      const timer = setTimeout(() => fail(new Error('timeout')), START_MS)
      child.on('error', fail)
      child.stderr.on('data', (d) => console.warn('[afinder-input]', String(d).trim()))
      child.stdout.on('data', function first(d) {
        out += String(d)
        const nl = out.indexOf('\n')
        if (nl < 0) return
        child.stdout.off('data', first)
        child.off('error', fail)
        clearTimeout(timer)
        let answer: { ok?: boolean; error?: string } = {}
        try {
          answer = JSON.parse(out.slice(0, nl)) as typeof answer
        } catch {
          // reported below
        }
        if (answer.ok) resolve(new InputInjector(child, display))
        else fail(new Error(answer.error || 'failed'))
      })
    })
  }

  /** One raw message from the viewer's input channel. */
  input(raw: string): void {
    const e = parseInput(raw)
    const g = this.geometry
    if (!e || !g || this.stopped) return
    const cmd = helperCommand(e, this.keys, (x, y) => screenPoint(g, x, y, process.platform, (p) => screen.dipToScreenPoint(p)))
    if (cmd) this.send(cmd)
  }

  private send(cmd: HelperCommand): void {
    if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(cmd)}\n`)
  }

  /** Lets go of everything and ends the helper (it also releases all on its own when stdin closes). */
  stop(): void {
    if (this.stopped) return
    this.send({ t: 'release' })
    this.stopped = true
    screen.off('display-metrics-changed', this.refresh)
    screen.off('display-added', this.refresh)
    screen.off('display-removed', this.refresh)
    this.child.stdin.end()
    setTimeout(() => this.child.exitCode === null && this.child.kill(), 1000).unref()
  }
}
