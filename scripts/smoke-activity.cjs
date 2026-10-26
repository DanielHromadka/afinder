// Disposable Electron integration test. Set AFINDER_MODEL_CACHE to an already downloaded model for offline ONNX verification.
const { app, BrowserWindow } = require('electron');
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-activity-smoke-'));
const folder = path.join(directory, 'work'); fs.mkdirSync(folder);
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ language: 'en', autoUpdate: false, lastPath: folder }));
app.setPath('userData', directory);
let exitCode = 0;
app.once('will-quit', () => { fs.rmSync(directory, { recursive: true, force: true }); app.exit(exitCode); });
const applicationRoot = process.env.AFINDER_APP_ROOT || path.resolve(__dirname, '..');
require(path.join(applicationRoot, 'out/main/index.js'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(50); }
  throw new Error(message);
}
async function offlineModel() {
  const worker = new Worker(path.join(applicationRoot, 'out/main/activityEmbeddingWorker.js'), { workerData: { cacheDir: process.env.AFINDER_MODEL_CACHE } });
  try {
    const start = performance.now();
    const vectors = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Offline model timeout')), 60000);
      worker.on('error', reject);
      worker.on('message', (m) => { if (m.id === 1) { clearTimeout(timer); if (m.error) reject(new Error(m.error)); else resolve(m.vectors); } });
      worker.postMessage({ id: 1, type: 'embed', query: false, texts: ['Zálohování fotografií na externí disk', 'Backup camera photos to an external drive', 'Quarterly invoice and tax accounting'] });
    });
    assert.equal(vectors.length, 3); assert.equal(vectors[0].length, 384);
    const dot = (a,b) => a.reduce((sum, v, i) => sum + v*b[i], 0);
    assert.ok(dot(vectors[0], vectors[1]) > dot(vectors[0], vectors[2]), 'Multilingual semantic similarity failed');
    console.log(`PASS: Electron native ONNX, offline Czech/English embeddings, 384 dimensions (${Math.round(performance.now()-start)} ms including load)`);
  } finally { await worker.terminate(); }
}
app.whenReady().then(async () => {
  try {
    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0];
      return w && !w.webContents.isLoading() && await w.webContents.executeJavaScript('!!window.api && !!document.querySelector(".toolbar")') ? w : false;
    }, 'Application did not render');
    const js = (code) => win.webContents.executeJavaScript(code);
    let settings = await js('window.api.getSettings()');
    assert.equal(settings.activityEnabled, false); assert.equal(settings.semanticEnabled, false);
    await js(`window.api.mkdir(${JSON.stringify(folder)})`);
    assert.equal((await js('window.api.activity.status()')).total, 0);
    assert.equal(fs.existsSync(path.join(directory, 'activity/history.sqlite')), false);
    await js('document.querySelector(\'[data-tour=settings]\').click()');
    // The history switch lives in the AI category of the settings.
    await until(() => js('!!document.querySelector("#settings-tab-ai")'), 'Settings did not open');
    await js('document.querySelector("#settings-tab-ai").click()');
    await until(() => js('!!document.querySelector("dialog.settings-dialog[open]")'), 'Settings did not open');
    await js('Array.from(document.querySelectorAll(".settings-check")).find(el => el.textContent.includes("Save activity history")).querySelector("input").click()');
    await until(async () => (await js('window.api.getSettings()')).activityEnabled, 'History not enabled from Settings');
    const created = await js(`window.api.mkdir(${JSON.stringify(folder)})`);
    await js(`window.api.activity.note(${JSON.stringify(folder)}, 'Photo backup', 'Camera pictures synchronized to external disk')`);
    const events = await js('window.api.activity.query({})');
    assert.ok(events.events.some(e => e.action === 'create' && e.paths.includes(created)));
    await js('Array.from(document.querySelectorAll(".settings-content button")).find(el => el.textContent === "Activity history").click()');
    await until(() => js('!!document.querySelector("dialog.activity-dialog[open]") && !!document.querySelector(".activity-event")'), 'Activity dialog did not render');
    assert.ok(await js('document.querySelector(".activity-events").textContent.includes("Photo backup")'));
    await js(`(() => {
      const input = document.querySelector('.activity-search input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'camera');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(100);
    await js('document.querySelector(".activity-search button").click()');
    await until(() => js('document.querySelectorAll(".activity-event").length === 1'), 'Text filter failed');
    if (process.env.AFINDER_MODEL_CACHE) {
      fs.cpSync(process.env.AFINDER_MODEL_CACHE, path.join(directory, 'embedding-model'), {recursive:true});
      await js('window.api.setSettings({semanticEnabled:true})');
      assert.equal((await js('window.api.activity.status()')).modelReady, false);
      const downloaded = await js('window.api.activity.download()');
      assert.equal(downloaded.modelReady, true, downloaded.error || 'Model download check failed');
      await until(async () => { const s = await js('window.api.activity.status()'); if(s.error) throw new Error(s.error); return s.indexed === s.total && s.total > 0; }, 'Background index did not finish', 30000);
      const found = await js('window.api.activity.query({mode:"semantic",text:"zálohování fotografií"})');
      assert.equal(found.events[0].label, 'Photo backup');
      console.log('PASS: explicit model activation → background vectors → Czech semantic query through IPC');
    }
    if (process.env.AFINDER_SCREENSHOT) fs.writeFileSync(process.env.AFINDER_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    await js('window.api.setSettings({activityEnabled:false})');
    const count = (await js('window.api.activity.status()')).total;
    await js(`window.api.mkdir(${JSON.stringify(folder)})`);
    assert.equal((await js('window.api.activity.status()')).total, count);
    await js('window.api.activity.clear()');
    assert.equal((await js('window.api.activity.status()')).total, 0);
    assert.equal(fs.existsSync(path.join(directory, 'activity/history.sqlite')), false);
    console.log('PASS: default off → Settings opt-in → real file action → history UI + text search → immediate opt-out → delete');
    if (process.env.AFINDER_MODEL_CACHE) await offlineModel();
  } catch (error) { exitCode = 1; console.error(error); }
  finally { app.quit(); }
});
