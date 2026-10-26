// Builds native/afinder-input (the remote desktop input helper, Rust + enigo) for every architecture this
// platform packages: macOS arm64 + x64, Linux x64 + arm64 (cross-linked with aarch64-linux-gnu-gcc, as CI
// installs it), Windows x64 + arm64. Each lands in native/afinder-input/dist/<platform>-<arch>/, where
// scripts/after-pack.cjs picks the one for the app being packaged. `--host` builds only this machine's.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const crate = path.resolve(__dirname, '../native/afinder-input')
const TARGETS = {
  darwin: { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' },
  linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }
}
const exe = process.platform === 'win32' ? 'afinder-input.exe' : 'afinder-input'

/** rustup installs cargo outside PATH on some setups (Homebrew rustup); ask it where. */
function tool(name) {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' })
    return name
  } catch {
    return execFileSync('rustup', ['which', name], { encoding: 'utf8' }).trim()
  }
}

const all = TARGETS[process.platform]
if (!all) throw new Error(`No input helper targets for ${process.platform}`)
const archs = process.argv.includes('--host') ? [process.arch] : Object.keys(all)
const cargo = tool('cargo')
for (const arch of archs) {
  const target = all[arch]
  if (!target) throw new Error(`No input helper target for ${process.platform}-${arch}`)
  if (!process.argv.includes('--host')) execFileSync('rustup', ['target', 'add', target], { stdio: 'inherit' })
  const env = { ...process.env, PATH: `${path.dirname(cargo)}${path.delimiter}${process.env.PATH}` }
  if (process.platform === 'linux' && arch === 'arm64' && process.arch !== 'arm64') env.CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER ??= 'aarch64-linux-gnu-gcc'
  execFileSync(cargo, ['build', '--release', '--locked', '--target', target, '--manifest-path', path.join(crate, 'Cargo.toml')], { stdio: 'inherit', env })
  const out = path.join(crate, 'dist', `${process.platform}-${arch}`)
  fs.mkdirSync(out, { recursive: true })
  fs.copyFileSync(path.join(crate, 'target', target, 'release', exe), path.join(out, exe))
  console.log(`afinder-input → ${path.relative(process.cwd(), path.join(out, exe))}`)
}
