// aFinder website v2: platform-aware downloads from the latest GitHub release, the theme picker, the
// pinned developer story, the shortcut marquee and scroll reveals. No scroll listeners: everything that
// reacts to scrolling uses IntersectionObserver.

document.documentElement.classList.add('js')
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

// ---- platform --------------------------------------------------------------------------------------

/** 'mac' | 'win' | 'linux' | null (phones, tablets, unknown). */
function detectOs() {
  const ua = navigator.userAgent
  const platform = navigator.userAgentData?.platform || navigator.platform || ''
  if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1)) return null
  if (/Mac/i.test(platform) || /Mac OS X/.test(ua)) return 'mac'
  if (/Win/i.test(platform) || /Windows/.test(ua)) return 'win'
  if (/Linux|X11/i.test(platform) || /Linux/.test(ua)) return 'linux'
  return null
}

/**
 * 'arm64' | 'x64'. Chromium tells the architecture outright; Safari and Firefox on a Mac only reveal it
 * through the GPU name. Macs default to Apple silicon, everything else to x64.
 */
async function detectArch(os) {
  try {
    const hints = await navigator.userAgentData?.getHighEntropyValues?.(['architecture'])
    if (hints?.architecture) return hints.architecture === 'arm' ? 'arm64' : 'x64'
  } catch {
    /* hints unavailable */
  }
  if (os === 'mac') {
    try {
      const gl = document.createElement('canvas').getContext('webgl')
      const info = gl?.getExtension('WEBGL_debug_renderer_info')
      const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
      if (/Intel|AMD|Radeon/i.test(renderer)) return 'x64'
    } catch {
      /* no WebGL */
    }
    return 'arm64'
  }
  return 'x64'
}

// ---- builds ----------------------------------------------------------------------------------------

const REPO = 'DanielHromadka/afinder-downloads'
const RELEASES = `https://github.com/${REPO}/releases`
const OS_NAME = { mac: 'macOS', win: 'Windows', linux: 'Linux' }
const OS_ICON = { mac: 'ph-apple-logo', win: 'ph-windows-logo', linux: 'ph-linux-logo' }

/**
 * Sets text with the product names kept out of browser translation: Chrome's Czech translation
 * turns "Windows" into "Okna" and "Finder" into a common noun.
 */
function setText(el, text) {
  el.replaceChildren(
    ...text.split(/(?<![\w])(Windows(?: XP| 98)?|Finder|Explorer)(?![\w])/).map((part, i) =>
      i % 2 ? Object.assign(document.createElement('span'), { textContent: part, translate: false }) : part
    )
  )
}

/**
 * Every build the release workflow can publish. Assets are matched by pattern, so both the stable names
 * (aFinder-arm64.dmg) and older versioned ones (aFinder-0.1.0-arm64.dmg) work; `stable` is the
 * /releases/latest/download/ name used when the GitHub API cannot be reached.
 */
const BUILDS = [
  { os: 'mac', arch: 'arm64', detail: 'Apple silicon', kind: '.dmg', match: /arm64\.dmg$/i, stable: 'aFinder-arm64.dmg' },
  { os: 'mac', arch: 'x64', detail: 'Intel', kind: '.dmg', match: /x64\.dmg$/i, stable: 'aFinder-x64.dmg' },
  { os: 'win', arch: 'x64', detail: 'x64', kind: 'Installer', match: /setup.*x64\.exe$/i, stable: 'aFinder-Setup-x64.exe' },
  { os: 'win', arch: 'arm64', detail: 'ARM64', kind: 'Installer', match: /setup.*arm64\.exe$/i },
  { os: 'linux', arch: 'x64', detail: 'x64', kind: 'AppImage', match: /(x86_64|x64)\.AppImage$/i },
  { os: 'linux', arch: 'arm64', detail: 'ARM64', kind: 'AppImage', match: /(arm64|aarch64)\.AppImage$/i },
  { os: 'linux', arch: 'x64', detail: 'x64', kind: '.deb', match: /(amd64|x64)\.deb$/i },
  { os: 'linux', arch: 'arm64', detail: 'ARM64', kind: '.deb', match: /arm64\.deb$/i },
  { os: 'linux', arch: 'x64', detail: 'x64', kind: '.rpm', match: /(x86_64|x64)\.rpm$/i },
  { os: 'linux', arch: 'arm64', detail: 'ARM64', kind: '.rpm', match: /(aarch64|arm64)\.rpm$/i }
]

const formatSize = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`

/** The latest release's builds with their URLs, or null when GitHub cannot be asked. */
async function latestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const release = await res.json()
    const assets = release.assets ?? []
    const builds = BUILDS.flatMap((b) => {
      const asset = assets.find((a) => b.match.test(a.name))
      return asset ? [{ ...b, url: asset.browser_download_url, size: asset.size }] : []
    })
    return { version: String(release.tag_name || '').replace(/^v/, ''), url: release.html_url, builds }
  } catch {
    return null
  }
}

/** Without the API: the builds the workflow always publishes, by their stable names. */
const fallbackBuilds = () => BUILDS.filter((b) => b.stable).map((b) => ({ ...b, url: `${RELEASES}/latest/download/${b.stable}` }))

function renderBuilds(builds, current) {
  const list = document.getElementById('build-list')
  list.replaceChildren()
  if (builds.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'build-empty'
    empty.innerHTML = `No installers in the latest release yet. <a href="${RELEASES}">See all releases</a>.`
    list.append(empty)
    return
  }
  const order = ['mac', 'win', 'linux']
  for (const b of [...builds].sort((x, y) => order.indexOf(x.os) - order.indexOf(y.os))) {
    const li = document.createElement('li')
    li.className = `build${b === current ? ' current' : ''}`
    const a = document.createElement('a')
    a.href = b.url
    a.innerHTML = `<i class="ph ${OS_ICON[b.os]}" aria-hidden="true"></i><span><span class="build-name"></span><span class="build-detail"></span></span>${b.size ? '<span class="build-size"></span>' : ''}`
    setText(a.querySelector('.build-name'), OS_NAME[b.os])
    a.querySelector('.build-detail').textContent = `${b.detail}, ${b.kind}`
    if (b.size) a.querySelector('.build-size').textContent = formatSize(b.size)
    li.append(a)
    list.append(li)
  }
  // Linux is listed even when the release has no Linux build, so Linux visitors know where they stand.
  if (!builds.some((b) => b.os === 'linux')) {
    const li = document.createElement('li')
    li.className = 'build-empty'
    li.innerHTML = '<i class="ph ph-linux-logo" aria-hidden="true"></i> Linux builds (AppImage, .deb and .rpm) are not in this release yet.'
    list.append(li)
  }
}

async function setupDownloads() {
  const os = detectOs()
  const [arch, release] = await Promise.all([detectArch(os), latestRelease()])
  const builds = release ? release.builds : fallbackBuilds()
  // The visitor's build: same system and architecture, else the same system, preferring installers.
  const current = builds.find((b) => b.os === os && b.arch === arch) ?? builds.find((b) => b.os === os) ?? null

  for (const btn of document.querySelectorAll('[data-download-primary]')) {
    btn.href = current ? current.url : '#download'
    setText(btn.querySelector('[data-download-text]'), current ? `Download for ${OS_NAME[current.os]}` : 'See all downloads')
  }
  const navBtn = document.querySelector('[data-download-label] span')
  if (navBtn && current) setText(navBtn, `Download for ${OS_NAME[current.os]}`)

  const meta = document.getElementById('download-meta')
  if (current) meta.textContent = `${current.detail}, ${current.kind}${current.size ? `, ${formatSize(current.size)}` : ''}${release?.version ? `. Version ${release.version}` : ''}`
  else if (os === null) meta.textContent = 'aFinder is a desktop app. Open this page on your Mac or PC to download it.'
  else setText(meta, `No ${OS_NAME[os]} build in the latest release yet.`)
  if (release?.url) document.getElementById('release-link').href = release.url
  document.getElementById('mac-hint').hidden = os !== 'mac'
  renderBuilds(builds, current)
  shortcuts(os === 'mac' || (os === null && /Mac/.test(navigator.platform)))
}

// ---- shortcuts -------------------------------------------------------------------------------------

const SHORTCUTS = [
  ['Command palette', ['⌘', 'K'], ['Ctrl', 'K']],
  ['Quick Look', ['Space'], ['Space']],
  ['Search in subfolders', ['⌥', '⌘', 'F'], ['Ctrl', 'Shift', 'F']],
  ['Split panes', ['⌘', '\\'], ['Ctrl', '\\']],
  ['Copy to other pane', ['F5'], ['F5']],
  ['Move to other pane', ['F6'], ['F6']],
  ['New tab', ['⌘', 'T'], ['Ctrl', 'T']],
  ['Preview pane', ['⇧', '⌘', 'P'], ['Alt', 'P']],
  ['Integrated terminal', ['⇧', '⌘', 'T'], ['Ctrl', 'Shift', 'T']],
  ['AI Agent panel', ['⌃', '`'], ['Ctrl', '`']],
  ['Rename', ['F2'], ['F2']],
  ['Copy path', ['⌥', '⌘', 'C'], ['Ctrl', 'Shift', 'C']],
  ['Show hidden files', ['⇧', '⌘', '.'], ['Ctrl', 'H']],
  ['Duplicate', ['⌘', 'D'], ['Ctrl', 'D']]
]

function shortcuts(mac) {
  const track = document.getElementById('shortcuts')
  const item = ([label, macKeys, otherKeys], hidden) => {
    const li = document.createElement('li')
    if (hidden) li.setAttribute('aria-hidden', 'true')
    for (const key of mac ? macKeys : otherKeys) {
      const kbd = document.createElement('kbd')
      kbd.textContent = key
      li.append(kbd)
    }
    const span = document.createElement('span')
    span.textContent = label
    li.append(span)
    return li
  }
  // The list twice, so the loop is seamless; the copy is hidden from screen readers.
  track.replaceChildren(...SHORTCUTS.map((s) => item(s, false)), ...SHORTCUTS.map((s) => item(s, true)))
  if (!mac) for (const kbd of document.querySelectorAll('kbd[data-key="mod"]')) kbd.textContent = 'Ctrl'
}

// ---- themes ----------------------------------------------------------------------------------------

const NOTES = {
  apple: 'Flat, airy and set in SF, light or dark with the system.',
  xp: 'Luna blue title bar, beige window face and Tahoma.',
  classic: 'Grey bevels, a navy title bar and small type, as on Windows 98.',
  dos: 'Norton Commander blue, VGA colours and double-line frames.',
  matrix: 'Green phosphor on black, with digital rain behind the window.',
  jarvis: 'A heads-up display: blueprint grid, letter-spaced labels and corner brackets.',
  cyberpunk: 'Neon yellow chrome, magenta selection and monospaced type.',
  fbi: 'Navy and gold, with a case-file status bar and a classification banner.',
  batman: 'Black and signal yellow, reporting to the Batcomputer.',
  bitcoin: 'Bitcoin orange on black, with the status bar counting blocks.',
  barbie: 'Pink, all the way through.'
}

function setupThemes() {
  const section = document.getElementById('themes')
  const tabs = [...section.querySelectorAll('[role="tab"]')]
  const shot = document.getElementById('theme-shot')
  const note = document.getElementById('theme-note')
  let autoplay = !reduceMotion
  let timer = 0

  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
    }
    if (focus) tab.focus()
    const id = tab.dataset.theme
    const next = new Image()
    next.srcset = `img/theme-${id}-1280.webp 1280w, img/theme-${id}.webp 2400w`
    next.sizes = shot.sizes
    shot.classList.add('swapping')
    const swap = () => {
      shot.srcset = next.srcset
      shot.src = `img/theme-${id}.webp`
      shot.alt = `aFinder in the ${tab.textContent} theme`
      setText(note, NOTES[id])
      shot.classList.remove('swapping')
    }
    next.decode().then(swap, swap)
  }

  const schedule = () => {
    clearTimeout(timer)
    section.classList.remove('autoplay')
    if (!autoplay || document.hidden || section.matches(':hover, :focus-within') || !section.classList.contains('visible')) return
    void section.offsetWidth // restart the progress bar
    section.classList.add('autoplay')
    timer = setTimeout(() => {
      const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')
      select(tabs[(i + 1) % tabs.length], false)
      schedule()
    }, 5000)
  }
  const stop = () => {
    autoplay = false
    schedule()
  }

  tabs.forEach((tab, i) => {
    tab.tabIndex = i === 0 ? 0 : -1
    tab.addEventListener('click', () => (stop(), select(tab, false)))
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
      const target = step ? tabs[(i + step + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : null
      if (!target) return
      e.preventDefault()
      stop()
      select(target, true)
    })
  })
  for (const type of ['mouseenter', 'mouseleave', 'focusin']) section.addEventListener(type, schedule)
  section.addEventListener('focusout', () => setTimeout(schedule))
  document.addEventListener('visibilitychange', schedule)
  // Autoplay only while the section is on screen.
  new IntersectionObserver(([entry]) => {
    section.classList.toggle('visible', entry.isIntersecting)
    schedule()
  }, { threshold: 0.35 }).observe(section)

  // Warm the cache once the page is idle, so switching themes is instant.
  const preload = () => tabs.forEach((t) => (new Image().srcset = `img/theme-${t.dataset.theme}-1280.webp 1280w, img/theme-${t.dataset.theme}.webp 2400w`))
  if ('requestIdleCallback' in window) requestIdleCallback(preload)
  else setTimeout(preload, 2500)
}

// ---- developer story -------------------------------------------------------------------------------

function setupStory() {
  const steps = [...document.querySelectorAll('.step')]
  const shots = [...document.querySelectorAll('.story-stage img')]
  const activate = (step) => {
    for (const s of steps) s.classList.toggle('active', s === step)
    const index = Number(step.dataset.shot)
    shots.forEach((img, i) => img.classList.toggle('active', i === index))
  }
  activate(steps[0])
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) activate(entry.target)
    },
    { rootMargin: '-45% 0px -45% 0px' }
  )
  steps.forEach((s) => observer.observe(s))
}

// ---- reveals and the navigation border ---------------------------------------------------------------

function setupReveals() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('in')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -12% 0px' }
  )
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))

  // The nav gets its hairline once the hero's top edge has scrolled away.
  const nav = document.querySelector('.nav')
  new IntersectionObserver(([entry]) => nav.classList.toggle('scrolled', !entry.isIntersecting)).observe(document.querySelector('.hero h1'))
}

setupReveals()
setupThemes()
setupStory()
shortcuts(detectOs() === 'mac')
setupDownloads()
