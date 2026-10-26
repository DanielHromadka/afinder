// Run with Electron after `npm run build` (and `npm install` in feedback/). Starts the feedback Worker
// locally with wrangler against a fake GitHub API in this process, then the built aFinder with disposable
// app data; opens the dialog from the Help menu, sends a report with the window screenshot and checks
// what reached "GitHub". AFINDER_SMOKE_SHOT=<file.png> also saves a picture of the dialog.
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
    res.end(JSON.stringify(req.url.includes('/contents/') ? { content: { html_url: `https://github.com/owner/feedback/blob/main${req.url.split('/contents')[1]}` } } : { number: 1 }));
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

    // The toolbar button takes the shot first, then shows the dialog with its preview.
    await js(`document.querySelector('.toolbar [data-tour="help"]').click()`)
    await until(() => js('!!document.querySelector(".context-menu")'), 'Help menu did not open')
    await js(`[...document.querySelectorAll('.context-menu .menu-item')].find((el) => el.textContent.includes('Report a Problem')).click()`);
    await until(() => js('!!document.querySelector(".feedback-dialog .feedback-shot img")'), 'Dialog with screenshot did not open');
    await js(`(() => {
      const area = document.querySelector('.feedback-dialog textarea');
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(area, 'Tab bar flickers when resizing\\nSteps: drag the window edge.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      const mail = document.querySelector('.feedback-dialog input[type=email]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(mail, 'tester@example.com');
      mail.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    if (process.env.AFINDER_SMOKE_SHOT) fs.writeFileSync(process.env.AFINDER_SMOKE_SHOT, (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.feedback-dialog button[type=submit]').click()`);
    await until(() => js('!!document.querySelector(".feedback-sent")'), `Report was not sent: ${await js('document.querySelector(".feedback-error")?.textContent ?? ""')}`, 30000);

    assert.equal(received.length, 2, 'screenshot and issue');
    const [shot, issue] = received;
    assert.equal(shot.method, 'PUT');
    assert.match(shot.url, /^\/repos\/DanielHromadka\/afinder-feedback\/contents\/screenshots\/\d{4}-\d\d\/.+\.jpg$/);
    const jpeg = Buffer.from(shot.body.content, 'base64');
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
    assert.ok(jpeg.length < 1_500_000, `screenshot is ${jpeg.length} bytes`);
    assert.equal(shot.auth, 'Bearer smoke-token');
    assert.equal(issue.url, '/repos/DanielHromadka/afinder-feedback/issues');
    assert.equal(issue.body.title, 'Tab bar flickers when resizing');
    assert.deepEqual(issue.body.labels, ['bug']);
    assert.match(issue.body.body, /\| aFinder \| \d+\.\d+\.\d+ \|/);
    assert.match(issue.body.body, /\| Reply to \| tester@​example\.com \|/);
    assert.match(issue.body.body, /!\[Screenshot\]\(https:\/\/github\.com\/owner\/feedback\/blob\/main\/screenshots\/.+\.jpg\?raw=true\)/);
    assert.doesNotMatch(issue.body.body, new RegExp(os.homedir().replace(/[/\\]/g, '.')), 'no home path in the report');

    // A suggestion without screenshot or details: one request, nothing technical.
    await js(`window.api.feedback.send({ kind: 'idea', message: 'More XP sounds', email: '', screenshot: null, includeInfo: false })`);
    assert.equal(received.length, 3);
    assert.deepEqual(received[2].body.labels, ['enhancement']);
    assert.doesNotMatch(received[2].body.body, /System/);
    // Bad input is refused in main, before anything is sent.
    await assert.rejects(js(`window.api.feedback.send({ kind: 'bug', message: 'x', email: 'nope', screenshot: null, includeInfo: false })`), /email/);
    assert.equal(received.length, 3);
    console.log(`PASS: toolbar → screenshot (${Math.round(jpeg.length / 1024)} kB JPEG) → Worker → GitHub screenshot + issue`);
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    app.quit();
  }
});
