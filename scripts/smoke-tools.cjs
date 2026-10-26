// Run with Electron after `npm run build`. Opens the built aFinder with the Tools area next to the file
// list and disposable app data, then drives the tools: calculator and regex through the UI, checksums,
// duplicates and the disk map through the worker, image conversion in the renderer, the clipboard
// history in main. AFINDER_SMOKE_ARTIFACTS=<dir> also saves screenshots of every tool.
const { app, BrowserWindow, clipboard } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-tools-smoke-'))
const data = path.join(directory, 'data')
fs.mkdirSync(path.join(data, 'a', 'deep'), { recursive: true })
fs.mkdirSync(path.join(data, 'b'))
const big = Buffer.alloc(300 * 1024).map((_, i) => (i * 13) % 256)
fs.writeFileSync(path.join(data, 'a', 'big.bin'), big)
fs.writeFileSync(path.join(data, 'b', 'big copy.bin'), big)
fs.writeFileSync(path.join(data, 'a', 'deep', 'big again.bin'), big)
// Same size, different content after the first 64 KiB: must not count as a duplicate.
const almost = Buffer.from(big)
almost[200 * 1024] ^= 0xff
fs.writeFileSync(path.join(data, 'b', 'almost.bin'), almost)
fs.writeFileSync(path.join(data, 'small.txt'), 'hello')
fs.writeFileSync(path.join(data, 'small copy.txt'), 'hello')
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(data, 'icon.png'))

const userData = path.join(directory, 'userData')
fs.mkdirSync(userData)
const workspace = { id: 'tools', name: 'Tools', paneAxis: 'row', panes: 1, root: { split: 'row', ratio: 0.38, a: { editor: 'files' }, b: { editor: 'tools' } } }
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ language: 'en', theme: process.env.AFINDER_SMOKE_THEME ?? 'xp', autoUpdate: false, tourOffered: true, lastPath: data, workspaces: [workspace], activeWorkspace: 'tools' })
)
app.setPath('userData', userData)

let exitCode = 0
app.once('will-quit', () => {
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(exitCode)
})
require(path.resolve(root, 'out/main/index.js'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await sleep(80)
  }
  throw new Error(message)
}
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex')

app.whenReady().then(async () => {
  try {
    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0]
      return w && !w.webContents.isLoading() && (await w.webContents.executeJavaScript('!!document.querySelector(".tools-panel")')) ? w : false
    }, 'Tools area did not render')
    win.setSize(1400, 900)
    const js = (code) => win.webContents.executeJavaScript(code)
    const shot = async (name) => {
      if (!process.env.AFINDER_SMOKE_ARTIFACTS) return
      await sleep(300)
      fs.mkdirSync(process.env.AFINDER_SMOKE_ARTIFACTS, { recursive: true })
      fs.writeFileSync(path.join(process.env.AFINDER_SMOKE_ARTIFACTS, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    }
    const open = async (label) => {
      await js(`[...document.querySelectorAll('.tools-nav button')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click()`)
      await until(() => js(`(() => { const p = [...document.querySelectorAll('.tool-page')].find((p) => !p.hidden); return !!p && p.textContent.includes(${JSON.stringify(label)}) && !!p.querySelector('.tool') })()`), `${label} did not open`)
    }
    const type = (selector, value) =>
      js(`(() => { const el = [...document.querySelectorAll('.tool-page:not([hidden]) ${selector}')][0]; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

    // Calculator through its input: precedence and the history.
    await open('Calculator')
    await type('.calc-display input', '2+3*4^2')
    await js(`document.querySelector('.tool-page:not([hidden]) .calc-display input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
    await until(() => js(`document.querySelector('.tool-page:not([hidden]) .calc-display input').value === '50'`), 'Calculator did not compute 50')
    assert.match(await js(`document.querySelector('.calc-history').textContent`), /2\+3\*4\^2 =\s*50/)
    await shot('calc')

    // Checksums of a file, in the worker.
    const hashes = await js(`window.api.tools.hash('smoke-hash', ${JSON.stringify(path.join(data, 'a', 'big.bin'))})`)
    assert.deepEqual(hashes, { size: big.length, md5: sha('md5', big), sha1: sha('sha1', big), sha256: sha('sha256', big), sha512: sha('sha512', big) })

    // Duplicates: three copies of big.bin and two of small.txt; the near-copy is not one.
    const groups = await js(`window.api.tools.duplicates('smoke-dupes', ${JSON.stringify(data)})`)
    assert.equal(groups.length, 2)
    assert.deepEqual(groups[0].paths.map((p) => path.relative(data, p)).sort(), [path.join('a', 'big.bin'), path.join('a', 'deep', 'big again.bin'), path.join('b', 'big copy.bin')])
    assert.deepEqual(groups[1].paths.map((p) => path.basename(p)).sort(), ['small copy.txt', 'small.txt'])

    // Disk map: folder sizes add up.
    const tree = await js(`window.api.tools.diskTree('smoke-tree', ${JSON.stringify(data)})`)
    const total = 4 * big.length + 10 + fs.statSync(path.join(data, 'icon.png')).size
    assert.equal(tree.size, total)
    assert.equal(tree.children[0].name, 'a')
    assert.equal(tree.children[0].size, 2 * big.length)
    assert.equal(tree.files, 7)

    // Disk map through the UI.
    await open('Disk Map')
    await type('input.tool-input', data)
    await js(`[...document.querySelectorAll('.tool-page:not([hidden]) button')].find((b) => b.textContent === 'Scan').click()`)
    await until(() => js(`document.querySelectorAll('.tool-page:not([hidden]) .disk-box').length >= 3`), 'Disk map did not draw')
    await shot('disk')

    // Image: decoded and encoded as WebP in the renderer, saved by main under a free name.
    const saved = await js(`(async () => {
      const blob = await (await fetch('afinder-file://file/' + encodeURIComponent(${JSON.stringify(path.join(data, 'icon.png'))}))).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(64, 64)
      canvas.getContext('2d').drawImage(bitmap, 0, 0, 64, 64)
      const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
      return window.api.tools.saveImage(${JSON.stringify(data)}, 'icon.webp', new Uint8Array(await webp.arrayBuffer()))
    })()`)
    assert.equal(saved, path.join(data, 'icon.webp'))
    const webp = fs.readFileSync(saved)
    assert.equal(webp.subarray(0, 4).toString(), 'RIFF')
    assert.equal(webp.subarray(8, 12).toString(), 'WEBP')
    assert.equal(await js(`window.api.tools.saveImage(${JSON.stringify(data)}, 'icon.webp', new Uint8Array([1]))`), path.join(data, 'icon 2.webp'), 'free name')
    await assert.rejects(js(`window.api.tools.saveImage(${JSON.stringify(data)}, '../evil.webp', new Uint8Array([1]))`))
    await assert.rejects(js(`window.api.tools.saveImage(${JSON.stringify(data)}, 'script.sh', new Uint8Array([1]))`))
    // The system decoder for formats Chromium lacks.
    const png = await js(`window.api.tools.decodeImage(${JSON.stringify(path.join(data, 'icon.png'))}).then((b) => [...b.slice(0, 4)])`)
    assert.deepEqual(png, [0x89, 0x50, 0x4e, 0x47])

    // Regex in its worker: matches marked, catastrophic patterns stopped.
    await open('Regular Expressions')
    await until(() => js(`document.querySelectorAll('.tool-page:not([hidden]) .regex-marked mark').length === 2`), 'Regex did not mark two matches')
    await type('.tool-row input.grow', '(a+)+$')
    await type('textarea', 'a'.repeat(40) + '!')
    await until(() => js(`/too long/.test(document.querySelector('.tool-page:not([hidden]) .tool-error')?.textContent ?? '')`), 'Slow regex was not stopped', 5000)
    await shot('regex')

    // Clipboard history: off by default, collects while on (the tool's checkbox), forgets when turned off.
    assert.deepEqual(await js('window.api.tools.clipboard()'), [])
    await open('Clipboard History')
    const toggleClipboard = () => js(`document.querySelector('.tool-page:not([hidden]) .tool-check input').click()`)
    await toggleClipboard()
    await sleep(1300)
    // Unique: the system clipboard outlives the test, and the text there when the history starts does not count.
    const copied = `smoke clip ${Date.now()}`
    clipboard.writeText(copied)
    await until(() => js(`document.querySelector('.tool-page:not([hidden]) .clip-text')?.textContent === ${JSON.stringify(copied)}`), 'Clipboard entry not shown')
    await shot('clipboard')
    await toggleClipboard()
    await until(() => js(`window.api.tools.clipboard().then((c) => c.length === 0)`), 'Clipboard history was not cleared')
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).clipboardHistory, false)

    // Task Manager: live readings from its worker, the process list, hardware and system info.
    await open('Task Manager')
    const chip = (label) => js(`[...document.querySelectorAll('.tool-page:not([hidden]) .sys-tabs button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`)
    await chip('Performance')
    await until(() => js(`document.querySelectorAll('.tool-page:not([hidden]) .sys-graph polyline').length >= 2`), 'Task Manager graphs did not draw', 20000)
    await shot('task-manager-performance')
    await chip('Processes')
    await until(() => js(`document.querySelectorAll('.tool-page:not([hidden]) .sys-procs .row').length > 5`), 'Process list is empty', 20000)
    await type('.tool-row input.grow', String(win.webContents.getOSProcessId()))
    await until(() => js(`document.querySelectorAll('.tool-page:not([hidden]) .sys-procs .row').length === 1`), 'Filtering by PID did not find the renderer')
    await shot('task-manager-processes')
    assert.match(await js('window.api.sys.kill(1, true).then(() => "killed", (e) => e.message)'), /Invalid id/)
    await chip('Hardware & System')
    await until(() => js(`/Operating system/.test(document.querySelector('.tool-page:not([hidden]) .tool').textContent)`), 'System info did not load', 30000)
    await until(() => js(`/Temperatures & Fans/.test(document.querySelector('.tool-page:not([hidden]) .tool').textContent) && !/Working/.test(document.querySelector('.tool-page:not([hidden]) .tool').textContent)`), 'Sensors did not load', 30000)
    await shot('task-manager-hardware')

    // Every tool opens without an error.
    for (const label of ['Unit & Currency Converter', 'Checksums', 'Image Converter', 'Duplicate Finder', 'JSON & YAML', 'Encoding', 'UUIDs & Passwords', 'Time & Dates', 'Colours', 'Stopwatch & Timer', 'World Clock', 'Scratchpad']) {
      await open(label)
      await shot(label.replace(/\W+/g, '-').toLowerCase())
    }
    assert.match(await js(`document.querySelector('.tool-page:not([hidden]) textarea').placeholder`), /jot down/)
    console.log('PASS: calculator → checksums → duplicates → disk map → image → regex → clipboard → task manager → every tool opens')
  } catch (err) {
    console.error(err)
    exitCode = 1
  } finally {
    app.quit()
  }
})
