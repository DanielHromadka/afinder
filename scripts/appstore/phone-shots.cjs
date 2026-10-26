// App Store screenshots of aFinder Remote: starts aFinder on the website's demo home (/Users/alex, a made-up
// computer name) with the phone companion on, pairs the booted iOS simulator through an afinder://pair link,
// opens a few screens by deep link and saves simctl screenshots. Needs `npm run build`, playwright (see
// website/README.md) and aFinder Remote installed in the booted simulator.
//
//   node scripts/appstore/phone-shots.cjs <simulator-udid> <output-dir>
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { _electron: electron } = require('playwright')
const { seed, HOME, WORK } = require('../../website/scripts/screenshots.cjs')

const ROOT = path.resolve(__dirname, '../..')
const [SIM, OUT] = process.argv.slice(2)
const PROFILE = path.join(WORK, 'phone-profile')
/** The demo's external disks, in place of this Mac's /Volumes. */
const VOLUMES = path.join(WORK, 'Volumes')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' })
// idb (brew facebook/fb/idb-companion + pip fb-idb) taps the simulator, which has no window to click in.
const IDB = process.env.IDB || 'idb'
const idb = (...args) => execFileSync(IDB, [...args, '--udid', SIM], { encoding: 'utf8' })

/** iOS asks "Open in aFinder?" for a link from outside; the Open button is tapped when it shows up. */
async function openUrl(url) {
  simctl('openurl', SIM, url)
  await sleep(1500)
  const open = JSON.parse(idb('ui', 'describe-all', '--json')).find((e) => e.AXLabel === 'Open' && /Button/.test(e.type ?? e.role ?? ''))
  if (open) idb('ui', 'tap', String(Math.round(open.frame.x + open.frame.width / 2)), String(Math.round(open.frame.y + open.frame.height / 2)))
}

async function until(check, what, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const v = await check().catch(() => null)
    if (v) return v
    await sleep(300)
  }
  throw new Error(`Timed out: ${what}`)
}

async function main() {
  seed()
  // Start the app afresh, without a half-finished pairing on screen.
  try { simctl('terminate', SIM, 'com.attosoft.afinder') } catch {}
  simctl('launch', SIM, 'com.attosoft.afinder')
  // Real pictures for the thumbnails (the demo files are sparse placeholders).
  const shots = path.join(HOME, 'Pictures/Screenshots')
  fs.mkdirSync(shots, { recursive: true })
  for (const f of ['hero', 'split', 'preview', 'theme-xp', 'theme-dos', 'graph']) fs.copyFileSync(path.join(ROOT, `website/img/${f}.webp`), path.join(shots, `aFinder ${f}.webp`))
  fs.mkdirSync(path.join(VOLUMES, 'Backup'), { recursive: true })
  fs.mkdirSync(PROFILE, { recursive: true })
  fs.writeFileSync(path.join(PROFILE, 'settings.json'), JSON.stringify({ language: 'en', theme: 'apple', autoUpdate: false, tourOffered: true, companionEnabled: true }))
  fs.mkdirSync(OUT, { recursive: true })

  const app = await electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules/electron')),
    args: [ROOT, `--user-data-dir=${PROFILE}`],
    env: { ...process.env, HOME, AFINDER_COMPUTER_NAME: 'Studio Mac', AFINDER_VOLUMES: VOLUMES, ELECTRON_ENABLE_LOGGING: '0' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.statusbar')
    const status = () => page.evaluate(() => window.api.companion.status())
    await until(async () => (await status()).state === 'online', 'aFinder online at the relay')
    const { uri } = (await page.evaluate(() => window.api.companion.pair())).pairing
    await openUrl(uri)
    await until(async () => (await status()).request, 'pair request from the simulator')
    await page.evaluate(() => window.api.companion.answer(true))
    const room = new URL(uri.replace('afinder://', 'https://x/')).searchParams.get('room')
    await sleep(6000)

    const shot = async (name, url) => {
      if (url) await openUrl(url)
      await sleep(5000)
      simctl('io', SIM, 'screenshot', path.join(OUT, `${name}.png`))
      console.log('✓', name)
    }
    const browse = (p) => `afinder://browse?computer=${room}${p ? `&path=${encodeURIComponent(path.join(HOME, p))}` : ''}`
    await shot('01-computers')
    await shot('02-places', browse())
    await shot('03-documents', browse('Documents'))
    await shot('04-screenshots', browse('Pictures/Screenshots'))
    await shot('05-project', browse('Projects/atlas-web/src'))
  } finally {
    await app.close()
    fs.rmSync(WORK, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
