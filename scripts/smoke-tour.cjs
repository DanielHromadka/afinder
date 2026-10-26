// Run with Electron after `npm run build`. Starts the built aFinder with fresh app data: the first-start
// offer appears once, the Help menu and F1 start the tour, every step either lights up its element or
// (only where the layout has none) sits in the middle, and Back, Esc and Done behave.
// AFINDER_SMOKE_ARTIFACTS=<dir> saves a screenshot of every step.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-tour-smoke-'))
const folder = path.join(directory, 'files')
fs.mkdirSync(path.join(folder, 'Documents'), { recursive: true })
fs.writeFileSync(path.join(folder, 'notes.txt'), 'hello')
const userData = path.join(directory, 'userData')
fs.mkdirSync(userData)
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ language: process.env.AFINDER_SMOKE_LANG ?? 'en', theme: process.env.AFINDER_SMOKE_THEME ?? 'xp', autoUpdate: false, lastPath: folder }))
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
/** Steps with nothing to point at by design. */
const CENTERED = ['welcome', 'palette', 'summary', 'done']
const settingsFile = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))

app.whenReady().then(async () => {
  try {
    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0]
      return w && !w.webContents.isLoading() && (await w.webContents.executeJavaScript('!!document.querySelector(".toolbar")')) ? w : false
    }, 'Application did not render')
    win.setSize(1400, 900)
    const js = (code) => win.webContents.executeJavaScript(code)
    const shot = async (name) => {
      if (!process.env.AFINDER_SMOKE_ARTIFACTS) return
      await sleep(350)
      fs.mkdirSync(process.env.AFINDER_SMOKE_ARTIFACTS, { recursive: true })
      fs.writeFileSync(path.join(process.env.AFINDER_SMOKE_ARTIFACTS, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    }
    const key = async (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
      await sleep(120)
    }
    const step = () => js(`document.querySelector('.tour-overlay')?.dataset.step ?? null`)

    // First start: the offer is there and blocks nothing; "Not now" puts it away for good.
    await until(() => js('!!document.querySelector(".tour-offer")'), 'First-start offer missing')
    await shot('00-offer')
    await js(`[...document.querySelectorAll('.tour-offer button')].find((b) => b.textContent === 'Not now').click()`)
    await until(() => js('!document.querySelector(".tour-offer")'), 'Offer did not close')
    await until(() => settingsFile().tourOffered === true, 'tourOffered was not saved')

    // From the Help menu.
    await js(`document.querySelector('.toolbar [data-tour="help"]').click()`)
    await until(() => js('!!document.querySelector(".context-menu")'), 'Help menu did not open')
    await js(`[...document.querySelectorAll('.context-menu .menu-item')].find((el) => el.textContent.includes('Guided Tour')).click()`)
    await until(() => step(), 'Tour did not start')
    const steps = []
    for (let i = 0; i < 40; i++) {
      const id = await step()
      if (!id) break
      const lit = await js('!!document.querySelector(".tour-spotlight")')
      // The balloon stays inside the window.
      const box = await js(`(() => { const r = document.querySelector('.tour-balloon').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight] })()`)
      assert.ok(box[0] >= 0 && box[1] >= 0 && box[2] <= box[4] && box[3] <= box[5], `Balloon of ${id} leaves the window: ${box}`)
      assert.equal(lit, !CENTERED.includes(id), `Step ${id} ${lit ? 'lit something' : 'found nothing to light up'}`)
      steps.push(id)
      await shot(`${String(i + 1).padStart(2, '0')}-${id}`)
      // Back once on the second step, then on.
      if (i === 1) {
        await key('Left')
        assert.equal(await step(), steps[0], 'Back did not go back')
        await key('Right')
      }
      await js(`document.querySelector('.tour-next').click()`)
      await sleep(150)
    }
    assert.deepEqual(steps.slice(0, 2), ['welcome', 'navigation'])
    assert.equal(steps.at(-1), 'done')
    assert.equal(await step(), null, 'Done did not close the tour')

    // F1 starts it again, Esc closes it; app shortcuts are off meanwhile.
    await key('F1')
    await until(() => step(), 'F1 did not start the tour')
    await key('Right')
    assert.equal(await step(), 'navigation')
    await key('Escape')
    await until(async () => !(await step()), 'Esc did not close the tour')
    assert.equal(await js('!!document.querySelector(".tour-offer")'), false, 'Offer came back')
    console.log(`PASS: first-start offer → Help menu → ${steps.length} steps → F1 → Esc`)
  } catch (err) {
    console.error(err)
    exitCode = 1
  } finally {
    app.quit()
  }
})
