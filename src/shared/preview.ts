// What the preview pane can show for a file, and how the renderer fetches its bytes.
// Shared: main serves files by MIME type, the renderer picks a viewer and an editor language.

export type PreviewKind =
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'text'
  | 'docx'
  | 'sheet'
  /** 3D model rendered with three.js. */
  | 'model'
  /** Anything else: a system thumbnail (Quick Look / Explorer) where the OS offers one. */
  | 'thumbnail'

/** Custom protocol that serves local files to the renderer (with HTTP range support for media). */
export const PREVIEW_SCHEME = 'afinder-file'

/** The whole path is one encoded segment, so Windows paths and odd characters survive URL parsing. */
export function previewUrl(path: string): string {
  return `${PREVIEW_SCHEME}://file/${encodeURIComponent(path)}`
}

export function pathFromPreviewUrl(url: string): string | null {
  const prefix = `${PREVIEW_SCHEME}://file/`
  if (!url.startsWith(prefix)) return null
  try {
    return decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0])
  } catch {
    return null
  }
}

const MIME: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg'
}

/** Monaco language ids by extension. Only grammars bundled with monaco-editor's basic languages. */
const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'javascript', // no JSON grammar without the JSON worker – the JS one reads it fine
  jsonc: 'javascript',
  json5: 'javascript',
  map: 'javascript',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'html',
  svelte: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  swift: 'swift',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  m: 'objective-c',
  mm: 'objective-c',
  cs: 'csharp',
  fs: 'fsharp',
  vb: 'vb',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  lua: 'lua',
  r: 'r',
  jl: 'julia',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  clj: 'clojure',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  env: 'ini',
  xml: 'xml',
  plist: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  csproj: 'xml',
  tf: 'hcl',
  hcl: 'hcl',
  sol: 'solidity',
  pug: 'pug',
  twig: 'twig',
  hbs: 'handlebars',
  liquid: 'liquid',
  rst: 'restructuredtext',
  tex: 'plaintext',
  dockerfile: 'dockerfile'
}

/** 3D formats the model viewer reads (.gltf only resolves its side files for local paths). */
const MODELS = new Set(['glb', 'gltf', 'stl', 'obj', 'ply', '3mf'])

/** Larger models are parsed whole in the renderer – past this the OS thumbnail is shown instead. */
export const MAX_MODEL_BYTES = 50 * 1024 * 1024

/** Plain-text formats without a grammar. */
const PLAIN = new Set(['txt', 'text', 'log', 'csv', 'tsv', 'nfo', 'srt', 'vtt', 'diff', 'patch', 'lock', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc'])

/** Text formats that read better rendered (by the OS thumbnail) than as markup. */
const RENDERED = new Set(['rtf', 'rtfd'])

/** Well-known extensionless files. */
const NAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'plaintext',
  gnumakefile: 'plaintext',
  rakefile: 'ruby',
  gemfile: 'ruby',
  podfile: 'ruby',
  procfile: 'plaintext',
  license: 'plaintext',
  licence: 'plaintext',
  readme: 'markdown',
  changelog: 'markdown',
  authors: 'plaintext',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
  '.bash_profile': 'shell',
  '.zprofile': 'shell',
  '.env': 'ini'
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function mimeType(name: string): string {
  return MIME[extensionOf(name)] ?? 'application/octet-stream'
}

/** Editor language for a text file, or null when the name says nothing (sniff the bytes then). */
export function textLanguage(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower in NAMES) return NAMES[lower]
  if (lower.startsWith('.env.')) return 'ini'
  if (lower.startsWith('dockerfile.')) return 'dockerfile'
  const ext = extensionOf(name)
  if (ext in LANGUAGES) return LANGUAGES[ext]
  if (PLAIN.has(ext) || PLAIN.has(lower.replace(/^\./, ''))) return 'plaintext'
  return null
}

/** Viewer for a file by name. Unknown names are 'thumbnail' – the caller may still sniff them as text. */
export function previewKind(name: string): PreviewKind {
  const ext = extensionOf(name)
  const mime = MIME[ext]
  if (mime === 'application/pdf') return 'pdf'
  if (mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('audio/')) return 'audio'
  if (ext === 'docx' || ext === 'docm' || ext === 'dotx') return 'docx'
  if (ext === 'xlsx' || ext === 'xlsm') return 'sheet'
  if (MODELS.has(ext)) return 'model'
  if (RENDERED.has(ext)) return 'thumbnail'
  if (textLanguage(name) !== null) return 'text'
  return 'thumbnail'
}

/** Unknown types are worth sniffing for plain text; formats with a renderer of their own are not. */
export function sniffable(name: string): boolean {
  return previewKind(name) === 'thumbnail' && !RENDERED.has(extensionOf(name))
}

/** Text if it has no NUL bytes and few control characters (UTF-8 multibyte sequences are fine). */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true
  let control = 0
  for (const b of bytes) {
    if (b === 0) return false
    if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) control++
  }
  return control / bytes.length < 0.02
}

/** Parses "bytes=a-b", "bytes=a-" and "bytes=-n" against a file size. Null means: serve everything. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number
  let end: number
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}
