import os from 'node:os'
import { writeFile } from 'node:fs/promises'
import { automationRunnerSource } from './automationRunner'
import { utilityProcess } from 'electron'
import type { ScriptExecutor } from './automationService'

/** Generated code runs outside the main process; no shell interpolation or runtime AI. */
export const executeAutomationScript: ScriptExecutor = async (file, signal, output) => {
  signal.throwIfAborted()
  const runner = `${file}.runner.cjs`
  await writeFile(runner, automationRunnerSource(file), { mode: 0o600 })
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const child = utilityProcess.fork(runner, [], {
      cwd: os.homedir(),
      stdio: 'pipe',
      serviceName: 'aFinder automation',
      // Do not pass the app's tokens or Node runtime configuration into generated code.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: os.homedir(),
        USERPROFILE: os.homedir(),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {})
      }
    })
    let forced: ReturnType<typeof setTimeout> | undefined
    const cancel = (): void => {
      child.kill()
      // A script may install a SIGTERM handler. Ensure cancellation actually terminates it.
      forced = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL')
          } catch {
            /* already exited */
          }
        }
      }, 2000)
    }
    signal.addEventListener('abort', cancel, { once: true })
    child.stdout?.on('data', (data: Buffer) => output(data.toString('utf8')))
    child.stderr?.on('data', (data: Buffer) => output(data.toString('utf8')))
    child.on('error', (type: string) => output(`Process error: ${type}\n`))
    child.once('exit', (code) => {
      signal.removeEventListener('abort', cancel)
      if (forced) clearTimeout(forced)
      if (signal.aborted) reject(signal.reason)
      else if (code === 0) resolve()
      else reject(new Error(`Script exited with code ${code}; see the run log`))
    })
  })
}
