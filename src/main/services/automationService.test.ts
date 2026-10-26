import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { automationRunnerSource } from './automationRunner'
import { AutomationService, type ScriptExecutor } from './automationService'
import { syncAutomation } from '@shared/automationSync'
import { nextAutomationRun, validateAutomationDraft, type AutomationDraft } from '@shared/automation'

const roots: string[] = []
const services: AutomationService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()))
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})
async function root(): Promise<string> { const r = await mkdtemp(path.join(os.tmpdir(), 'afinder-automation-test-')); roots.push(r); return r }
const nodeExecutor: ScriptExecutor = async (file, signal, output) => {
  const runner = `${file}.runner.cjs`
  await writeFile(runner, automationRunnerSource(file))
  return new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return }
  const child = spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] })
  const cancel = (): void => { child.kill('SIGKILL') }
  signal.addEventListener('abort', cancel, { once: true })
  child.stdout.on('data', (b) => output(b.toString()))
  child.stderr.on('data', (b) => output(b.toString()))
  child.once('error', reject)
  child.once('close', (code) => { signal.removeEventListener('abort', cancel); if (signal.aborted) reject(signal.reason); else if (code === 0) resolve(); else reject(new Error(`exit ${code}`)) })
  })
}
function service(dir: string, execute = nodeExecutor): AutomationService { const s = new AutomationService(dir, execute); services.push(s); return s }
async function finished(s: AutomationService, id: string): Promise<void> {
  await expect.poll(() => s.list().find((i) => i.id === id)?.runs[0]?.finishedAt, { timeout: 5000 }).toBeTruthy()
}
const basic: AutomationDraft = { name: 'Test', description: 'test workflow', trigger: { kind: 'interval', minutes: 1 }, workflow: ['Run', 'Verify'], outcome: 'Checked', script: "module.exports = async () => console.log('workflow executed')", verificationScript: "module.exports = async () => console.log('verified')", timeoutSeconds: 10 }

describe('deterministic automations', () => {
  it('copies nested files, replaces changed contents, preserves extras and verifies SHA-256; a second run copies nothing', async () => {
    const dir = await root(), source = path.join(dir, 'source'), destination = path.join(dir, 'destination')
    await mkdir(path.join(source, 'nested'), { recursive: true }); await mkdir(destination)
    await writeFile(path.join(source, 'nested', 'data.txt'), 'hello\0world')
    await writeFile(path.join(source, 'replace.txt'), 'new content')
    await writeFile(path.join(destination, 'replace.txt'), 'old content')
    await writeFile(path.join(destination, 'extra.txt'), 'preserve me')
    const s = service(path.join(dir, 'store')), id = s.save(null, syncAutomation(source, destination, 1))
    expect(s.list()[0].enabled).toBe(false)
    s.run(id); await finished(s, id)
    expect(s.list()[0].runs[0].status).toBe('success')
    expect(s.list()[0].runs[0].log).toContain('SHA-256 verified files: 2')
    expect(await readFile(path.join(destination, 'nested', 'data.txt'), 'utf8')).toBe('hello\0world')
    expect(await readFile(path.join(destination, 'replace.txt'), 'utf8')).toBe('new content')
    expect(await readFile(path.join(destination, 'extra.txt'), 'utf8')).toBe('preserve me')
    s.run(id); await finished(s, id)
    expect(s.list()[0].runs[0].log).toContain('Copied files: 0')
    const recovered = service(path.join(dir, 'store'))
    expect(recovered.list()[0].runs).toHaveLength(2)
    expect(recovered.list()[0].runs[0].status).toBe('success')
  })
  it('fails verification when the destination is corrupted after the workflow', async () => {
    const dir = await root(), source = path.join(dir, 'source'), destination = path.join(dir, 'destination')
    await mkdir(source); await mkdir(destination); await writeFile(path.join(source, 'a.txt'), 'correct')
    const execute: ScriptExecutor = async (file, signal, output) => {
      await nodeExecutor(file, signal, output)
      if (path.basename(file) === 'workflow.cjs') await writeFile(path.join(destination, 'a.txt'), 'corrupt')
    }
    const s = service(path.join(dir, 'store'), execute), id = s.save(null, syncAutomation(source, destination, 60))
    s.run(id); await finished(s, id)
    expect(s.list()[0].runs[0].status).toBe('failed')
    expect(s.list()[0].runs[0].log).toContain('Verification failed: a.txt')
  })
  it('does not create a missing destination disk path', async () => {
    const dir = await root(), source = path.join(dir, 'source'), destination = path.join(dir, 'missing-disk')
    await mkdir(source); await writeFile(path.join(source, 'a.txt'), 'data')
    const s = service(path.join(dir, 'store')), id = s.save(null, syncAutomation(source, destination, 60))
    s.run(id); await finished(s, id)
    expect(s.list()[0].runs[0].status).toBe('failed')
    await expect(readFile(path.join(destination, 'a.txt'))).rejects.toThrow()
  })
  it('rejects overlapping folders and destination symlinks', async () => {
    const dir = await root(), source = path.join(dir, 'source'), destination = path.join(dir, 'destination'), outside = path.join(dir, 'outside')
    await mkdir(source); await mkdir(path.join(source, 'inner')); await mkdir(destination); await mkdir(outside)
    await writeFile(path.join(source, 'data'), 'source'); await writeFile(path.join(outside, 'data'), 'outside')
    const s = service(path.join(dir, 'store'))
    const overlap = s.save(null, syncAutomation(source, path.join(source, 'inner'), 60))
    s.run(overlap); await finished(s, overlap)
    expect(s.list().find((i) => i.id === overlap)!.runs[0].log).toContain('must not overlap')
    await symlink(path.join(outside, 'data'), path.join(destination, 'data'))
    const link = s.save(null, syncAutomation(source, destination, 60))
    s.run(link); await finished(s, link)
    expect(s.list().find((i) => i.id === link)!.runs[0].status).toBe('failed')
    expect(await readFile(path.join(outside, 'data'), 'utf8')).toBe('outside')
  })
  it('never verifies a failed workflow, bounds logs and records failure', async () => {
    const s = service(await root()), id = s.save(null, { ...basic, script: "module.exports = async () => { console.log('x'.repeat(40000)); throw new Error('workflow failed') }", verificationScript: "module.exports = async () => { throw new Error('VERIFIER SHOULD NOT RUN') }" })
    s.run(id); await finished(s, id)
    const run = s.list()[0].runs[0]
    expect(run.status).toBe('failed'); expect(run.log.length).toBeLessThanOrEqual(24000)
    expect(run.log).not.toContain('VERIFIER SHOULD NOT RUN')
  })
  it('guards concurrent runs, blocks edits and cancels the running process', async () => {
    const s = service(await root()), id = s.save(null, { ...basic, script: 'module.exports = async () => new Promise(() => { setInterval(() => {}, 1000) })' })
    s.run(id)
    expect(() => s.run(id)).toThrow('already running')
    expect(() => s.remove(id)).toThrow('Stop')
    expect(() => s.save(id, basic)).toThrow('Stop')
    s.cancel(id); await finished(s, id)
    expect(s.list()[0].runs[0].status).toBe('cancelled')
    expect(s.list()[0].runs[0].log).not.toContain('VERIFICATION')
  })
  it('terminates a hung workflow at the configured timeout without starting verification', async () => {
    const s = service(await root()), id = s.save(null, { ...basic, script: 'module.exports = async () => new Promise(() => { setInterval(() => {}, 1000) })' })
    s.run(id)
    // The run's own limit is 10 s; starting the child process takes a while more when the suite runs in parallel.
    await expect.poll(() => s.list()[0].runs[0].finishedAt, { timeout: 20000 }).toBeTruthy()
    const run = s.list()[0].runs[0]
    expect(run.status).toBe('failed')
    expect(run.error).toContain('exceeded 10 seconds')
    expect(run.log).not.toContain('VERIFICATION')
  }, 25000)
  it('does not report success when an edited script has no exported async entrypoint', async () => {
    const s = service(await root()), id = s.save(null, { ...basic, script: "console.log('no real entrypoint')" })
    s.run(id); await finished(s, id)
    expect(s.list()[0].runs[0].status).toBe('failed')
    expect(s.list()[0].runs[0].log).toContain('Script must export an async function')
  })
  it('schedules only enabled tasks, does not duplicate a due run, and pauses after edits', async () => {
    const s = service(await root()), id = s.save(null, basic)
    s.tick(Date.now() + 120000)
    expect(s.list()[0].runs).toHaveLength(0)
    s.enable(id, true)
    const due = s.list()[0].nextRunAt!
    s.tick(due); s.tick(due)
    expect(s.list()[0].runs).toHaveLength(1)
    await finished(s, id)
    s.save(id, basic)
    expect(s.list()[0].enabled).toBe(false); expect(s.list()[0].nextRunAt).toBeNull()
    expect(s.list()[0].runs).toHaveLength(1)
  })
  it('runs enabled startup workflows once per service start and restores interrupted runs', async () => {
    const dir = await root()
    const s = service(dir), id = s.save(null, { ...basic, trigger: { kind: 'startup' } })
    s.enable(id, true); await s.dispose()
    const restarted = service(dir)
    restarted.start(); restarted.start(); await finished(restarted, id)
    expect(restarted.list()[0].runs).toHaveLength(1)
    expect(restarted.list()[0].runs[0].reason).toBe('startup')
    const data = restarted.list(); data[0].runs[0].status = 'verifying'; data[0].runs[0].finishedAt = null
    await writeFile(path.join(dir, 'automations.json'), JSON.stringify(data))
    expect(service(dir).list()[0].runs[0].status).toBe('interrupted')
  })
  it('refuses malformed drafts and syntax errors without saving or executing code', async () => {
    const s = service(await root())
    expect(() => s.save(null, { ...basic, trigger: { kind: 'interval', minutes: 0 } })).toThrow()
    expect(() => s.save(null, { ...basic, script: 'not valid javascript(' })).toThrow()
    expect(() => validateAutomationDraft({ ...basic, verificationScript: '' })).toThrow()
    expect(s.list()).toHaveLength(0)
  })
  it('keeps corrupt storage intact and exposes a readable error', async () => {
    const dir = await root(); await writeFile(path.join(dir, 'automations.json'), 'broken JSON')
    const s = service(dir)
    expect(() => s.list()).toThrow('Cannot load automations')
    expect(() => s.save(null, basic)).toThrow('Cannot load automations')
    expect(await readFile(path.join(dir, 'automations.json'), 'utf8')).toBe('broken JSON')
  })
  it('uses local daily times and rolls an elapsed time to the following day', () => {
    const now = new Date(2026, 9, 8, 14, 30).getTime()
    expect(nextAutomationRun({ kind: 'daily', time: '15:00' }, now)).toBe(new Date(2026, 9, 8, 15, 0).getTime())
    expect(nextAutomationRun({ kind: 'daily', time: '14:30' }, now)).toBe(new Date(2026, 9, 9, 14, 30).getTime())
    expect(nextAutomationRun({ kind: 'startup' }, now)).toBeNull()
  })
})
