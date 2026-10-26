// Run with Electron after `npm run build`. Uses disposable app data and never calls an AI provider.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-automation-smoke-'));
const source = path.join(directory, 'source');
const destination = path.join(directory, 'destination');
fs.mkdirSync(source);
fs.mkdirSync(destination);
fs.writeFileSync(path.join(source, 'example.txt'), 'real utility process test');
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ language: 'en', theme: 'apple', autoUpdate: false, lastPath: source }));
app.setPath('userData', directory);
let exitCode = 0;
app.once('will-quit', () => {
  fs.rmSync(directory, { recursive: true, force: true });
  app.exit(exitCode);
});
require(path.resolve(__dirname, '../out/main/index.js'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(message);
}
app.whenReady().then(async () => {
  try {
    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w || w.webContents.isLoading()) return false;
      return await w.webContents.executeJavaScript('!!window.api && !!document.querySelector(".toolbar")') ? w : false;
    }, 'Application did not render');
    const js = (code) => win.webContents.executeJavaScript(code);
    await js('document.querySelector(\'button[title="Automations"]\').click()');
    await until(() => js('!!document.querySelector("dialog.automations-dialog[open]") && !document.querySelector(".automation-new").disabled'), 'Automation dialog did not open');
    await js(`document.querySelector('.automation-template').open = true;
      (() => {
        const fields = document.querySelectorAll('.automation-template input');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(fields[0], ${JSON.stringify(source)}); fields[0].dispatchEvent(new Event('input', {bubbles:true}));
        set.call(fields[1], ${JSON.stringify(destination)}); fields[1].dispatchEvent(new Event('input', {bubbles:true}));
      })();`);
    await until(() => js('!document.querySelector(".automation-template button").disabled'), 'Sync template could not be configured');
    await js('document.querySelector(".automation-template button").click()');
    await until(() => js('!!document.querySelector(".automation-editor")'), 'Workflow editor did not render');
    await js('document.querySelector(".automation-actions button").click()');
    const id = await until(() => js('window.api.automations.list().then(items => items[0]?.id)'), 'Automation was not saved');
    assert.equal(await js('window.api.automations.list().then(items => items[0].enabled)'), false);
    await until(() => js('document.querySelectorAll(".automation-actions button").length === 3 && !document.querySelectorAll(".automation-actions button")[1].disabled'), 'Manual run unavailable');
    await js('document.querySelectorAll(".automation-actions button")[1].click()');
    const run = await until(() => js('window.api.automations.list().then(items => items[0]?.runs[0]?.finishedAt ? items[0].runs[0] : false)'), 'Workflow or verification did not finish');
    assert.equal(run.status, 'success', run.log);
    assert.match(run.log, /SHA-256 verified files: 1/);
    assert.equal(fs.readFileSync(path.join(destination, 'example.txt'), 'utf8'), 'real utility process test');
    console.log('PASS: UI creation → save paused → real workflow → SHA-256 verification');

    // Exercise actual pointer capture; ensure the dialog itself moves, not the application window.
    const rectangle = () => js('(() => { const r = document.querySelector("dialog.automations-dialog").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width}; })()');
    const before = await rectangle();
    const x = Math.round(before.x + before.width / 2), y = Math.round(before.y + 12);
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x + 20, y: y + 8, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x + 20, y: y + 8, button: 'left', clickCount: 1 });
    await until(async () => (await rectangle()).x > before.x + 10, 'Dialog could not be moved by its title bar');
    win.setSize(640, 500);
    await sleep(100);
    assert.equal(await js('document.querySelector(".automation-layout").scrollWidth <= document.querySelector(".automation-layout").clientWidth'), true);
    if (process.env.AFINDER_SMOKE_ARTIFACTS) {
      fs.mkdirSync(process.env.AFINDER_SMOKE_ARTIFACTS, { recursive: true });
      fs.writeFileSync(path.join(process.env.AFINDER_SMOKE_ARTIFACTS, 'automations.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('PASS: draggable dialog and narrow window layout');

    // A SIGTERM-resistant script must still stop. This exercises the production hard-kill fallback.
    await js(`window.api.automations.list().then(items => window.api.automations.save(${JSON.stringify(id)}, {
      ...items[0], script: "module.exports = async () => { process.on('SIGTERM', () => {}); console.log('waiting-for-stop'); await new Promise(() => setInterval(() => {}, 1000)); }"
    }))`);
    await js(`window.api.automations.run(${JSON.stringify(id)})`);
    await until(() => js('window.api.automations.list().then(items => items[0].runs[0].log.includes("waiting-for-stop"))'), 'Cancellation fixture did not start');
    await js(`window.api.automations.cancel(${JSON.stringify(id)})`);
    const cancelled = await until(() => js('window.api.automations.list().then(items => items[0].runs[0].finishedAt ? items[0].runs[0] : false)'), 'Cancellation did not terminate the process');
    assert.equal(cancelled.status, 'cancelled');
    console.log('PASS: stop terminates a SIGTERM-resistant utility process');
  } catch (error) {
    exitCode = 1;
    console.error('Automation smoke test failed:', error);
  } finally { app.quit(); }
});
