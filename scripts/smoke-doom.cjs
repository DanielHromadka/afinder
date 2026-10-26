// Run with Electron after `npm run build` and `doom/build.sh`. Serves doom/out/ from a local server
// (AFINDER_DOOM_URL), opens the Games area on the Doom tab with disposable app data, and checks: a file that
// fails its checksum is refused, the real download succeeds, the engine runs in its frame and draws, keys
// reach it, a hidden panel pauses it, and Delete returns to the offer. AFINDER_SMOKE_ARTIFACTS=<dir> saves
// screenshots.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const files = path.join(root, 'doom', 'out')
if (!fs.existsSync(path.join(files, 'doom.wasm'))) {
  console.error('doom/out/doom.wasm is missing – run doom/build.sh first')
  process.exit(1)
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-doom-smoke-'))
const userData = path.join(directory, 'userData')
fs.mkdirSync(userData)
const workspace = { id: 'games', name: 'Games', paneAxis: 'row', panes: 1, root: { split: 'row', ratio: 0.3, a: { editor: 'files' }, b: { editor: 'games' } } }
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ language: 'en', theme: process.env.AFINDER_SMOKE_THEME ?? 'xp', autoUpdate: false, tourOffered: true, lastPath: directory, workspaces: [workspace], activeWorkspace: 'games' })
)
app.setPath('userData', userData)

// The first request for doom.wasm gets corrupted bytes, everything after that the real files.
let corrupt = true
const requests = []
const server = http.createServer((req, res) => {
  const name = path.basename(req.url)
  requests.push(name)
  const file = path.join(files, name)
  if (!fs.existsSync(file)) return res.writeHead(404).end()
  let body = fs.readFileSync(file)
  if (name === 'doom.wasm' && corrupt) {
    corrupt = false
    body = Buffer.from(body)
    body[100] ^= 0xff
  }
  res.writeHead(200, { 'Content-Length': body.length }).end(body)
})

let exitCode = 0
app.once('will-quit', () => {
  server.close()
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(exitCode)
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await sleep(100)
  }
  throw new Error(message)
}

server.listen(0, '127.0.0.1', () => {
  process.env.AFINDER_DOOM_URL = `http://127.0.0.1:${server.address().port}`
  require(path.resolve(root, 'out/main/index.js'))
  app.whenReady().then(run)
})

async function run() {
  try {
    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0]
      return w && !w.webContents.isLoading() && (await w.webContents.executeJavaScript('!!document.querySelector(".games-panel")')) ? w : false
    }, 'Games area did not render')
    win.setSize(1300, 850)
    const js = (code) => win.webContents.executeJavaScript(code)
    const shot = async (name) => {
      if (!process.env.AFINDER_SMOKE_ARTIFACTS) return
      await sleep(300)
      fs.mkdirSync(process.env.AFINDER_SMOKE_ARTIFACTS, { recursive: true })
      fs.writeFileSync(path.join(process.env.AFINDER_SMOKE_ARTIFACTS, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    }
    const click = (selector, text) =>
      js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)

    // Nothing is downloaded until asked.
    assert.ok(await click('.games-tabs button', 'Doom'), 'no Doom tab')
    await until(() => js(`!!document.querySelector('.doom-intro')`), 'download offer missing')
    assert.deepEqual(requests, [], 'something was fetched before the click')
    assert.match(await js(`document.querySelector('.doom-intro').textContent`), /GPLv2.*BSD/)
    await shot('doom-offer')

    // A corrupted engine is refused and nothing stays on disk.
    await click('.doom-intro button', 'Download Doom')
    await until(() => js(`!!document.querySelector('.doom-intro .tool-error')`), 'checksum failure not shown')
    assert.match(await js(`document.querySelector('.doom-intro .tool-error').textContent`), /checksum/)
    assert.ok(!fs.existsSync(path.join(userData, 'Games', 'doom', 'doom.wasm')), 'corrupted file kept')

    // The real download, then the game in its frame.
    await click('.doom-intro button', 'Download Doom')
    await until(() => js(`!!document.querySelector('.doom-frame')`), 'Doom frame did not appear', 60000)
    await until(() => js(`!document.querySelector('.doom-stage .game-overlay')`), 'Doom did not start')
    const frame = await until(() => win.webContents.mainFrame.frames.find((f) => f.url.endsWith('doom.html')), 'no doom.html frame')
    const fjs = (code) => frame.executeJavaScript(code)
    // Focus the frame the way a click does, then let it run.
    await js(`document.querySelector('.doom-frame').focus()`)
    await fjs('window.focus()')
    const lit = () => fjs(`(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n })()`)
    await until(async () => (await lit()) > 5000, 'Doom drew nothing')
    await shot('doom-title')

    // Menu → New game → episode → skill, then walk: the picture changes.
    const key = async (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      await sleep(80)
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
      await sleep(400)
    }
    for (const k of ['Escape', 'Return', 'Return', 'Return']) await key(k)
    await sleep(1500)
    const hash = () => fjs(`(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h })()`)
    const before = await hash()
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
    await sleep(800)
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
    assert.notEqual(await hash(), before, 'keys did not reach Doom')
    await shot('doom-playing')

    // Losing focus pauses behind the veil; the picture holds still.
    await js(`document.querySelector('.games-tabs button').focus()`)
    await until(() => fjs(`!document.getElementById('veil').hidden`), 'no pause veil after blur')
    const paused = await hash()
    await sleep(500)
    assert.equal(await hash(), paused, 'Doom kept running without focus')
    await shot('doom-paused')

    // Delete: back to the offer, files gone.
    await click('.doom-footer button', 'Delete')
    await until(() => js(`!!document.querySelector('.doom-intro')`), 'Delete did not return to the offer')
    assert.ok(!fs.existsSync(path.join(userData, 'Games', 'doom')), 'files left after Delete')
    console.log('Doom smoke test passed')
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    app.quit()
  }
}
