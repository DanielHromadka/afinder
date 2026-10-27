# aFinder website

Static page, no build step: `index.html`, `style.css`, `site.js` and the WebP screenshots in `img/`. Cloudflare Pages
(project `afinder`, https://afinder.pages.dev) is connected to this repository and publishes this folder on every
push to `main`.

```bash
python3 -m http.server 8765 -d website    # http://localhost:8765/
```

## Downloads

`site.js` asks the GitHub API for the latest release of `DanielHromadka/afinder` and matches its assets
by pattern (macOS arm64 / x64 `.dmg`, Windows x64 / arm64 installer, Linux AppImage / `.deb` / `.rpm`). Versioned names
(`aFinder-0.1.0-arm64.dmg`) and the stable ones electron-builder now produces (`aFinder-arm64.dmg`) both match.

The visitor's system comes from the user agent; the architecture from `navigator.userAgentData` in Chromium and,
for Safari and Firefox on a Mac, from the WebGL renderer name (Macs default to Apple silicon). Phones and tablets
get the full list instead of a single button. Without the API (offline, rate limit) the buttons fall back to
`/releases/latest/download/<stable name>`.

## Screenshots

`scripts/screenshots.cjs` captures every image from the built app against a generated demo home (`/Users/alex`)
with a small git repository and a throwaway profile, so no personal files, host names or settings show up.
`scripts/optimize.sh` converts the raw PNGs into the WebP files the page loads (needs `cwebp`).

```bash
npm run build
npm i --no-save playwright@1.63.0
node website/scripts/screenshots.cjs          # all images, or a name prefix: hero, theme-
website/scripts/optimize.sh
```

## Design notes

One accent (the Luna title-bar blue), Geist and Geist Mono, light or dark with the system. Buttons and chips use a
10px radius, panels and screenshots 16px. Motion is limited to the hero entrance, scroll reveals, the theme
autoplay, the pinned developer story and the shortcut marquee, and all of it switches off under
`prefers-reduced-motion`. Fonts (Fontsource) and icons (Phosphor) load from jsDelivr and unpkg at pinned versions.
