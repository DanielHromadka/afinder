// Run with Electron after `npm run build`. Opens the built aFinder with the Docker area next to the file list,
// pointed (AFINDER_DOCKER_HOST) at a fake Docker Engine API on a unix socket, and drives it: the engine line,
// containers grouped by compose project with live usage, live logs (framed stdout and stderr, a line arriving
// later), stats, inspect with hidden env values, stopping a container (the list follows the engine's events),
// images, a prune with its confirmation, and the "not running" state once the engine goes away.
// AFINDER_SMOKE_ARTIFACTS=<dir> also saves screenshots.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
// Short: unix socket paths are limited to about 100 bytes.
const directory = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'afd-'))
const socket = path.join(directory, 'docker.sock')
const project = path.join(directory, 'shop')
fs.mkdirSync(project)

// ---- the fake engine ---------------------------------------------------------------------------

const calls = []
const eventStreams = new Set()
const labels = (service) => ({
  'com.docker.compose.project': 'shop',
  'com.docker.compose.service': service,
  'com.docker.compose.project.working_dir': project,
  'com.docker.compose.project.config_files': path.join(project, 'compose.yaml')
})
const containers = [
  { Id: 'a'.repeat(64), Names: ['/shop-web-1'], Image: 'nginx:alpine', ImageID: 'sha256:' + '1'.repeat(64), State: 'running', Status: 'Up 2 hours', Created: 1700000000, Ports: [{ PrivatePort: 80, PublicPort: 8080, IP: '0.0.0.0', Type: 'tcp' }, { PrivatePort: 80, PublicPort: 8080, IP: '::', Type: 'tcp' }], Labels: labels('web'), Mounts: [{ Type: 'volume', Name: 'shop_data' }], NetworkSettings: { Networks: { shop_default: {} } } },
  { Id: 'b'.repeat(64), Names: ['/shop-db-1'], Image: 'postgres:16', ImageID: 'sha256:' + '2'.repeat(64), State: 'running', Status: 'Up 2 hours (healthy)', Created: 1700000000, Ports: [{ PrivatePort: 5432, Type: 'tcp' }], Labels: labels('db'), Mounts: [], NetworkSettings: { Networks: { shop_default: {} } } },
  { Id: 'c'.repeat(64), Names: ['/scratch'], Image: 'alpine', ImageID: 'sha256:' + '3'.repeat(64), State: 'exited', Status: 'Exited (0) 3 days ago', Created: 1690000000, Ports: [], Labels: {}, Mounts: [], NetworkSettings: { Networks: { bridge: {} } } }
]
const find = (ref) => containers.find((c) => c.Id === ref || c.Id.startsWith(ref) || c.Names[0] === `/${ref}`)
let cpuTotal = 1e9
const stats = () => {
  cpuTotal += 2e8
  return {
    read: new Date().toISOString(),
    pids_stats: { current: 7 },
    cpu_stats: { cpu_usage: { total_usage: cpuTotal }, system_cpu_usage: cpuTotal * 10, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: cpuTotal - 2e8 }, system_cpu_usage: (cpuTotal - 2e8) * 10 },
    memory_stats: { usage: 64 * 1024 * 1024, limit: 1024 * 1024 * 1024, stats: { inactive_file: 4 * 1024 * 1024 } },
    networks: { eth0: { rx_bytes: cpuTotal / 1000, tx_bytes: cpuTotal / 2000 } },
    blkio_stats: { io_service_bytes_recursive: [{ op: 'read', value: 1000 }, { op: 'write', value: 2000 }] }
  }
}
const frame = (stream, text) => {
  const body = Buffer.from(text)
  const head = Buffer.alloc(8)
  head[0] = stream
  head.writeUInt32BE(body.length, 4)
  return Buffer.concat([head, body])
}
const event = (action, id) => {
  for (const res of eventStreams) res.write(JSON.stringify({ Type: 'container', Action: action, Actor: { ID: id } }) + '\n')
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://docker')
  const p = url.pathname.replace(/^\/v[\d.]+/, '')
  calls.push(`${req.method} ${p}`)
  const json = (body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  let m
  if (p === '/_ping') return res.end('OK')
  if (p === '/version') return json({ Version: '27.0.0-fake', Os: 'linux' })
  if (p === '/info') return json({ Name: 'fake', OperatingSystem: 'Fake Engine', NCPU: 4, MemTotal: 8 * 1024 ** 3, Containers: containers.length, ContainersRunning: containers.filter((c) => c.State === 'running').length, Images: 3 })
  if (p === '/containers/json') return json(url.searchParams.get('all') === 'true' ? containers : containers.filter((c) => c.State === 'running'))
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.flushHeaders()
    eventStreams.add(res)
    req.on('close', () => eventStreams.delete(res))
    return
  }
  if ((m = /^\/containers\/([^/]+)\/json$/.exec(p))) {
    const c = find(m[1])
    if (!c) return json({ message: 'No such container' }, 404)
    return json({
      Id: c.Id,
      Name: c.Names[0],
      Path: 'nginx',
      Args: ['-g', 'daemon off;'],
      Created: '2026-01-01T10:00:00Z',
      State: { Running: c.State === 'running', StartedAt: '2026-01-01T10:00:01Z', FinishedAt: '0001-01-01T00:00:00Z', ExitCode: 0 },
      Config: { Image: c.Image, Env: ['SECRET_TOKEN=hunter2', 'PATH=/usr/bin'], Labels: c.Labels, Tty: false },
      HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
      Mounts: [{ Type: 'bind', Source: project, Destination: '/usr/share/nginx/html', RW: false }],
      NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] }, Networks: { shop_default: { IPAddress: '172.18.0.2', Gateway: '172.18.0.1', MacAddress: '02:42:ac:12:00:02' } } }
    })
  }
  if ((m = /^\/containers\/([^/]+)\/logs$/.exec(p))) {
    res.writeHead(200, { 'Content-Type': 'application/vnd.docker.raw-stream' })
    res.write(Buffer.concat([frame(1, 'hello from web\nsecond '), frame(1, 'line\n')]))
    const later = setTimeout(() => res.write(frame(2, 'later line on stderr\n')), 600)
    req.on('close', () => clearTimeout(later))
    return
  }
  if ((m = /^\/containers\/([^/]+)\/stats$/.exec(p))) {
    if (url.searchParams.get('stream') === 'false') return json(stats())
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write(JSON.stringify(stats()) + '\n')
    const timer = setInterval(() => res.write(JSON.stringify(stats()) + '\n'), 300)
    req.on('close', () => clearInterval(timer))
    return
  }
  if ((m = /^\/containers\/([^/]+)\/(stop|start|restart|kill|pause|unpause)$/.exec(p)) && req.method === 'POST') {
    const c = find(m[1])
    if (!c) return json({ message: 'No such container' }, 404)
    c.State = m[2] === 'stop' || m[2] === 'kill' ? 'exited' : m[2] === 'pause' ? 'paused' : 'running'
    c.Status = c.State === 'exited' ? 'Exited (0) 1 second ago' : 'Up 1 second'
    event(m[2], c.Id)
    res.writeHead(204)
    return res.end()
  }
  if (p === '/images/json') return json([{ Id: 'sha256:' + '1'.repeat(64), RepoTags: ['nginx:alpine'], Size: 50e6, Created: 1700000000 }, { Id: 'sha256:' + '9'.repeat(64), RepoTags: ['<none>:<none>'], Size: 10e6, Created: 1600000000 }])
  if (p === '/volumes') return json({ Volumes: [{ Name: 'shop_data', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/shop_data' }] })
  if (p === '/networks') return json([{ Id: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' }, { Id: 'n2', Name: 'shop_default', Driver: 'bridge', Scope: 'local' }])
  if (p === '/system/df') return json({ Images: [{ Size: 50e6, Containers: 1 }, { Size: 10e6, Containers: 0 }], Containers: [{ SizeRw: 1e6, State: 'exited' }], Volumes: [{ UsageData: { Size: 3e6, RefCount: 1 } }], BuildCache: [] })
  if (p === '/containers/prune' && req.method === 'POST') return json({ SpaceReclaimed: 1e6 })
  json({ message: `fake engine: ${req.method} ${p}` }, 404)
})

// ---- the app -----------------------------------------------------------------------------------

const userData = path.join(directory, 'userData')
fs.mkdirSync(userData)
const workspace = { id: 'docker', name: 'Docker', paneAxis: 'row', panes: 1, root: { split: 'row', ratio: 0.3, a: { editor: 'files' }, b: { editor: 'docker' } } }
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ language: 'en', theme: process.env.AFINDER_SMOKE_THEME ?? 'xp', autoUpdate: false, tourOffered: true, lastPath: directory, workspaces: [workspace], activeWorkspace: 'docker' })
)
app.setPath('userData', userData)
process.env.AFINDER_DOCKER_HOST = `unix://${socket}`

let exitCode = 0
app.once('will-quit', () => {
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(exitCode)
})

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

server.listen(socket, () => {
  require(path.resolve(root, 'out/main/index.js'))
  app.whenReady().then(async () => {
    try {
      const win = await until(async () => {
        const w = BrowserWindow.getAllWindows()[0]
        return w && !w.webContents.isLoading() && (await w.webContents.executeJavaScript('!!document.querySelector(".tool.docker")')) ? w : false
      }, 'Docker area did not render')
      win.setSize(1400, 900)
      const js = (code) => win.webContents.executeJavaScript(code)
      const text = (selector) => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)
      const click = (selector, label) =>
        js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
      const shot = async (name) => {
        if (!process.env.AFINDER_SMOKE_ARTIFACTS) return
        await sleep(300)
        fs.mkdirSync(process.env.AFINDER_SMOKE_ARTIFACTS, { recursive: true })
        fs.writeFileSync(path.join(process.env.AFINDER_SMOKE_ARTIFACTS, `docker-${name}.png`), (await win.webContents.capturePage()).toPNG())
      }

      // The engine line and the containers, grouped: the compose project first, the loose container last.
      await until(async () => /Docker 27\.0\.0-fake/.test(await text('.docker-engine')), 'Engine line missing')
      await until(() => js(`document.querySelectorAll('.docker-list .row').length === 3`), 'Containers did not list')
      assert.deepEqual(await js(`[...document.querySelectorAll('.docker-group strong')].map((s) => s.textContent)`), ['shop', 'Standalone containers'])
      assert.match(await text('.docker-list'), /8080→80/)
      await until(() => js(`document.querySelectorAll('.docker-list .sys-load.cpu .sys-mini').length === 2`), 'Live usage did not show for the running containers')
      await shot('containers')

      // Live logs: framed stdout split across frames, then a stderr line that arrives later.
      await js(`[...document.querySelectorAll('.docker-list .row')].find((r) => r.textContent.includes('web')).click()`)
      await until(async () => /hello from web/.test(await text('.docker-log')) && /second line/.test(await text('.docker-log')), 'Logs did not stream')
      await until(() => js(`document.querySelector('.docker-log .err')?.textContent === 'later line on stderr'`), 'The later stderr line did not arrive')
      await shot('logs')

      // Stats from the stream, then inspect with the env values hidden until asked.
      await click('.docker-detail [role=tab]', 'Stats')
      await until(() => js(`document.querySelectorAll('.docker-stats .sys-graph polyline').length >= 2`), 'Stats graphs did not draw')
      await shot('stats')
      await click('.docker-detail [role=tab]', 'Details')
      await until(async () => /unless-stopped/.test(await text('.docker-inspect')), 'Inspect did not load')
      const inspect = await text('.docker-inspect')
      assert.match(inspect, /SECRET_TOKEN/)
      assert.doesNotMatch(inspect, /hunter2/)
      await click('.docker-inspect button', 'Show values')
      assert.match(await text('.docker-inspect'), /hunter2/)
      await shot('inspect')

      // Stop: the engine gets the call and its event makes the list follow.
      assert.ok(await click('.docker-actions button', 'Stop'), 'No Stop button')
      await until(() => calls.includes(`POST /containers/${'a'.repeat(64)}/stop`), 'Stop did not reach the engine')
      await until(() => js(`!![...document.querySelectorAll('.docker-list .row')].find((r) => r.textContent.includes('web'))?.querySelector('.docker-dot.exited')`), 'The list did not follow the stop')

      // Images, then a prune behind its confirmation.
      await click('.docker-bar [role=tab]', 'Images')
      await until(async () => /nginx:alpine/.test(await text('.docker-list')) && /<untagged>/.test(await text('.docker-list')), 'Images did not list')
      await shot('images')
      await click('.docker-bar [role=tab]', 'Clean-up')
      await until(async () => /Stopped containers/.test(await text('.docker-df')), 'Disk usage did not load')
      await js(`document.querySelector('.docker-df .row button').click()`)
      await until(() => js(`!!document.querySelector('.sys-confirm')`), 'The prune asked nothing')
      assert.ok(!calls.includes('POST /containers/prune'), 'Pruned before the confirmation')
      await click('.sys-confirm button', 'Clean up')
      await until(async () => calls.includes('POST /containers/prune') && /Freed/.test(await text('.tool.docker')), 'The prune did not run')
      await shot('cleanup')

      // The engine goes away: the event stream ends and the area says so.
      for (const res of eventStreams) res.destroy()
      server.close()
      server.closeAllConnections?.()
      fs.rmSync(socket, { force: true })
      await until(() => js(`!!document.querySelector('.docker-empty')`), 'The area did not notice the engine stopped', 20000)
      assert.match(await text('.docker-engine'), /not running|not installed/)
      await shot('stopped')
      console.log('PASS: engine → containers by project → live usage → logs (stdout, later stderr) → stats → inspect (hidden env) → stop via events → images → prune after confirm → engine gone')
    } catch (err) {
      console.error(err)
      exitCode = 1
    } finally {
      server.close()
      app.quit()
    }
  })
})
