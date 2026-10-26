// Real Electron checks of workspaces, areas and the source control area: isolated settings, a temporary
// git repository and a disposable local terminal. AFINDER_SMOKE_ARTIFACTS=<dir> saves screenshots.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-workspace-'))
const repo = path.join(directory, 'repo')
fs.mkdirSync(repo)
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'smoke@example.com')
git('config', 'user.name', 'Smoke Test')
fs.writeFileSync(path.join(repo, 'readme.txt'), 'one\n')
git('add', '-A')
git('commit', '-q', '-m', 'First commit')
// A merged side branch, so the history graph has two lanes.
git('checkout', '-q', '-b', 'feature')
fs.writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
git('add', '-A')
git('commit', '-q', '-m', 'Feature work')
git('checkout', '-q', 'main')
git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature')
fs.writeFileSync(path.join(repo, 'readme.txt'), 'one\ntwo\n')
fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n')
const userData = path.join(directory, 'userData')
fs.mkdirSync(userData)
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ language: 'en', theme: process.env.AFINDER_SMOKE_THEME ?? 'apple', autoUpdate: false, workspaceBar: true, tourOffered: true, lastPath: repo }))
app.setPath('userData', userData)

let exitCode = 0
app.once('will-quit', () => {
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(exitCode)
})
require(path.resolve(process.env.AFINDER_APP_ROOT ?? path.join(__dirname, '..'), 'out/main/index.js'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, message) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await sleep(50)
  }
  throw new Error(message)
}

app.whenReady().then(async () => {
  try {
    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0]
      return w && !w.webContents.isLoading() && (await w.webContents.executeJavaScript('!!document.querySelector(".workspace-bar .ws-tab")')) ? w : false
    }, 'Workspace bar did not render')
    const js = (code) =>
      win.webContents.executeJavaScript(code).catch((e) => {
        console.error('Failed in page:', code.slice(0, 200))
        throw e
      })
    const rect = (selector) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`)
    const shot = async (name) => {
      if (!process.env.AFINDER_SMOKE_ARTIFACTS) return
      fs.mkdirSync(process.env.AFINDER_SMOKE_ARTIFACTS, { recursive: true })
      fs.writeFileSync(path.join(process.env.AFINDER_SMOKE_ARTIFACTS, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    }
    // Synthetic page events, so the real mouse over the test window cannot interfere.
    const drag = async (from, to) => {
      await js(`(() => {
        const el = document.elementFromPoint(${from.x}, ${from.y})
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: ${from.x}, clientY: ${from.y} }))
      })()`)
      for (let i = 1; i <= 5; i++) {
        const x = Math.round(from.x + ((to.x - from.x) * i) / 5)
        const y = Math.round(from.y + ((to.y - from.y) * i) / 5)
        await js(`window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: ${x}, clientY: ${y} }))`)
        await sleep(30)
      }
      await js(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: ${to.x}, clientY: ${to.y} }))`)
      await sleep(100)
    }
    const editors = () => js(`[...document.querySelectorAll('.workspace-body .area')].map(a => a.dataset.editor).join()`)
    const selectWorkspace = (name) => js(`[...document.querySelectorAll('.ws-tab')].find(t => t.textContent === ${JSON.stringify(name)}).dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0})); window.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))`)
    const clickMenu = (label) => js(`[...document.querySelectorAll('.context-menu .menu-item')].find(el => el.textContent.includes(${JSON.stringify(label)})).click()`)

    win.setSize(1280, 820)
    await sleep(200)
    assert.equal(await js(`[...document.querySelectorAll('.ws-tab')].map(t => t.textContent).join()`), 'Files,Commander,Agent,Preview')
    assert.equal(await editors(), 'tasks,files')
    await shot('1-files')

    // Divider: mouse drag and keyboard.
    const before = await rect('.area-tasks')
    const divider = await rect('.workspace-body > .area-split > .area-divider')
    await drag({ x: Math.round(divider.x + 2), y: 300 }, { x: Math.round(divider.x + 90), y: 300 })
    await until(async () => (await rect('.area-tasks')).width > before.width + 60, 'Divider drag did not resize')
    await sleep(200)
    await js(`document.querySelector('.workspace-body > .area-split > .area-divider').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', shiftKey: true, bubbles: true}))`)
    await until(async () => (await rect('.area-tasks')).width < before.width + 60, 'Keyboard resize did not work')

    // Toolbar Folders button swaps tasks for the folder tree.
    await js(`[...document.querySelectorAll('.toolbar .tool-btn')].find(b => b.textContent.includes('Folders')).click()`)
    await until(async () => (await editors()) === 'folders,files', 'Folders toggle did not switch the side area')

    // Open a terminal, then switch workspaces: tabs and the terminal element must survive.
    await js(`document.querySelector('.pane .tab-new').click()`)
    await until(() => js('document.querySelectorAll(".tabstrip .tab").length === 2'), 'Extra tab did not open')
    await selectWorkspace('Agent')
    await until(async () => (await editors()) === 'folders,files,console', 'Agent workspace did not show the console')
    await js(`document.querySelector('.console .tab-new').click()`)
    await until(() => js('!!document.querySelector(".context-menu")'), 'Console menu missing')
    await js(`[...document.querySelectorAll('.context-menu .menu-item')].find(el => /terminal|shell/i.test(el.textContent)).click()`)
    await until(() => js('!!document.querySelector(".xterm")'), 'Terminal did not open')
    await js('window.smokeTerminal = document.querySelector(".xterm")')
    await shot('2-agent')
    for (const name of ['Commander', 'Preview', 'Files', 'Agent']) {
      await selectWorkspace(name)
      await sleep(150)
      assert.equal(await js('window.smokeTerminal === document.querySelector(".xterm")'), true, `Terminal remounted when switching to ${name}`)
      assert.ok((await js('document.querySelectorAll(".tabstrip .tab").length')) >= 2, `Tabs lost when switching to ${name}`)
      if (name === 'Commander') {
        assert.equal(await js('document.querySelectorAll(".panes > .pane").length'), 2, 'Commander did not show two panes')
        await shot('3-commander')
      }
      if (name === 'Preview') await shot('4-preview')
    }
    assert.equal(await js('document.querySelectorAll(".panes > .pane").length'), 1, 'Agent workspace should show one pane')
    assert.equal(await js(`[...document.querySelectorAll('.ws-tab')].map(t => t.textContent).join()`), 'Files,Commander,Agent,Preview', 'Clicking workspace tabs reordered them')

    // Drag the folder tree to the right edge of the console: the areas rearrange.
    const header = await rect('.area-folders .area-header')
    const consoleArea = await rect('.area-console')
    await drag({ x: Math.round(header.x + 60), y: Math.round(header.y + 10) }, { x: Math.round(consoleArea.x + consoleArea.width - 15), y: Math.round(consoleArea.y + consoleArea.height / 2) })
    await until(async () => (await editors()) === 'files,console,folders', 'Dragging the area did not dock it')
    assert.equal(await js('window.smokeTerminal === document.querySelector(".xterm")'), true, 'Terminal remounted when areas moved')
    await shot('5-docked')

    // Maximize the console and restore (the shortcut acts on the area last clicked).
    const mod = process.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
    const maximize = () => js(`document.querySelector('.console-bar').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', ${mod}: true, shiftKey: true, bubbles: true}))`)
    await js(`document.querySelector('.area-console .console-bar').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))`)
    await maximize()
    await until(async () => (await editors()) === 'console', 'Maximize area did not work')
    assert.equal(await js('window.smokeTerminal === document.querySelector(".xterm")'), true, 'Terminal remounted when maximized')
    await maximize()
    await until(async () => (await editors()) === 'files,console,folders', 'Restore after maximize did not work')

    // Split and add from the Files area's editor menu: a submenu two levels deep (editor, then side).
    const openSub = (label) => js(`[...document.querySelectorAll('.context-menu .menu-item')].find(el => el.textContent.includes(${JSON.stringify(label)})).click()`)
    await js(`document.querySelector('.tabstrip .area-editor').click()`)
    await until(() => js('!!document.querySelector(".context-menu")'), 'Files area menu missing')
    await openSub('Split and add')
    await until(() => js(`[...document.querySelectorAll('.context-menu.submenu .menu-item')].some(el => el.textContent.includes('Tools'))`), 'Split and add submenu is empty')
    await openSub('Tools')
    await until(() => js('document.querySelectorAll(".context-menu.submenu").length === 2'), 'Editor submenu did not open its sides')
    await js(`[...document.querySelectorAll('.context-menu.submenu')[1].querySelectorAll('.menu-item')].find(el => el.textContent === 'Right').click()`)
    await until(async () => (await editors()) === 'files,tools,console,folders', 'Split and add did not add the Tools area on the right')
    await js(`document.querySelector('.area-tools .area-header .area-btn:last-of-type').click()`)
    await until(async () => (await editors()) === 'files,console,folders', 'Closing the Tools area did not work')

    // Source control: add the git area next to the files, commit everything, check git agrees.
    await js(`document.querySelector('.ws-areas').click()`)
    await until(() => js('!!document.querySelector(".context-menu")'), 'Area menu missing')
    await js(`[...document.querySelectorAll('.context-menu .menu-item')].find(el => el.textContent.includes('Source control')).click()`)
    await sleep(100)
    await clickMenu('Right')
    await until(() => js('!!document.querySelector(".git-panel .git-file")'), 'Git panel did not list changes')
    assert.equal(await js(`document.querySelector('.git-branch').textContent.includes('main')`), true, 'Branch not shown')
    assert.equal(await js(`document.querySelectorAll('.git-file').length`), 2, 'Expected two changed files')
    await js(`(() => { const el = document.querySelector('.git-commit textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Second commit'); el.dispatchEvent(new Event('input', {bubbles: true})) })()`)
    await shot('6-git')

    // Staging area: shown while empty; staging a file moves it there and its diff opens on click.
    assert.equal(await js(`!!document.querySelector('.git-section.staged .git-clean')`), true, 'Empty staging area not shown')
    await js(`[...document.querySelectorAll('.git-section.unstaged .git-file')].find(el => el.textContent.includes('readme.txt')).querySelector('button[title^="Stage"]').click()`)
    await until(() => js(`[...document.querySelectorAll('.git-section.staged .git-file')].some(el => el.textContent.includes('readme.txt'))`), 'Staging did not move the file')
    await js(`document.querySelector('.git-section.staged .git-file .git-file-name').click()`)
    await until(() => js(`!!document.querySelector('.git-diff-dialog .monaco-diff-editor')`), 'Diff of the staged file did not open')
    const staged = await js(`window.api.gitDiff(${JSON.stringify(repo)}, { kind: 'staged', path: 'readme.txt' })`)
    assert.deepEqual([staged.original, staged.modified], ['one\n', 'one\ntwo\n'], 'Staged diff compares the wrong versions')
    const untracked = await js(`window.api.gitDiff(${JSON.stringify(repo)}, { kind: 'unstaged', path: 'new.txt', untracked: true })`)
    assert.deepEqual([untracked.original, untracked.modified], ['', 'new\n'], 'Untracked diff is wrong')
    await sleep(300)
    await shot('6b-diff')
    await js(`document.querySelector('.git-diff-dialog .tb-close').click()`)
    await js(`document.querySelector('.git-section.unstaged .git-section-head button[title="Stage all"]').click()`)
    await until(() => js(`document.querySelectorAll('.git-section.staged .git-file').length === 2`), 'Stage all did not stage the rest')
    await js(`window.confirm = () => true; true`)
    await js(`[...document.querySelectorAll('.git-commit-row .xp-button')][0].click()`)
    await until(() => js(`!document.querySelector('.git-panel .git-file')`), 'Commit did not clear the changes')
    assert.equal(git('log', '-1', '--format=%s').trim(), 'Second commit')
    assert.equal(git('status', '--porcelain').trim(), '')
    await until(() => js(`document.querySelector('.git-commit-item .git-subject')?.textContent === 'Second commit'`), 'History did not show the new commit')
    // Only the tab in front: hidden tabs keep their badges until they are shown and refresh then.
    await until(() => js(`!document.querySelector('.pane .tab-view:not(.hidden) :is(.git-modified, .git-untracked)')`), 'File list kept stale git badges')
    await shot('7-committed')

    // History graph: all branches, the merge on two lanes, details and a file diff of a commit.
    await js(`document.querySelector('.git-section-head .git-row-actions.shown button').click()`)
    await until(() => js(`document.querySelectorAll('.git-graph-row').length === 4`), 'Graph did not list the four commits')
    assert.equal(await js(`document.querySelectorAll('.git-graph-row')[1].textContent.includes('Merge feature')`), true, 'Merge commit not second')
    assert.equal(await js(`[...document.querySelectorAll('.git-graph-row circle')].some(c => Number(c.getAttribute('cx')) > 10)`), true, 'Side branch not on its own lane')
    assert.equal(await js(`[...document.querySelectorAll('.git-ref')].map(r => r.textContent).join()`).then((r) => r.includes('HEAD') && r.includes('main') && r.includes('feature')), true, 'Branch labels missing')
    await js(`[...document.querySelectorAll('.git-graph-row')].find(r => r.textContent.includes('Feature work')).click()`)
    await until(() => js(`document.querySelector('.git-commit-files .git-file')?.textContent.includes('feature.txt')`), 'Commit details did not list the file')
    await shot('8-graph')
    await js(`document.querySelector('.git-commit-files .git-file').click()`)
    await until(() => js(`!!document.querySelector('.git-graph-details .monaco-diff-editor')`), 'Commit file diff did not open')
    await sleep(300)
    await shot('9-graph-diff')
    await js(`document.querySelector('.git-graph-dialog .tb-close').click()`)

    // Persistence: the active workspace and its tree are saved.
    await until(() => js(`window.api.getSettings().then(s => s.activeWorkspace === 'agent' && JSON.stringify(s.workspaces.find(w => w.id === 'agent').root).includes('git'))`), 'Workspace was not saved')
    console.log('workspace smoke test passed')
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    app.quit()
  }
})
