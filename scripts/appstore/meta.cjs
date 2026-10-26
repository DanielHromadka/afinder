// Run from anywhere; see README.md.
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os')
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
  if (!r.ok) console.log('ERR', method, url, r.status, JSON.stringify(j.errors?.map((e) => e.detail)))
  return j
}
const SUPPORT = 'https://afinder.pages.dev/support', PRIVACY = 'https://afinder.pages.dev/privacy', SITE = 'https://afinder.pages.dev/'
const MAC = {
  app: '6822790856', version: 'efbbd77b-fe2b-4b23-a441-c6f214842187', info: 'beb0369a-440b-47bc-8700-ea258896bccb', primary: 'UTILITIES', secondary: 'PRODUCTIVITY',
  'en-US': {
    subtitle: 'Explorer-style file manager',
    promotionalText: 'Tabs, split panes, git and Claude Code beside your files. In a modern macOS look, Windows XP or nine other themes.',
    keywords: 'file manager,explorer,dual pane,commander,sftp,s3,git,terminal,archive,zip,batch rename,preview',
    description: `aFinder is a fast, keyboard-driven file manager. Explorer as you remember it, built for how you work now.

FILES
• Tabs and up to four panes, split side by side or stacked
• Details, list and icon views, grouping, quick filter and fuzzy search
• Recursive search, folder sizes and a disk map
• Copy, move and rename with progress, undo and conflict handling
• Batch rename with patterns, counters and regular expressions
• Open ZIP, TAR, 7z and other archives like folders

PREVIEW AND EDIT
• Preview images, video, audio, PDF, Office documents and code
• Edit text and code with the editor from VS Code

REMOTE
• SFTP, Amazon S3 and compatible storage, SharePoint and OneDrive in the same window

FOR DEVELOPERS
• Git status in the file list, diff, history graph, blame, commit, push and pull
• Integrated terminal tabs, Claude Code and Codex beside your files
• Automations and scripts, a local MCP server for AI assistants

AND MORE
• Command palette, customisable shortcuts and a guided tour
• Tools: calculator, unit converter, checksums, duplicates, image conversion, regex tester and more
• Pair your iPhone with aFinder Remote to reach your files and see your screen from anywhere
• Eleven themes, from modern macOS to Windows XP and DOS

PRIVACY
No account, no analytics, no tracking. AI features run on your Mac and are off until you turn them on.

The App Store version runs in the macOS sandbox: at the first start, allow it to access your disk once and it works like the full version.`
  },
  cs: {
    subtitle: 'Správce souborů s panely',
    promotionalText: 'Panely, rozdělené okno, git a Claude Code vedle vašich souborů. V moderním vzhledu macOS, Windows XP nebo devíti dalších.',
    keywords: 'správce souborů,průzkumník,dva panely,commander,sftp,s3,git,terminál,archiv,zip,přejmenování,náhled',
    description: `aFinder je rychlý správce souborů ovládaný z klávesnice. Průzkumník, jak si ho pamatujete, postavený pro dnešní práci.

SOUBORY
• Záložky a až čtyři panely vedle sebe nebo pod sebou
• Zobrazení podrobností, seznamu a ikon, seskupování, rychlý filtr a přibližné hledání
• Hledání v podsložkách, velikosti složek a mapa disku
• Kopírování, přesun a přejmenování s průběhem, vrácením zpět a řešením konfliktů
• Hromadné přejmenování podle vzorů, čítačů a regulárních výrazů
• Archivy ZIP, TAR, 7z a další otevřete jako složky

NÁHLED A ÚPRAVY
• Náhled obrázků, videa, zvuku, PDF, dokumentů Office a kódu
• Úpravy textu a kódu v editoru z VS Code

VZDÁLENĚ
• SFTP, Amazon S3 a kompatibilní úložiště, SharePoint a OneDrive ve stejném okně

PRO VÝVOJÁŘE
• Stav gitu v seznamu souborů, rozdíly, graf historie, blame, commit, push a pull
• Integrovaný terminál, Claude Code a Codex vedle souborů
• Automatizace a skripty, lokální MCP server pro AI asistenty

A DALŠÍ
• Paleta příkazů, vlastní klávesové zkratky a průvodce
• Nástroje: kalkulačka, převod jednotek, kontrolní součty, duplicity, převod obrázků, test regulárních výrazů a další
• Spárujte iPhone s aplikací aFinder Remote a máte soubory i obrazovku počítače kdekoli
• Jedenáct vzhledů od moderního macOS po Windows XP a DOS

SOUKROMÍ
Žádný účet, žádná analytika, žádné sledování. AI funkce běží na vašem Macu a jsou vypnuté, dokud je nezapnete.

Verze z App Storu běží v izolovaném prostoru macOS: při prvním spuštění jí jednou povolte přístup k disku a funguje jako plná verze.`
  }
}
const IOS = {
  app: '6822766571', version: 'c6c512d6-307d-4272-851b-08c60e4c732f', info: '220e0c9f-2e08-459e-b808-30e8d2012e41', primary: 'UTILITIES', secondary: 'PRODUCTIVITY',
  'en-US': {
    subtitle: 'Files from your computer',
    promotionalText: 'Browse, open and share the files on your computer, keep them offline and watch its screen. End-to-end encrypted.',
    keywords: 'remote files,file browser,companion,pc,mac,windows,screen viewer,offline files,transfer,upload',
    description: `aFinder Remote is the companion app for aFinder, the file manager for macOS, Windows and Linux. Pair it once and your computer's files are in your pocket, wherever you are.

• Browse every folder on your computer, with thumbnails
• Open any file with one tap, or share it to another app
• Keep files offline and edit text files; changes go back to the computer
• Upload photos and files from your phone
• Rename, create folders and move things to the trash
• Watch your computer's screen live, zoom in with two fingers
• Works over Wi-Fi or mobile data; the devices do not need to be on the same network

SECURE BY DESIGN
Pairing uses a QR code and a short code you compare on both devices. Everything between the phone and the computer is end-to-end encrypted. The computer decides what each phone may do, and screen viewing must be allowed for each phone and confirmed on the computer every time.

REQUIRES
aFinder on your computer (free at afinder.pages.dev) with the phone companion turned on in Settings → Phone.`
  },
  cs: {
    subtitle: 'Soubory z vašeho počítače',
    promotionalText: 'Procházejte, otevírejte a sdílejte soubory z počítače, mějte je offline a sledujte jeho obrazovku. Šifrováno end-to-end.',
    keywords: 'vzdálené soubory,prohlížeč souborů,počítač,pc,mac,windows,obrazovka,offline,přenos,nahrání',
    description: `aFinder Remote je společník aplikace aFinder, správce souborů pro macOS, Windows a Linux. Spárujte ho jednou a soubory z počítače máte v kapse, ať jste kdekoli.

• Procházejte všechny složky v počítači, s náhledy
• Otevřete jakýkoli soubor jedním ťuknutím nebo ho sdílejte do jiné aplikace
• Mějte soubory offline a upravujte textové soubory, změny se vrátí do počítače
• Nahrávejte fotky a soubory z telefonu
• Přejmenujte, vytvořte složku nebo přesuňte do koše
• Sledujte obrazovku počítače živě a přibližujte ji dvěma prsty
• Funguje přes Wi‑Fi i mobilní data, zařízení nemusí být ve stejné síti

BEZPEČNÉ
Párování probíhá přes QR kód a krátký kód, který porovnáte na obou zařízeních. Vše mezi telefonem a počítačem je šifrované end-to-end. Počítač určuje, co který telefon smí, a sledování obrazovky se povoluje pro každý telefon zvlášť a pokaždé potvrzuje na počítači.

POTŘEBUJETE
aFinder v počítači (zdarma na afinder.pages.dev) se zapnutým telefonem v Nastavení → Telefon.`
  }
}
async function run(cfg, name) {
  await api('PATCH', `/v1/appInfos/${cfg.info}`, { type: 'appInfos', id: cfg.info, relationships: { primaryCategory: { data: { type: 'appCategories', id: cfg.primary } }, secondaryCategory: { data: { type: 'appCategories', id: cfg.secondary } } } })
  await api('PATCH', `/v1/appStoreVersions/${cfg.version}`, { type: 'appStoreVersions', id: cfg.version, attributes: { copyright: '2026 Daniel Hromádka' } })
  const infoLocs = (await api('GET', `/v1/appInfos/${cfg.info}/appInfoLocalizations`)).data
  const verLocs = (await api('GET', `/v1/appStoreVersions/${cfg.version}/appStoreVersionLocalizations`)).data
  for (const locale of ['en-US', 'cs']) {
    const t = cfg[locale]
    const infoAttrs = { subtitle: t.subtitle, privacyPolicyUrl: PRIVACY, ...(locale === 'cs' ? { name } : {}) }
    const il = infoLocs.find((l) => l.attributes.locale === locale)
    if (il) await api('PATCH', `/v1/appInfoLocalizations/${il.id}`, { type: 'appInfoLocalizations', id: il.id, attributes: infoAttrs })
    else await api('POST', '/v1/appInfoLocalizations', { type: 'appInfoLocalizations', attributes: { locale, ...infoAttrs }, relationships: { appInfo: { data: { type: 'appInfos', id: cfg.info } } } })
    const verAttrs = { description: t.description, keywords: t.keywords, promotionalText: t.promotionalText, supportUrl: SUPPORT, marketingUrl: SITE }
    const vl = verLocs.find((l) => l.attributes.locale === locale)
    if (vl) await api('PATCH', `/v1/appStoreVersionLocalizations/${vl.id}`, { type: 'appStoreVersionLocalizations', id: vl.id, attributes: verAttrs })
    else await api('POST', '/v1/appStoreVersionLocalizations', { type: 'appStoreVersionLocalizations', attributes: { locale, ...verAttrs }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: cfg.version } } } })
    console.log(name, locale, 'done', t.subtitle.length, t.keywords.length, t.promotionalText.length)
  }
}
run(MAC, 'aFinder File Manager').then(() => run(IOS, 'aFinder Remote'))
