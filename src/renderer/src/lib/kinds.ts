import { t, type MessageKey } from '@shared/i18n'
import type { FileEntry, FileKind } from '@shared/types'

const LABELS: Partial<Record<FileKind, MessageKey>> = {
  folder: 'kind.folder',
  app: 'kind.app',
  image: 'kind.image',
  audio: 'kind.audio',
  video: 'kind.video',
  pdf: 'kind.pdf',
  text: 'kind.text',
  code: 'kind.code',
  archive: 'kind.archive',
  document: 'kind.document'
}

export function kindLabel(entry: FileEntry): string {
  if (entry.isDir) return t(entry.isSymlink ? 'kind.folderLink' : 'kind.folder')
  const dot = entry.name.lastIndexOf('.')
  const ext = dot > 0 ? entry.name.slice(dot + 1).toUpperCase() : ''
  const key = LABELS[entry.kind]
  const label = key ? t(key) : ''
  if (label && ext && entry.kind !== 'app' && !label.toUpperCase().split(/[\s-]+/).includes(ext)) return `${label} ${ext}`
  if (label) return label
  return ext ? t('kind.fileExt', { ext }) : t('kind.file')
}
