// electron-builder afterPack hook: drops onnxruntime-node binaries the packaged platform cannot load (the
// npm package ships every OS/arch, ~250 MB; only the one matching this build stays), and adds the remote
// desktop input helper built by scripts/build-input.cjs (before signing, so it is signed with the app).
const fs = require('node:fs')
const path = require('node:path')
const { Arch } = require('electron-builder')

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName
  const arch = Arch[context.arch]
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  addInputHelper(platform, arch, resources)
  const bin = path.join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
  if (!fs.existsSync(bin)) return
  for (const os of fs.readdirSync(bin)) {
    for (const cpu of fs.readdirSync(path.join(bin, os))) {
      if (os !== platform || cpu !== arch) fs.rmSync(path.join(bin, os, cpu), { recursive: true, force: true })
    }
    if (!fs.readdirSync(path.join(bin, os)).length) fs.rmSync(path.join(bin, os), { recursive: true })
  }
  // macOS: the binding links @rpath/libonnxruntime.1.dylib; the versioned file is an identical 40 MB copy.
  const kept = path.join(bin, platform, arch)
  if (fs.existsSync(kept)) {
    for (const file of fs.readdirSync(kept)) if (/^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(file)) fs.rmSync(path.join(kept, file))
  }
}

/** Mac App Store builds cannot control the computer (sandbox), so they ship without it. */
function addInputHelper(platform, arch, resources) {
  if (platform === 'mas') return
  const exe = platform === 'win32' ? 'afinder-input.exe' : 'afinder-input'
  const from = path.resolve(__dirname, '../native/afinder-input/dist', `${platform}-${arch}`, exe)
  if (!fs.existsSync(from)) throw new Error(`Missing ${path.relative(process.cwd(), from)}: run npm run build:input first`)
  fs.mkdirSync(path.join(resources, 'bin'), { recursive: true })
  fs.copyFileSync(from, path.join(resources, 'bin', exe))
  fs.chmodSync(path.join(resources, 'bin', exe), 0o755)
}
