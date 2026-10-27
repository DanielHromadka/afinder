// Run with Electron after `npm run build` (and `npm install` in feedback/). Starts the feedback Worker
// locally with wrangler against a fake GitHub API in this process, then the built aFinder with disposable
// app data; opens the dialog from the Help menu, sends a report and checks what reached "GitHub". AFINDER_SMOKE_SHOT=<file.png> also saves a picture of the dialog.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const WORKER_PORT = 8798;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-feedback-smoke-'));
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ language: 'en', theme: 'xp', autoUpdate: false, tourOffered: true, lastPath: os.homedir() }));
app.setPath('userData', directory);

// The fake GitHub: records requests and answers like the real API.
const received = [];
const github = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ number: 1 }));
  });
});

let worker = null;
let workerLog = '';
let exitCode = 0;
app.once('will-quit', () => {
  try {
    if (worker) process.kill(-worker.pid, 'SIGTERM');
  } catch {}
  github.close();
  fs.rmSync(directory, { recursive: true, force: true });
  app.exit(exitCode);
});

process.env.AFINDER_FEEDBACK_URL = `http://127.0.0.1:${WORKER_PORT}/v1/feedback`;
require(path.resolve(root, 'out/main/index.js'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  try {
    await new Promise((resolve) => github.listen(0, '127.0.0.1', resolve));
    const api = `http://127.0.0.1:${github.address().port}`;
    worker = spawn(
      path.join(root, 'feedback/node_modules/.bin/wrangler'),
      ['dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--show-interactive-dev-session=false', '--var', `GITHUB_API:${api}`, '--var', 'GITHUB_TOKEN:smoke-token'],
      { cwd: path.join(root, 'feedback'), stdio: ['ignore', 'pipe', 'pipe'], detached: true }
    );
    worker.stdout.on('data', (d) => (workerLog += d));
    worker.stderr.on('data', (d) => (workerLog += d));
    worker.on('error', (err) => (workerLog += `\n${err.message}`));
    await until(() => fetch(`http://127.0.0.1:${WORKER_PORT}/`).then((r) => r.ok, () => false), `Worker did not start:\n${workerLog}`, 60000);

    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w || w.webContents.isLoading()) return false;
      return (await w.webContents.executeJavaScript('!!document.querySelector(".toolbar")')) ? w : false;
    }, 'Application did not render');
    const js = (code) => win.webContents.executeJavaScript(code);

    await js(`document.querySelector('.toolbar [data-tour="help"]').click()`)
    await until(() => js('!!document.querySelector(".context-menu")'), 'Help menu did not open')
    await js(`[...document.querySelectorAll('.context-menu .menu-item')].find((el) => el.textContent.includes('Report a Problem')).click()`);
    await until(() => js('!!document.querySelector(".feedback-dialog textarea")'), 'Dialog did not open');
    await js(`(() => {
      const area = document.querySelector('.feedback-dialog textarea');
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(area, 'Tab bar flickers when resizing\\nSteps: drag the window edge.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    if (process.env.AFINDER_SMOKE_SHOT) fs.writeFileSync(process.env.AFINDER_SMOKE_SHOT, (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.feedback-dialog button[type=submit]').click()`);
    await until(() => js('!!document.querySelector(".feedback-sent")'), `Report was not sent: ${await js('document.querySelector(".feedback-error")?.textContent ?? ""')}`, 30000);

    assert.equal(received.length, 1, 'only the issue');
    const [issue] = received;
    assert.equal(issue.auth, 'Bearer smoke-token');
    assert.equal(issue.url, '/repos/DanielHromadka/afinder/issues');
    assert.equal(issue.body.title, 'Tab bar flickers when resizing');
    assert.deepEqual(issue.body.labels, ['bug']);
    assert.match(issue.body.body, /\| aFinder \| \d+\.\d+\.\d+ \|/);
    assert.doesNotMatch(issue.body.body, new RegExp(os.homedir().replace(/[/\\]/g, '.')), 'no home path in the report');

    // A suggestion without details: nothing technical.
    await js(`window.api.feedback.send({ kind: 'idea', message: 'More XP sounds', includeInfo: false })`);
    assert.equal(received.length, 2);
    assert.deepEqual(received[1].body.labels, ['enhancement']);
    assert.doesNotMatch(received[1].body.body, /System/);
    // An old version still sends an e-mail and a screenshot: neither reaches the public issue.
    const old = await fetch(process.env.AFINDER_FEEDBACK_URL, { method: 'POST', body: JSON.stringify({ kind: 'bug', message: 'Old', email: 'tester@example.com', screenshot: '/9j/4AAQ' }) });
    assert.equal(old.status, 201);
    assert.equal(received.length, 3, 'no screenshot upload');
    assert.doesNotMatch(received[2].body.body, /example\.com|Screenshot/);
    console.log('PASS: toolbar → dialog → Worker → public GitHub issue, without e-mail or screenshot');
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    app.quit();
  }
});
