// Run with Electron after `npm run build` (and `npm install` in mobile/relay). Starts the relay locally
// with wrangler, the built aFinder with disposable app data, and the companion client (the phone's) in this
// process; then pairs, browses, downloads and uploads end to end through the relay, checks screen sharing
// and control (with a stand-in for the input helper), and finally pairs aFinder with itself as another
// computer would: its files as a remote connection and its remote desktop window.
// AFINDER_RELAY=wss://… runs the same against a deployed relay instead of a local one.
const { app, BrowserWindow, dialog, systemPreferences } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const PORT = 8799;
const remoteRelay = process.env.AFINDER_RELAY;
const relayUrl = remoteRelay || `ws://127.0.0.1:${PORT}`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afinder-companion-smoke-'));
const files = path.join(directory, 'files');
fs.mkdirSync(files);
const payload = Buffer.alloc(3 * 256 * 1024 + 123, 7).map((_, i) => i % 251);
fs.writeFileSync(path.join(files, 'big.bin'), payload);
// Stands in for native/afinder-input: says it is ready and logs the commands it gets.
const inputLog = path.join(directory, 'input.log');
const fakeHelper = path.join(directory, 'afinder-input');
fs.writeFileSync(fakeHelper, `#!/bin/sh\necho '{"ok":true}'\nexec cat >> "${inputLog}"\n`, { mode: 0o755 });
if (process.platform !== 'win32') process.env.AFINDER_INPUT_HELPER = fakeHelper;
// Viewer and computer are this one machine: host candidates only (see companion.ts).
process.env.AFINDER_ICE_LOCAL = '1';
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ language: 'en', theme: 'apple', autoUpdate: false, lastPath: files, companionEnabled: true, computersEnabled: true, companionRelay: relayUrl }));
app.setPath('userData', directory);

const relay = remoteRelay ? null : spawn(path.join(root, 'mobile/relay/node_modules/.bin/wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], { cwd: path.join(root, 'mobile/relay'), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let relayLog = '';
relay?.stdout.on('data', (d) => (relayLog += d));
relay?.stderr.on('data', (d) => (relayLog += d));
relay?.on('error', (err) => (relayLog += `\n${err.message}`));

let exitCode = 0;
app.once('will-quit', () => {
  try {
    if (relay) process.kill(-relay.pid, 'SIGTERM');
  } catch {}
  fs.rmSync(directory, { recursive: true, force: true });
  app.exit(exitCode);
});

// aFinder starts now; it keeps retrying the relay until wrangler is up.
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
    // The phone client is TypeScript for React Native; bundle it for Node.
    const phoneBundle = path.join(directory, 'phone.mjs');
    require(path.join(root, 'node_modules/esbuild')).buildSync({
      stdin: {
        contents: `export * from './src/shared/companion/client.ts'; export { parsePairingUri } from './src/shared/companion/protocol.ts'; export { newKeyPair } from './src/shared/companion/crypto.ts'`,
        resolveDir: root,
        loader: 'ts'
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: phoneBundle,
      logLevel: 'warning'
    });
    await until(() => fetch(`${relayUrl.replace(/^ws/, 'http')}/`).then((r) => r.ok, () => false), `Relay did not start:\n${relayLog}`, 60000);
    const win = await until(async () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w || w.webContents.isLoading()) return false;
      return (await w.webContents.executeJavaScript('!!window.api && !!document.querySelector(".toolbar")')) ? w : false;
    }, 'Application did not render');
    const js = (code) => win.webContents.executeJavaScript(code);
    // aFinder needs a moment for the module (loaded lazily) to connect.
    await until(() => js('window.api.companion.status().then((s) => s.state === "online")'), 'aFinder did not reach the relay', 60000).catch(async (err) => {
      throw new Error(`${err.message}: ${JSON.stringify(await js('window.api.companion.status()'))}`);
    });
    const { uri } = (await js('window.api.companion.pair("phone")')).pairing;
    const phone = await import(pathToFileURL(phoneBundle).href);
    const link = phone.parsePairingUri(uri);
    assert.ok(link, 'pairing link parses');
    const identity = phone.newKeyPair();

    // Pairing: both sides show the same code; the computer confirms.
    let phoneCode = '';
    const paired = phone.pair(link, identity, 'Smoke phone', (sas) => (phoneCode = sas));
    const request = await until(() => js('window.api.companion.status().then((s) => s.request)'), 'Pair request did not arrive');
    assert.equal(request.name, 'Smoke phone');
    await until(() => phoneCode, 'Phone did not show a code');
    assert.equal(request.sas, phoneCode, 'both screens show the same code');
    await js('window.api.companion.answer(true)');
    const computer = await paired;
    assert.equal(computer.id, link.room);

    // A second phone with the same code is refused: one phone per QR code.
    await assert.rejects(phone.pair(link, phone.newKeyPair(), 'Late phone', () => {}), /pairing-closed/);

    const client = new phone.HostClient(computer, identity);
    const ready = await until(() => client.state.kind === 'ready' && client.state, 'Session did not start');
    assert.equal(ready.info.write, false);
    const listing = await client.call('list', { path: files });
    assert.deepEqual(listing.entries.map((e) => e.name), ['big.bin']);
    const places = await client.call('places', {});
    assert.ok(places.length >= 3);

    // Download through the windowed stream: bytes arrive complete and in order.
    const parts = [];
    let progress = 0;
    await client.download(path.join(files, 'big.bin'), async (d) => void parts.push(Buffer.from(d)), (r) => (progress = r));
    assert.ok(Buffer.concat(parts).equals(payload), 'downloaded bytes match');
    assert.equal(progress, payload.length);

    // A broken transfer resumes from the bytes the phone already has; the version lets it check its cache.
    const tail = [];
    const from = 256 * 1024 + 17;
    const meta = await client.download(path.join(files, 'big.bin'), async (d) => void tail.push(Buffer.from(d)), undefined, from);
    assert.ok(Buffer.concat(tail).equals(payload.subarray(from)), 'resumed bytes match');
    const stat = await client.call('stat', { path: path.join(files, 'big.bin') });
    assert.deepEqual(stat, { size: payload.length, modified: meta.modified, dir: false });
    assert.equal(stat.modified, Math.floor(fs.statSync(path.join(files, 'big.bin')).mtimeMs));
    await assert.rejects(client.call('replace', { path: path.join(files, 'big.bin'), size: 1, sid: 999 }), /only browse/);

    // Read-only until the computer allows changes.
    await assert.rejects(client.call('mkdir', { parent: files, name: 'From phone' }), /only browse/);
    const status = await js('window.api.companion.status()');
    assert.equal(status.devices.length, 1);
    assert.equal(status.devices[0].online, true);
    await js(`window.api.companion.setWrite(${JSON.stringify(status.devices[0].id)}, true)`);
    // Permissions are read per call: no reconnect needed.
    const folder = await client.call('mkdir', { parent: files, name: 'From phone' });
    assert.ok(fs.statSync(folder).isDirectory());

    const upload = Buffer.alloc(600 * 1024).map((_, i) => (i * 7) % 256);
    const saved = await client.upload(folder, 'photo.jpg', upload.length, async (o, n) => new Uint8Array(upload.subarray(o, o + n)));
    assert.equal(saved, path.join(folder, 'photo.jpg'));
    assert.ok(fs.readFileSync(saved).equals(upload), 'uploaded bytes match');
    assert.deepEqual(fs.readdirSync(folder), ['photo.jpg'], 'no temporary file left behind');
    const again = await client.upload(folder, 'photo.jpg', 3, async () => Uint8Array.of(1, 2, 3));
    assert.equal(again, path.join(folder, 'photo 2.jpg'));

    // Edits go back over the original, but never over a version changed on the computer meanwhile.
    const notes = path.join(folder, 'notes.txt');
    fs.writeFileSync(notes, 'first');
    const base = await client.call('stat', { path: notes });
    const edit = Buffer.from('edited on the phone');
    assert.equal(await client.replace(notes, edit.length, async (o, n) => new Uint8Array(edit.subarray(o, o + n)), base), notes);
    assert.equal(fs.readFileSync(notes, 'utf8'), 'edited on the phone');
    fs.writeFileSync(notes, 'changed on the computer');
    await assert.rejects(client.replace(notes, edit.length, async (o, n) => new Uint8Array(edit.subarray(o, o + n)), base), /conflict/);
    assert.equal(fs.readFileSync(notes, 'utf8'), 'changed on the computer', 'a conflict overwrites nothing');
    await client.replace(notes, edit.length, async (o, n) => new Uint8Array(edit.subarray(o, o + n)));
    assert.equal(fs.readFileSync(notes, 'utf8'), 'edited on the phone', 'without a base the phone overwrites');
    assert.deepEqual(fs.readdirSync(folder).sort(), ['notes.txt', 'photo 2.jpg', 'photo.jpg'], 'no temporary file left behind');
    fs.rmSync(notes);

    const renamed = await client.call('rename', { path: again, name: 'second.jpg' });
    assert.ok(fs.existsSync(renamed));
    await client.call('trash', { paths: [renamed] });
    assert.ok(!fs.existsSync(renamed));

    // Move into another folder (aFinder on another computer drags within the mount this way).
    fs.mkdirSync(path.join(files, 'sub'));
    fs.writeFileSync(path.join(files, 'moved.txt'), 'm');
    assert.equal(await client.call('move', { path: path.join(files, 'moved.txt'), dir: path.join(files, 'sub') }), path.join(files, 'sub', 'moved.txt'));
    assert.ok(fs.existsSync(path.join(files, 'sub', 'moved.txt')));

    // Screen: a permission of its own, and with it no confirmation on the computer (unattended access).
    const id = JSON.stringify(status.devices[0].id);
    await assert.rejects(client.call('screenDisplays', {}), /may not view the screen/);
    await js(`window.api.companion.setScreen(${id}, true)`);
    const displays = await client.call('screenDisplays', {});
    assert.ok(displays.length >= 1 && displays.some((d) => d.primary));
    dialog.showMessageBox = async () => assert.fail('no dialog may ask on the computer');
    const windows = BrowserWindow.getAllWindows().length;
    const started = await client.call('screenStart', { display: displays[0].id, control: true });
    assert.equal(started.control, false, 'no control without its permission');
    assert.deepEqual(started.iceServers, [], 'no STUN with AFINDER_ICE_LOCAL (otherwise always offered)');
    assert.equal((await js('window.api.companion.status()')).screen.device, 'Smoke phone', 'aFinder shows who is watching');
    assert.equal(BrowserWindow.getAllWindows().length, windows + 1, 'a hidden capture window runs');
    const capture = await until(() => BrowserWindow.getAllWindows().find((w) => /screen\.html$/.test(w.webContents.getURL())), 'The capture window does not load screen.html');
    await until(async () => !capture.webContents.isLoading() && (await capture.webContents.executeJavaScript('typeof window.screenApi')) === 'object', 'Capture window has no screenApi (preload not loaded)');
    await assert.rejects(client.call('screenStart', {}), /already viewing/);
    // A real receive-only offer, made by Chromium the way the phone makes it. Only where capturing is
    // already allowed: elsewhere it would put a macOS permission prompt in front of whoever runs this.
    // AFINDER_SMOKE_NO_CAPTURE=1 skips them too (a locked screen gives nothing to capture).
    const mayCapture = !process.env.AFINDER_SMOKE_NO_CAPTURE && (process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted');
    const offerer = new BrowserWindow({ show: false });
    await offerer.loadURL('about:blank');
    const offer = await offerer.webContents.executeJavaScript(`(async () => { const pc = new RTCPeerConnection(); pc.addTransceiver('video', { direction: 'recvonly' }); const o = await pc.createOffer(); await pc.setLocalDescription(o); return o.sdp })()`);
    offerer.destroy();
    assert.match(offer, /a=recvonly/);
    const answered = mayCapture ? (await client.call('screenSignal', { session: started.session, signal: { offer } })).sdp : null;
    if (answered) assert.match(answered, /m=video[\s\S]*a=sendonly/, 'the computer answers with a sending video track');
    else console.log('(no screen capture here: the answer is not checked)');
    let ended = null;
    const offScreen = client.onScreen((e) => e.end && (ended = e.end));
    await js('window.api.companion.stopScreen()');
    await until(() => ended === 'stopped', 'Phone was not told that sharing stopped');
    offScreen();
    assert.equal((await js('window.api.companion.status()')).screen, null);
    await until(() => BrowserWindow.getAllWindows().length === windows, 'Capture window was not closed');
    await assert.rejects(client.call('screenSignal', { session: started.session, signal: { ping: true } }), /already ended/);

    // Control is for other computers only: a phone never gets it.
    await js(`window.api.companion.setControl(${id}, true)`);
    await assert.rejects(client.call('clipboardRead', {}), /may not control/);
    {
      // A phone cannot use the computers' link (it would land in the wrong list) – and burns it.
      const wrong = phone.parsePairingUri((await js('window.api.companion.pair("computer")')).pairing.uri);
      await assert.rejects(phone.pair(wrong, phone.newKeyPair(), 'Phone in disguise', () => {}), /pairing-closed/);
    }
    // A computer's session, made the way aFinder on another computer makes it.
    const pcLink = phone.parsePairingUri((await js('window.api.companion.pair("computer")')).pairing.uri);
    const pcIdentity = phone.newKeyPair();
    const pcPaired = phone.pair(pcLink, pcIdentity, 'Smoke computer', () => {}, undefined, 'computer');
    await until(() => js('window.api.companion.status().then((s) => s.request?.kind === "computer")'), 'Computer pair request did not arrive');
    await js('window.api.companion.answer(true)');
    const pc = new phone.HostClient(await pcPaired, pcIdentity);
    await until(() => pc.state.kind === 'ready', 'Computer session did not start');
    const pcDevice = (await js('window.api.companion.status()')).devices.find((d) => d.name === 'Smoke computer');
    assert.equal(pcDevice.kind, 'computer');
    // Switching computers off refuses them, phones stay; switching back lets them in again.
    await js('window.api.setSettings({ computersEnabled: false })');
    await until(() => pc.state.kind === 'refused', 'Computers stayed connected after they were switched off');
    assert.equal(client.state.kind, 'ready', 'the phone stays');
    pc.close();
    await js('window.api.setSettings({ computersEnabled: true })');
    const ctl = new phone.HostClient(await pcPaired, pcIdentity);
    await until(() => ctl.state.kind === 'ready', 'Computer was not let in again');
    {
    const client = ctl;
    const id = JSON.stringify(pcDevice.id);
    await js(`window.api.companion.setScreen(${id}, true)`);
    // Control: its own permission (clipboard included), the input helper for the session, gone with it.
    await assert.rejects(client.call('clipboardRead', {}), /may not control/);
    await js(`window.api.companion.setControl(${id}, true)`);
    await client.call('clipboardWrite', { text: 'from afar' });
    assert.equal(await client.call('clipboardRead', {}), 'from afar');
    if (process.platform !== 'win32') {
      const controlled = await client.call('screenStart', { display: displays[0].id, control: true });
      assert.equal(controlled.control, true, controlled.controlError);
      assert.equal((await js('window.api.companion.status()')).screen.control, true, 'the banner says it is controlled');
      if (mayCapture) {
        // A viewer with an input channel, as aFinder's remote desktop window makes it.
        const viewer = new BrowserWindow({ show: false });
        await viewer.loadURL('about:blank');
        await viewer.webContents.executeJavaScript(`(async () => { window.pc = new RTCPeerConnection(); pc.addTransceiver('video', { direction: 'recvonly' }); window.ch = pc.createDataChannel('input'); ch.onmessage = (m) => (window.ready = m.data === 'ready'); const o = await pc.createOffer(); await pc.setLocalDescription(o); window.offer = o.sdp })()`);
        const sdp = (await client.call('screenSignal', { session: controlled.session, signal: { offer: await viewer.webContents.executeJavaScript('offer') } })).sdp;
        const offCandidates = client.onScreen((e) => e.candidate && viewer.webContents.executeJavaScript(`pc.addIceCandidate(${JSON.stringify(e.candidate)})`).catch(() => {}));
        await viewer.webContents.executeJavaScript(`pc.onicecandidate = (e) => e.candidate && (window.cands = [...(window.cands || []), e.candidate.toJSON()]); pc.setRemoteDescription({ type: 'answer', sdp: ${JSON.stringify(sdp)} })`);
        await until(async () => {
          for (const c of await viewer.webContents.executeJavaScript('(window.cands || []).splice(0)')) await client.call('screenSignal', { session: controlled.session, signal: { candidate: c } });
          return viewer.webContents.executeJavaScript('ch.readyState === "open" && window.ready');
        }, 'The input channel did not open (or the computer did not say it listens)');
        await viewer.webContents.executeJavaScript(`ch.send(JSON.stringify({ t: 'move', x: 0.5, y: 0.5 })); ch.send(JSON.stringify({ t: 'key', code: 'KeyA', key: 'á', d: true, m: 0 })); ch.send('{"t":"exec"}')`);
        await until(() => fs.existsSync(inputLog) && fs.readFileSync(inputLog, 'utf8').includes('"text"'), 'Input did not reach the helper');
        const lines = fs.readFileSync(inputLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.equal(lines[0].t, 'move');
        assert.deepEqual(lines[1], { t: 'text', s: 'á' });
        assert.equal(lines.length, 2, 'malformed events never reach the helper');
        offCandidates();
        viewer.destroy();
      } else console.log('(no screen capture here: the input channel is not checked)');
      // Taking control back ends the controlled session.
      await js(`window.api.companion.setControl(${id}, false)`);
      await until(async () => (await js('window.api.companion.status()')).screen === null, 'Revoking control did not end the session');
      await until(() => fs.existsSync(inputLog) && fs.readFileSync(inputLog, 'utf8').includes('"release"'), 'The helper was not told to let go');
    }
    ctl.close();
    }

    // Removing the phone on the computer ends its session and refuses it from then on.
    await js(`window.api.companion.remove(${JSON.stringify(status.devices[0].id)})`);
    await until(() => client.state.kind === 'refused', 'Removed phone was not refused');
    client.close();
    const stranger = new phone.HostClient(computer, phone.newKeyPair());
    await until(() => stranger.state.kind === 'refused' && stranger.state.reason === 'unknown-device', 'Unpaired phone was not refused');
    stranger.close();

    // aFinder on another computer: here aFinder pairs with itself through the relay, as a second one would.
    const second = (await js('window.api.companion.pair("computer")')).pairing.uri;
    const pairing = js(`window.api.remote.pairStart(${JSON.stringify(second)})`);
    const asking = await until(() => js('window.api.companion.status().then((s) => s.request)'), 'Computer pair request did not arrive');
    assert.equal((await pairing).sas, asking.sas, 'both computers show the same code');
    const accepted = js('window.api.remote.pairWait()');
    await js('window.api.companion.answer(true)');
    const connection = await accepted;
    assert.equal(connection.type, 'afinder');
    const remoteId = await js(`window.api.remote.save(${JSON.stringify(connection)}, {})`);
    const device = (await js('window.api.companion.status()')).devices.at(-1);
    // Watching would make macOS ask for Screen Recording where it is not allowed yet: then only the refusal is checked.
    if (mayCapture) await js(`window.api.companion.setScreen(${JSON.stringify(device.id)}, true)`);
    const mount = (await js('window.api.remote.list()')).find((m) => m.connection.id === remoteId);
    const mountRoot = await js(`window.api.list(${JSON.stringify(mount.path)})`);
    const home = mountRoot.entries.find((e) => e.name === path.basename(os.homedir()));
    assert.ok(home, `the other computer's places are the root: ${mountRoot.entries.map((e) => e.name)}`);
    assert.ok((await js(`window.api.list(${JSON.stringify(home.path)})`)).entries.length > 0, 'its home folder lists');
    await js(`window.api.remote.openDesktop(${JSON.stringify(remoteId)})`);
    const desktop = await until(() => BrowserWindow.getAllWindows().find((w) => /remote\.html$/.test(w.webContents.getURL())), 'The remote desktop window does not load remote.html');
    await until(async () => !desktop.webContents.isLoading() && (await desktop.webContents.executeJavaScript('typeof window.desktopApi')) === 'object', 'Remote desktop window has no desktopApi');
    if (mayCapture) {
      const shared = await until(async () => (await js('window.api.companion.status()')).screen, 'The remote desktop did not start a screen session');
      assert.equal(shared.device, device.name);
    } else await until(() => desktop.webContents.executeJavaScript('/may not view the screen/.test(document.body.innerText)'), 'The window does not say it may not view the screen');
    desktop.close();
    await until(async () => (await js('window.api.companion.status()')).screen === null, 'Closing the window did not end the session');
    console.log(`PASS (${relayUrl}): relay → pair with SAS → browse → download → resume → stat → read-only → upload → replace → conflict → rename → trash → move → screen permission/unattended/answer/stop → phone/computer kinds → control/clipboard/input/revoke → revoke → aFinder ↔ aFinder pairing/files/remote desktop`);
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    app.quit();
  }
});
