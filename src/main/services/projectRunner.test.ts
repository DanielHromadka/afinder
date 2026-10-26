import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findTarget, runTargets, tomlKeys } from './projectRunner'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-run-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const write = async (name: string, content: string): Promise<void> => {
  await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
  await writeFile(path.join(dir, name), content)
}
const commands = async (target = dir): Promise<string[]> => (await runTargets(target)).map((t) => t.command)

describe('runTargets – Node.js', () => {
  it('lists scripts with the common ones first and hides lifecycle hooks', async () => {
    await write(
      'package.json',
      JSON.stringify({ scripts: { lint: 'eslint .', build: 'vite build', prebuild: 'x', postinstall: 'y', dev: 'vite', 'test:e2e': 'pw' } })
    )
    await mkdir(path.join(dir, 'node_modules'))
    expect(await commands()).toEqual(['npm run dev', 'npm run build', 'npm run lint', 'npm run test:e2e'])
  })

  it('uses the package manager of the lockfile and offers install without node_modules', async () => {
    await write('package.json', JSON.stringify({ scripts: { dev: 'vite' } }))
    await write('pnpm-lock.yaml', '')
    expect(await commands()).toEqual(['pnpm install', 'pnpm run dev'])
  })

  it('runs a bare Vite project with npx', async () => {
    await write('package.json', JSON.stringify({ devDependencies: { vite: '^7' } }))
    await write('vite.config.ts', 'export default {}')
    await mkdir(path.join(dir, 'node_modules'))
    expect(await commands()).toEqual(['npx vite'])
  })

  it('ignores a broken package.json', async () => {
    await write('package.json', '{ nope')
    expect(await commands()).toEqual([])
  })
})

describe('runTargets – Python', () => {
  it('runs entry files and project scripts through uv', async () => {
    await write('uv.lock', '')
    await write('pyproject.toml', '[project]\nname = "x"\n\n[project.scripts]\nserve = "x.cli:main"\n')
    await write('main.py', 'print(1)')
    await write('tool.py', 'if __name__ == "__main__":\n    pass\n')
    await write('lib.py', 'def f(): pass')
    expect(await commands()).toEqual(['uv run main.py', 'uv run tool.py', 'uv run serve'])
  })

  it('runs a clicked file first, from the project root, with the virtualenv', async () => {
    await write('requirements.txt', 'requests')
    await write('.venv/pyvenv.cfg', '')
    await write('scripts/job.py', 'print(1)')
    const targets = await runTargets(path.join(dir, 'scripts', 'job.py'))
    const python = process.platform === 'win32' ? "& '.\\.venv\\Scripts\\python.exe'" : './.venv/bin/python'
    expect(targets[0]).toMatchObject({ file: true, cwd: dir, command: `${python} ${path.join('scripts', 'job.py')}` })
  })

  it('runs Django with runserver', async () => {
    await write('manage.py', '')
    expect(await commands()).toEqual([`${process.platform === 'win32' ? 'python' : 'python3'} manage.py runserver`])
  })

  it('finds nothing in an ordinary folder', async () => {
    await write('notes.txt', '')
    expect(await commands()).toEqual([])
  })
})

describe('runTargets – static HTML', () => {
  const py = process.platform === 'win32' ? 'python' : 'python3'

  it('offers a static server for a folder of pages', async () => {
    await write('index.html', '<h1>hi</h1>')
    expect(await commands()).toEqual([
      expect.stringMatching(new RegExp(`^${py} -m http\\.server \\d+ --bind 127\\.0\\.0\\.1$`)),
      expect.stringMatching(/^npx serve -l tcp:\/\/127\.0\.0\.1:\d+$/)
    ])
  })

  it('opens a clicked page in the browser', async () => {
    await write('my page.html', '')
    const [first] = await runTargets(path.join(dir, 'my page.html'))
    expect(first).toMatchObject({ file: true, kind: 'web', url: expect.stringMatching(/^http:\/\/localhost:\d+\/my%20page\.html$/) })
  })

  it('leaves Node projects to their own scripts', async () => {
    await write('index.html', '')
    await write('package.json', JSON.stringify({ scripts: { dev: 'vite' } }))
    await mkdir(path.join(dir, 'node_modules'))
    expect(await commands()).toEqual(['npm run dev'])
  })
})

describe('findTarget', () => {
  it('rebuilds the command from disk and rejects unknown ids', async () => {
    await write('package.json', JSON.stringify({ scripts: { dev: 'vite' } }))
    await mkdir(path.join(dir, 'node_modules'))
    expect((await findTarget(dir, 'script:dev')).command).toBe('npm run dev')
    await expect(findTarget(dir, 'script:rm -rf')).rejects.toThrow()
  })

  it('quotes odd script names', async () => {
    await write('package.json', JSON.stringify({ scripts: { 'a b;c': 'x' } }))
    await mkdir(path.join(dir, 'node_modules'))
    expect(await commands()).toEqual(["npm run 'a b;c'"])
  })
})

describe('tomlKeys', () => {
  it('reads one table and stops at the next', () => {
    const toml = '[tool.poetry.scripts]\napp = "a:main"\n"my-tool" = "b:main"\n\n[[tool.x]]\nother = 1\n'
    expect(tomlKeys(toml, 'tool.poetry.scripts')).toEqual(['app', 'my-tool'])
    expect(tomlKeys(toml, 'project.scripts')).toEqual([])
  })
})
