// Captures the v2 website screenshots from the built app (`npm run build` first).
// Runs against a generated demo home (/Users/alex) with a small git repository and a throwaway profile,
// so no personal files, settings, host names or commits show up.
//
//   npm i --no-save playwright@1.63.0 && node website/scripts/screenshots.cjs [name prefix]
//
// Writes PNGs to website/img/raw/ (git-ignored); `optimize.sh` turns them into the published WebP files.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { _electron: electron } = require('playwright')

const ROOT = path.resolve(__dirname, '../..')
// AFINDER_SHOTS_OUT and AFINDER_SHOTS_SIZE (e.g. 1440x900, 16:10 for the Mac App Store) override the website defaults.
const OUT = process.env.AFINDER_SHOTS_OUT || path.join(ROOT, 'website/img/raw')
const [W, H] = (process.env.AFINDER_SHOTS_SIZE || '1280x780').split('x').map(Number)
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-shots-'))
const HOME = path.join(WORK, 'alex')
const PROFILE = path.join(WORK, 'profile')
const REPO = path.join(HOME, 'Projects/atlas-web')

const THEMES = ['apple', 'xp', 'classic', 'cyberpunk', 'fbi', 'jarvis', 'barbie', 'batman', 'bitcoin', 'matrix', 'dos']

// ---- demo home -------------------------------------------------------------------------------

const day = 86_400_000
const now = Date.now()

/** [relative path, size in bytes, age in days]; folders end with "/". Sparse files: real sizes, no disk used. */
const TREE = [
  ['Desktop/', 0, 3],
  ['Desktop/Screenshot 2026-10-02.png', 1_840_221, 6],
  ['Desktop/Meeting notes.txt', 3_412, 1],
  ['Documents/Invoices/', 0, 12],
  ['Documents/Invoices/Invoice 2026-07.pdf', 182_330, 95],
  ['Documents/Invoices/Invoice 2026-08.pdf', 179_008, 64],
  ['Documents/Invoices/Invoice 2026-09.pdf', 184_516, 33],
  ['Documents/Invoices/Invoice 2026-10.pdf', 181_207, 4],
  ['Documents/Contracts/', 0, 40],
  ['Documents/Contracts/Lease agreement.pdf', 1_204_880, 210],
  ['Documents/Contracts/Freelance contract Northwind.pdf', 402_117, 41],
  ['Documents/Taxes 2025/', 0, 160],
  ['Documents/Taxes 2025/Tax return 2025.pdf', 2_310_442, 162],
  ['Documents/Taxes 2025/Receipts.zip', 48_221_904, 170],
  ['Documents/Quarterly report Q3.docx', 842_115, 2],
  ['Documents/Budget 2026.xlsx', 96_340, 9],
  ['Documents/Conference talk.key', 18_442_901, 21],
  ['Documents/Trip to Lisbon.pdf', 3_118_220, 48],
  ['Documents/Reading list.md', 4_215, 15],
  ['Documents/Passport scan.jpg', 2_904_118, 300],
  ['Documents/Recipes.txt', 12_884, 120],
  ['Downloads/', 0, 0],
  ['Downloads/node-v24.9.0.pkg', 76_801_224, 5],
  ['Downloads/Figma-125.8.dmg', 214_330_912, 11],
  ['Downloads/wallpaper-mountains.jpg', 6_204_871, 18],
  ['Downloads/statement-september.pdf', 221_993, 7],
  ['Downloads/fonts.zip', 12_118_504, 30],
  ['Music/', 0, 90],
  ['Pictures/', 0, 2],
  ['Projects/', 0, 1],
  ['Projects/billing-service/', 0, 20],
  ['Projects/billing-service/invoices.go', 9_311, 20],
  ['Projects/billing-service/main.go', 2_207, 22],
  ['Projects/dotfiles/', 0, 120]
]

/** The demo repository: real text, so diffs and the preview have something to show. */
const SOURCES = {
  'README.md': '# atlas-web\n\nInvoices and reports for the Atlas team.\n\n```sh\nnpm install\nnpm run dev\n```\n',
  'package.json': '{\n  "name": "atlas-web",\n  "version": "1.4.0",\n  "type": "module",\n  "scripts": { "dev": "vite", "build": "vite build", "test": "vitest" }\n}\n',
  'src/index.ts': "import { router } from './router'\n\nrouter.start(document.getElementById('app')!)\n",
  'src/router.ts': "import { invoices } from './invoice'\n\nexport const router = {\n  start(root: HTMLElement) {\n    root.append(invoices())\n  }\n}\n",
  'src/invoice.ts':
    "export interface Invoice {\n  id: string\n  customer: string\n  total: number\n}\n\nexport function invoices(): HTMLElement {\n  const list = document.createElement('ul')\n  return list\n}\n"
}

function git(...args) {
  execFileSync('git', args, {
    cwd: REPO,
    env: { ...process.env, HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Alex Novak', GIT_AUTHOR_EMAIL: 'alex@atlas.dev', GIT_COMMITTER_NAME: 'Alex Novak', GIT_COMMITTER_EMAIL: 'alex@atlas.dev' },
    stdio: 'ignore'
  })
}

function write(rel, text) {
  fs.mkdirSync(path.dirname(path.join(REPO, rel)), { recursive: true })
  fs.writeFileSync(path.join(REPO, rel), text)
}

/** A short history with a merged feature branch, an open branch and uncommitted work. */
function seedRepo() {
  fs.mkdirSync(REPO, { recursive: true })
  git('init', '-q', '-b', 'main')
  const commit = (message, files, daysAgo) => {
    for (const [rel, text] of Object.entries(files)) write(rel, text)
    git('add', '-A')
    const date = new Date(now - daysAgo * day).toISOString()
    execFileSync('git', ['commit', '-q', '-m', message, `--date=${date}`], {
      cwd: REPO,
      env: { ...process.env, HOME, GIT_AUTHOR_NAME: 'Alex Novak', GIT_AUTHOR_EMAIL: 'alex@atlas.dev', GIT_COMMITTER_NAME: 'Alex Novak', GIT_COMMITTER_EMAIL: 'alex@atlas.dev', GIT_COMMITTER_DATE: date }
    })
  }
  commit('Set up Vite and TypeScript', { ...SOURCES, 'package.json': SOURCES['package.json'].replace('1.4.0', '1.3.0') }, 14)
  commit('Add the invoice list', { 'src/invoice.ts': SOURCES['src/invoice.ts'].replace('return list', "list.className = 'invoices'\n  return list") }, 12)
  git('checkout', '-q', '-b', 'feature/pdf-export')
  commit('Export invoices as PDF', { 'src/pdf.ts': "export async function exportPdf(id: string): Promise<Blob> {\n  const res = await fetch(`/api/invoices/${id}.pdf`)\n  return res.blob()\n}\n" }, 9)
  commit('Name exported files after the customer', { 'src/pdf.ts': "export async function exportPdf(id: string, customer: string): Promise<File> {\n  const res = await fetch(`/api/invoices/${id}.pdf`)\n  return new File([await res.blob()], `${customer} ${id}.pdf`)\n}\n" }, 8)
  git('checkout', '-q', 'main')
  commit('Show totals in the footer', { 'src/router.ts': SOURCES['src/router.ts'].replace('root.append(invoices())', "root.append(invoices())\n    root.append(document.createElement('footer'))") }, 7)
  const merged = new Date(now - 5 * day).toISOString()
  execFileSync('git', ['merge', '-q', '--no-ff', 'feature/pdf-export', '-m', "Merge branch 'feature/pdf-export'"], {
    cwd: REPO,
    env: { ...process.env, HOME, GIT_AUTHOR_NAME: 'Alex Novak', GIT_AUTHOR_EMAIL: 'alex@atlas.dev', GIT_COMMITTER_NAME: 'Alex Novak', GIT_COMMITTER_EMAIL: 'alex@atlas.dev', GIT_AUTHOR_DATE: merged, GIT_COMMITTER_DATE: merged }
  })
  commit('Bump version to 1.4.0', { 'package.json': SOURCES['package.json'] }, 3)
  git('checkout', '-q', '-b', 'feature/dark-mode')
  commit('Add a dark colour scheme', { 'src/theme.css': ':root { color-scheme: light dark; }\n' }, 1)
  git('checkout', '-q', 'main')
  // Work in progress: one staged change, one unstaged, one new file.
  write('src/invoice.ts', fs.readFileSync(path.join(REPO, 'src/invoice.ts'), 'utf8').replace('  total: number\n', '  total: number\n  dueDate: Date\n'))
  git('add', 'src/invoice.ts')
  write('README.md', SOURCES['README.md'] + '\n## Deploy\n\nPushes to main deploy to staging.\n')
  write('src/totals.ts', "export const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)\n")
}

function seed() {
  for (const [rel, size] of TREE) {
    const p = path.join(HOME, rel)
    if (rel.endsWith('/')) fs.mkdirSync(p, { recursive: true })
    else {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, '')
      fs.truncateSync(p, size)
    }
  }
  for (const [rel, , age] of [...TREE].reverse()) {
    const t = new Date(now - age * day - 3_600_000 * ((rel.length * 7) % 9))
    fs.utimesSync(path.join(HOME, rel), t, t)
  }
  seedRepo()
  // The integrated terminal shows this prompt instead of the machine's host name.
  fs.writeFileSync(path.join(HOME, '.zshrc'), "PROMPT='%F{cyan}alex%f %F{blue}%1~%f %# '\nunsetopt PROMPT_SP\n")
  fs.writeFileSync(path.join(HOME, '.bashrc'), "PS1='alex \\W $ '\n")
}

// ---- capture ---------------------------------------------------------------------------------

const tab = (p, groupBy = 'none') => ({ path: path.join(HOME, p), groupBy })
const leaf = (editor) => ({ editor })
const row = (ratio, a, b) => ({ split: 'row', ratio, a, b })
const column = (ratio, a, b) => ({ split: 'column', ratio, a, b })
const workspace = (root, panes = 1) => ({ workspaces: [{ id: 'shot', name: 'Files', root, panes, paneAxis: 'row' }], activeWorkspace: 'shot' })

function settings(patch) {
  return {
    lastPath: null,
    showHidden: false,
    theme: 'apple',
    language: 'en',
    autoUpdate: false,
    // The first-start tour offer would cover every shot.
    tourOffered: true,
    bounds: { x: 60, y: 40, width: W, height: H },
    maximized: false,
    layout: { activePane: 0, panes: [{ tabs: [tab('Documents')], active: 0, weight: 1 }] },
    ...workspace(row(0.2, leaf('tasks'), leaf('files'))),
    ...patch
  }
}

async function shoot(name, patch, act) {
  const only = process.argv[2]
  if (only && !name.startsWith(only)) return
  fs.rmSync(PROFILE, { recursive: true, force: true })
  fs.mkdirSync(PROFILE, { recursive: true })
  fs.writeFileSync(path.join(PROFILE, 'settings.json'), JSON.stringify(settings(patch)))
  const app = await electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules/electron')),
    args: [ROOT, `--user-data-dir=${PROFILE}`],
    env: { ...process.env, HOME, SHELL: '/bin/zsh', ZDOTDIR: HOME, ELECTRON_ENABLE_LOGGING: '0' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.statusbar')
    await page.waitForTimeout(1500)
    if (act) await act(page)
    await page.waitForTimeout(500)
    await scrub(page)
    await page.screenshot({ path: path.join(OUT, `${name}.png`) })
    console.log('✓', name)
  } finally {
    await app.close()
  }
}

/** macOS finds the real home and volumes without $HOME; present the demo as /Users/alex everywhere. */
async function scrub(page) {
  const temp = [WORK, fs.realpathSync(WORK)]
  await page.evaluate(
    ({ temp, user }) => {
      // Every text field, not only the address bar: dialogs show folders too (Create Archive's "Save to").
      for (const input of document.querySelectorAll('input, textarea')) for (const t of temp) input.value = input.value.replaceAll(t, '/Users')
      const keep = ['Desktop', 'Documents', 'Downloads', 'Applications', 'Macintosh HD']
      const places = [...document.querySelectorAll('.task-section')].find((s) => s.querySelector('.task-header')?.textContent?.includes('Other Places'))
      for (const link of places?.querySelectorAll('.task-link') ?? []) {
        const label = link.textContent.trim()
        if (label === user) link.lastChild.textContent = 'alex'
        else if (!keep.includes(label)) link.remove()
      }
      // Anything else that spells out the temporary folder (tooltips stay invisible in a screenshot).
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) for (const t of temp) if (n.nodeValue.includes(t)) n.nodeValue = n.nodeValue.replaceAll(t, '/Users')
    },
    { temp, user: os.userInfo().username }
  )
}

const clickRow = (page, text) => page.locator('.filelist .row', { hasText: text }).first().click()

/** Opens a shell in the console area and runs a command in it. */
async function terminal(page, command) {
  await page.locator('.console .tab-new').first().click()
  await page.locator('.context-menu .menu-item', { hasText: /terminal|shell/i }).first().click()
  await page.waitForSelector('.xterm')
  await page.waitForTimeout(1200)
  await page.locator('.xterm').first().click()
  await page.keyboard.type(command, { delay: 15 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
}

async function main() {
  // A full run starts clean; a filtered one only replaces its own images.
  if (!process.argv[2]) fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  seed()
  const dev = row(0.17, leaf('folders'), column(0.64, row(0.6, leaf('files'), leaf('git')), leaf('console')))
  const inRepo = { layout: { activePane: 0, panes: [{ tabs: [tab('Projects/atlas-web/src'), tab('Documents')], active: 0, weight: 1 }] } }

  // Files, git and a terminal in one window: the hero.
  await shoot('hero', { ...workspace(dev), ...inRepo }, async (page) => {
    await clickRow(page, 'invoice.ts')
    await terminal(page, 'git --no-pager log --oneline --graph --all -8')
  })

  // The history graph over the app.
  await shoot('graph', { ...workspace(row(0.62, leaf('files'), leaf('git'))), ...inRepo }, async (page) => {
    await page.locator('.git-section-head .git-row-actions.shown button').click()
    await page.waitForSelector('.git-graph-row')
    await page.locator('.git-graph-row', { hasText: 'Export invoices as PDF' }).click()
    await page.waitForSelector('.git-commit-files .git-file')
  })

  // A staged diff.
  await shoot('diff', { ...workspace(row(0.62, leaf('files'), leaf('git'))), ...inRepo }, async (page) => {
    await page.locator('.git-section.staged .git-file .git-file-name').first().click()
    await page.waitForSelector('.git-diff-dialog .monaco-diff-editor')
    await page.waitForTimeout(800)
  })

  // Two panes with tabs.
  await shoot('split', {
    ...workspace(row(0.18, leaf('folders'), leaf('files')), 2),
    layout: {
      activePane: 0,
      panes: [
        { tabs: [tab('Documents'), tab('Projects'), tab('Desktop')], active: 0, weight: 1 },
        { tabs: [tab('Downloads')], active: 0, weight: 1 }
      ]
    }
  }, (page) => clickRow(page, 'Budget 2026'))

  // The command palette.
  await shoot('palette', {}, async (page) => {
    await clickRow(page, 'Quarterly report Q3')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    await page.waitForSelector('.palette')
    await page.keyboard.type('archive', { delay: 40 })
  })

  // Search through every subfolder of the home folder.
  await shoot('search', { recursive: true, layout: { activePane: 0, panes: [{ tabs: [tab('')], active: 0, weight: 1 }] } }, async (page) => {
    await page.locator('.filter-box input').first().click()
    await page.keyboard.type('invoice', { delay: 40 })
    await page.waitForTimeout(1500)
  })

  const invoices = { layout: { activePane: 0, panes: [{ tabs: [tab('Documents/Invoices')], active: 0, weight: 1 }] } }
  const selectInvoices = async (page) => {
    await clickRow(page, 'Invoice 2026-07')
    await page.locator('.filelist .row', { hasText: 'Invoice 2026-10' }).first().click({ modifiers: ['Shift'] })
  }

  // Batch rename with its live preview.
  await shoot('rename', invoices, async (page) => {
    await selectInvoices(page)
    await page.keyboard.press('F2')
    await page.waitForSelector('.batch-rename')
    await page.keyboard.type('Invoice ', { delay: 30 })
    await page.locator('.batch-rename input').nth(1).fill('Atlas invoice ')
  })

  // Creating an archive from a selection.
  await shoot('archive', invoices, async (page) => {
    await selectInvoices(page)
    await page.locator('.filelist .row', { hasText: 'Invoice 2026-10' }).first().click({ button: 'right' })
    await page.locator('.context-menu .menu-item', { hasText: 'Create Archive' }).click()
    await page.waitForSelector('.create-archive')
    await page.locator('.create-archive select').first().selectOption('tzst')
  })

  // The preview area: Monaco with the change bars against HEAD.
  await shoot('preview', { ...workspace(row(0.17, leaf('folders'), row(0.46, leaf('files'), leaf('preview')))), ...inRepo }, async (page) => {
    await clickRow(page, 'invoice.ts')
    await page.waitForSelector('.monaco-editor')
    await page.waitForTimeout(800)
  })

  // Connect to Server, filled in for an SFTP host.
  await shoot('remote', {}, async (page) => {
    await page.locator('.task-link', { hasText: 'Connect to Server' }).click()
    await page.waitForSelector('.remote-dialog')
    const inputs = page.locator('.remote-dialog input')
    await inputs.nth(0).fill('Atlas staging')
    await inputs.nth(1).fill('staging.atlas.dev')
    await page.locator('.remote-dialog label', { hasText: 'User name' }).locator('input').fill('deploy').catch(() => inputs.nth(3).fill('deploy'))
  })

  // AI on files: the context menu of a document, with the console beside the files.
  const agentDesk = workspace(row(0.17, leaf('folders'), row(0.58, leaf('files'), leaf('console'))))
  await shoot('ai-menu', agentDesk, async (page) => {
    await page.locator('.filelist .row', { hasText: 'Quarterly report Q3' }).first().click({ button: 'right' })
    await page.waitForSelector('.context-menu')
  })
  await shoot('ai-ask', agentDesk, async (page) => {
    await page.locator('.filelist .row', { hasText: 'Quarterly report Q3' }).first().click({ button: 'right' })
    await page.locator('.context-menu .menu-item', { hasText: 'Ask AI' }).first().click()
    await page.waitForSelector('.ask-ai textarea')
    await page.locator('.ask-ai textarea').fill('Which numbers changed since the Q2 report, and why?')
  })

  // Automations: the sync template, ready to save.
  fs.mkdirSync(path.join(HOME, 'Backups/Invoices'), { recursive: true })
  await shoot('automations', {}, async (page) => {
    await page.locator('.toolbar button', { hasText: 'Automations' }).click()
    await page.waitForSelector('.automations-dialog[open]')
    // Both panels open, whatever state they start in.
    await page.evaluate(() => document.querySelectorAll('.automation-composer, .automation-template').forEach((d) => (d.open = true)))
    const fields = page.locator('.automation-template input')
    await fields.nth(0).fill(path.join(HOME, 'Documents/Invoices'))
    await fields.nth(1).fill(path.join(HOME, 'Backups/Invoices'))
    await fields.nth(2).fill('60')
    await page.locator('.automation-template button').click()
    await page.waitForSelector('.automation-editor')
  })

  // Settings: the MCP server running, and the appearance section.
  const openSettings = async (page, section) => {
    await page.locator('.toolbar button[title^="Settings"]').click()
    await page.waitForSelector('.settings-dialog[open]')
    await page.locator(`#settings-tab-${section}`).click()
    await page.waitForTimeout(600)
  }
  await shoot('mcp', { mcpEnabled: true }, async (page) => {
    await openSettings(page, 'ai')
    await page.locator('.settings-content fieldset', { hasText: 'MCP' }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
  })
  await shoot('settings', {}, (page) => openSettings(page, 'shortcuts'))

  for (const theme of THEMES) await shoot(`theme-${theme}`, { theme }, (page) => clickRow(page, 'Quarterly report Q3'))
}

// scripts/appstore/phone-shots.cjs reuses the demo home.
module.exports = { seed, HOME, WORK }

if (require.main === module)
  main()
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(() => fs.rmSync(WORK, { recursive: true, force: true }))
