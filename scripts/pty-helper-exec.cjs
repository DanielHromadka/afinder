// node-pty's prebuilt spawn-helper (macOS) comes out of the npm tarball without its execute bit. node-pty
// falls back to the prebuild whenever build/Release does not load – e.g. after `npm run dist` left it built
// for the other architecture – and every terminal then fails with "posix_spawnp failed". Restores the bit.
// Run after install with no arguments, and from after-pack with the packaged node_modules folder.
const fs = require('node:fs')
const path = require('node:path')

function fixPtyHelpers(nodeModules = path.resolve(__dirname, '..', 'node_modules')) {
  const pty = path.join(nodeModules, 'node-pty')
  const dirs = ['build/Release', 'build/Debug']
  const prebuilds = path.join(pty, 'prebuilds')
  if (fs.existsSync(prebuilds)) for (const d of fs.readdirSync(prebuilds)) dirs.push(path.join('prebuilds', d))
  for (const d of dirs) {
    const helper = path.join(pty, d, 'spawn-helper')
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
  }
}

module.exports = { fixPtyHelpers }
if (require.main === module) fixPtyHelpers()
