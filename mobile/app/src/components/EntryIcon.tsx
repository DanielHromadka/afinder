import { Ionicons } from '@expo/vector-icons'
import { useColors } from '../lib/theme'

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  folder: 'folder',
  app: 'apps',
  image: 'image-outline',
  audio: 'musical-notes-outline',
  video: 'film-outline',
  pdf: 'document-text-outline',
  text: 'document-text-outline',
  code: 'code-slash-outline',
  archive: 'archive-outline',
  document: 'document-outline',
  home: 'home-outline',
  desktop: 'desktop-outline',
  documents: 'documents-outline',
  downloads: 'download-outline',
  apps: 'apps-outline',
  disk: 'server-outline',
  volume: 'server-outline'
}

export function EntryIcon({ kind, size = 28 }: { kind: string; size?: number }): React.JSX.Element {
  const c = useColors()
  return <Ionicons name={ICONS[kind] ?? 'document-outline'} size={size} color={kind === 'folder' ? c.folder : c.muted} />
}
