// node shots.cjs <versionLocalizationId> <displayType> <dir>
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const KEY = process.env.ASC_KEY_ID, ISSUER = process.env.ASC_ISSUER_ID
if (!KEY || !ISSUER) throw new Error('Set ASC_KEY_ID and ASC_ISSUER_ID (App Store Connect API key), see README.md')
const pem = fs.readFileSync(`${os.homedir()}/.appstoreconnect/private_keys/AuthKey_${KEY}.p8`, 'utf8')
function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'ES256', kid: KEY, typ: 'JWT' }) + '.' + b64({ iss: ISSUER, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' })
  return head + '.' + crypto.sign('sha256', Buffer.from(head), { key: pem, dsaEncoding: 'ieee-p1363' }).toString('base64url')
}
async function api(method, url, data) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + url, { method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify({ data }) : undefined })
  const j = r.status === 204 ? {} : await r.json()
  if (!r.ok) throw new Error(`${method} ${url} ${r.status} ${JSON.stringify(j.errors?.map((e) => e.detail))}`)
  return j
}
const [loc, type, dir] = process.argv.slice(2)
;(async () => {
  const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc}/appScreenshotSets`)).data
  let set = sets.find((s) => s.attributes.screenshotDisplayType === type)
  if (set) for (const s of (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots`)).data) await api('DELETE', `/v1/appScreenshots/${s.id}`)
  else set = (await api('POST', '/v1/appScreenshotSets', { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc } } } })).data
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
    const buf = fs.readFileSync(path.join(dir, f))
    const shot = (await api('POST', '/v1/appScreenshots', { type: 'appScreenshots', attributes: { fileName: f, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } })).data
    for (const op of shot.attributes.uploadOperations) {
      const r = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])), body: buf.subarray(op.offset, op.offset + op.length) })
      if (!r.ok) throw new Error(`upload ${f} ${r.status}`)
    }
    await api('PATCH', `/v1/appScreenshots/${shot.id}`, { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(buf).digest('hex') } })
    console.log('uploaded', f)
  }
})().catch((e) => { console.error(e.message); process.exit(1) })
