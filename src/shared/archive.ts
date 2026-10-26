// Archives browsed as folders: "/x/photos.zip/2026/a.jpg" is a.jpg inside the folder 2026 of photos.zip.
// These helpers only look at names; the main process confirms that the archive is a real file.

export type ArchiveFormat = 'zip' | 'tar' | 'tgz' | 'tzst'

const FORMATS: [string, ArchiveFormat][] = [
  ['.tar.gz', 'tgz'],
  ['.tgz', 'tgz'],
  ['.tar.zst', 'tzst'],
  ['.tzst', 'tzst'],
  ['.tar', 'tar'],
  ['.zip', 'zip'],
  ['.jar', 'zip']
]

export function archiveFormat(name: string): ArchiveFormat | null {
  const lower = name.toLowerCase()
  for (const [ext, format] of FORMATS) if (lower.endsWith(ext) && lower.length > ext.length) return format
  return null
}

/** Opened as a folder on double-click. */
export function isBrowsableArchive(name: string): boolean {
  return archiveFormat(name) !== null
}

export interface ArchivePath {
  /** Path of the archive file itself. */
  archive: string
  /** Segments inside the archive; empty for its root. */
  inner: string[]
}

/** The first segment that looks like an archive splits the path; null when none does. */
export function splitArchivePath(p: string): ArchivePath | null {
  const windows = /^[a-zA-Z]:[\\/]|^\\\\/.test(p)
  const parts = p.split(windows ? /[\\/]/ : '/')
  const joiner = windows && p.includes('\\') ? '\\' : '/'
  // Never the first part (the root or drive), never empty parts.
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] && archiveFormat(parts[i])) {
      return { archive: parts.slice(0, i + 1).join(joiner), inner: parts.slice(i + 1).filter((s) => s !== '') }
    }
  }
  return null
}

/** Inside an archive (not the archive file itself) – nothing can be written there. */
export function isInsideArchive(p: string): boolean {
  const split = splitArchivePath(p)
  return split !== null && split.inner.length > 0
}

/** Normalizes a member name from an archive; null for names that would escape it ("../x", "/etc/x"). */
export function memberSegments(name: string): string[] | null {
  const segments = name.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.')
  if (segments.some((s) => s === '..') || /^([a-zA-Z]:|\/)/.test(name)) return null
  return segments
}

// ---- creating archives ----------------------------------------------------------------------

/** Offered when creating an archive, most common first. */
export const CREATE_FORMATS = ['zip', 'tgz', 'tzst', 'tar'] as const satisfies readonly ArchiveFormat[]

export const COMPRESSION_LEVELS = ['store', 'fast', 'normal', 'max'] as const
export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number]

export const ARCHIVE_EXTENSION: Record<ArchiveFormat, string> = { zip: '.zip', tar: '.tar', tgz: '.tar.gz', tzst: '.tar.zst' }

/** Levels that make sense for the format: a plain tar has none, gzip and zstd always compress. */
export function levelsFor(format: ArchiveFormat): CompressionLevel[] {
  if (format === 'tar') return []
  return format === 'zip' ? [...COMPRESSION_LEVELS] : ['fast', 'normal', 'max']
}

/** The zlib / zstd level for a preset; 0 stores zip members uncompressed. */
export function compressionLevel(format: ArchiveFormat, level: CompressionLevel): number {
  if (format === 'tzst') return { store: 3, fast: 1, normal: 3, max: 19 }[level]
  return { store: format === 'zip' ? 0 : 6, fast: 1, normal: 6, max: 9 }[level]
}

/** "photos" or "photos.tar.gz" → "photos.zip": swaps a known archive extension, otherwise appends one. */
export function withArchiveExtension(name: string, format: ArchiveFormat): string {
  const lower = name.toLowerCase()
  const known = FORMATS.find(([ext]) => lower.endsWith(ext) && lower.length > ext.length)
  return (known ? name.slice(0, -known[0].length) : name) + ARCHIVE_EXTENSION[format]
}
