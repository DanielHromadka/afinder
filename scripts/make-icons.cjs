// Renders the SVG app icon to PNGs. Run with: npm run icons
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const squircle = 'x="100" y="100" width="824" height="824" rx="185"'
// Graphite tile, electric blue folder, white lens with a soft blue glow; stays legible at 16 px.
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3142"/><stop offset="1" stop-color="#0d1017"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".62" r=".55"><stop offset="0" stop-color="#3b82ff" stop-opacity=".45"/><stop offset="1" stop-color="#3b82ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f7dff"/><stop offset="1" stop-color="#1d46c9"/></linearGradient>
    <linearGradient id="front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc0ff"/><stop offset="1" stop-color="#2f6dff"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#000" flood-opacity=".55"/></filter>
  </defs>
  <rect ${squircle} fill="url(#bg)"/><rect ${squircle} fill="url(#glow)"/>
  <rect ${squircle} fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="4"/>
  <g filter="url(#shadow)">
    <path d="M262 320 H430 Q452 320 466 338 L492 372 H744 Q784 372 784 412 V700 H240 V342 Q240 320 262 320 Z" fill="url(#back)"/>
    <rect x="212" y="442" width="600" height="350" rx="46" fill="url(#front)"/>
    <path d="M258 442 H766 Q812 442 812 488 V500 H212 V488 Q212 442 258 442 Z" fill="#fff" fill-opacity=".28"/>
  </g>
  <g filter="url(#shadow)">
    <circle cx="560" cy="600" r="104" fill="#0d1017" fill-opacity=".25" stroke="#fff" stroke-width="34"/>
    <path d="M636 676 L736 776" stroke="#fff" stroke-width="44" stroke-linecap="round"/>
  </g>
</svg>`

async function render(win, size, file) {
  const html = `<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  fs.writeFileSync(file, image.resize({ width: size, height: size }).toPNG())
  console.log('wrote', file)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, transparent: true, frame: false,
    useContentSize: true, webPreferences: { offscreen: true }
  })
  win.webContents.setZoomFactor(1)
  const out = path.join(__dirname, '..', 'build')
  await render(win, 1024, path.join(out, 'icon.png'))
  await render(win, 64, path.join(out, 'drag.png'))
  app.exit(0)
})
