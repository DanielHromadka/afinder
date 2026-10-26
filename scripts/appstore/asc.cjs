// Minimal App Store Connect API client: node asc.cjs METHOD /v1/path [json-body]
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os')
const KEY = process.env.ASC_KEY_ID, ISSUER = process.env.ASC_ISSUER_ID
if (!KEY || !ISSUER) throw new Error('Set ASC_KEY_ID and ASC_ISSUER_ID (App Store Connect API key), see README.md')
const pem = fs.readFileSync(`${os.homedir()}/.appstoreconnect/private_keys/AuthKey_${KEY}.p8`, 'utf8')
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const head = b64({ alg: 'ES256', kid: KEY, typ: 'JWT' }) + '.' + b64({ iss: ISSUER, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' })
const sig = crypto.sign('sha256', Buffer.from(head), { key: pem, dsaEncoding: 'ieee-p1363' }).toString('base64url')
const [method, url, body] = process.argv.slice(2)
fetch('https://api.appstoreconnect.apple.com' + url, { method, headers: { Authorization: `Bearer ${head}.${sig}`, 'Content-Type': 'application/json' }, body })
  .then(async (r) => { const t = await r.text(); console.log(r.status); process.stdout.write(t ? JSON.stringify(JSON.parse(t), null, 1) : '') })
