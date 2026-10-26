// Hand-drawn SVG icons (no original Microsoft or other third-party assets). Luna lives here; the other
// sets are in ./icons. Every set must draw every name, which the Record type enforces.
import { createContext, useContext } from 'react'
import { FILE_KINDS, type FileKind, type IconSetId, type Place } from '@shared/types'
import { flat } from './icons/flat'
import { line } from './icons/line'

export type IconName =
  | FileKind
  | Place['icon']
  | 'back'
  | 'forward'
  | 'up'
  | 'newFolder'
  | 'newFile'
  | 'terminal'
  | 'folders'
  | 'search'
  | 'rename'
  | 'trash'
  | 'reveal'
  | 'go'
  | 'error'
  | 'copy'
  | 'open'
  | 'theme'
  | 'group'
  | 'git'
  | 'todo'
  | 'note'
  | 'games'
  | 'stocks'
  | 'view'
  | 'panes'
  | 'automation'
  | 'console'
  | 'preview'
  | 'star'
  | 'remote'
  | 'ai'
  | 'settings'
  | 'feedback'
  | 'tools'
  | 'help'
  // The Tools area, one per tool.
  | 'calculator'
  | 'ruler'
  | 'checksum'
  | 'convert'
  | 'duplicates'
  | 'diskMap'
  | 'json'
  | 'encoding'
  | 'dice'
  | 'regex'
  | 'clock'
  | 'colors'
  | 'clipboard'
  | 'stopwatch'
  | 'globe'
  | 'scratchpad'
  | 'monitor'
  | 'docker'

/** One icon set: a drawing for every name on a 32×32 canvas, plus attributes shared by all of them. */
export interface IconSet {
  paths: Record<IconName, React.ReactNode>
  /** Presentation attributes for the root <svg>, e.g. stroke styling for an outline set. */
  frame?: React.SVGProps<SVGSVGElement>
}

/** Which set draws UI icons and which draws file and place icons; provided by App from the settings. */
export const IconSetContext = createContext<{ ui: IconSetId; files: IconSetId }>({ ui: 'flat', files: 'flat' })

const PLACE_ICONS: readonly Place['icon'][] = ['home', 'desktop', 'documents', 'downloads', 'apps', 'disk', 'volume']
const FILE_ICONS = new Set<string>([...FILE_KINDS, ...PLACE_ICONS])
export const isFileIcon = (name: IconName): boolean => FILE_ICONS.has(name)

interface Props {
  name: IconName
  size?: number
  className?: string
  /** Draw with this set instead of the one from the settings (previews in the settings dialog). */
  set?: IconSetId
}

export function Icon({ name, size = 16, className, set }: Props): React.JSX.Element {
  const sets = useContext(IconSetContext)
  const id = set ?? (FILE_ICONS.has(name) ? sets.files : sets.ui)
  const { paths, frame } = ICON_SET_DEFS[id] ?? ICON_SET_DEFS.luna
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" data-icon-set={id} {...frame}>
      {paths[name] ?? paths.other}
    </svg>
  )
}

const folder = (
  <>
    <defs>
      <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff3b0" />
        <stop offset="1" stopColor="#e8b83a" />
      </linearGradient>
    </defs>
    <path d="M2 7h10l3 3h15v17H2z" fill="#d9a52a" stroke="#a87b13" />
    <path d="M2 12h28v15H2z" fill="url(#fg)" stroke="#a87b13" />
  </>
)

const page = (badge: React.ReactNode): React.ReactNode => (
  <>
    <path d="M6 2h14l7 7v21H6z" fill="#fff" stroke="#7a8ca8" />
    <path d="M20 2v7h7" fill="#dfe6f2" stroke="#7a8ca8" />
    {badge}
  </>
)

const arrowCircle = (fill: string, d: string): React.ReactNode => (
  <>
    <circle cx="16" cy="16" r="13" fill={fill} stroke="#1d6b1d" />
    <path d={d} fill="#fff" />
  </>
)

const paths: Record<IconName, React.ReactNode> = {
  folder,
  // Four tiles: the view switcher.
  view: (
    <>
      <path d="M4 4h10v10H4zM18 4h10v10H18zM4 18h10v10H4zM18 18h10v10H18z" fill="#bcd3f5" stroke="#2a5aa8" />
      <path d="M6 6h6v3H6zM20 6h6v3h-6zM6 20h6v3H6zM20 20h6v3h-6z" fill="#fff" />
    </>
  ),
  home: (
    <>
      <path d="M4 15 16 4l12 11" fill="none" stroke="#9c3c1c" strokeWidth="3" />
      <path d="M8 14v14h16V14L16 7z" fill="#f4d58d" stroke="#9c6b1c" />
      <path d="M14 20h5v8h-5z" fill="#8a4b1c" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="5" width="26" height="18" rx="1" fill="#3a6ea5" stroke="#1c3a66" />
      <rect x="5" y="7" width="22" height="14" fill="#5ea3e8" />
      <path d="M12 23h8v4h4v2H8v-2h4z" fill="#9aa4b3" />
    </>
  ),
  documents: (
    <>
      {folder}
      <path d="M11 14h10v10H11z" fill="#fff" stroke="#7a8ca8" />
      <path d="M13 17h6M13 19h6M13 21h4" stroke="#7a8ca8" />
    </>
  ),
  downloads: (
    <>
      {folder}
      <path d="M14 12h4v6h4l-6 7-6-7h4z" fill="#2f9e2f" stroke="#1d6b1d" />
    </>
  ),
  apps: (
    <>
      <rect x="4" y="4" width="11" height="11" rx="2" fill="#e05a2b" />
      <rect x="17" y="4" width="11" height="11" rx="2" fill="#3a8ee6" />
      <rect x="4" y="17" width="11" height="11" rx="2" fill="#3fae3f" />
      <rect x="17" y="17" width="11" height="11" rx="2" fill="#f2c12e" />
    </>
  ),
  disk: (
    <>
      <rect x="3" y="10" width="26" height="13" rx="2" fill="#d6dbe3" stroke="#6b7684" />
      <rect x="5" y="18" width="22" height="3" fill="#9aa4b3" />
      <circle cx="24" cy="14" r="1.5" fill="#3fae3f" />
    </>
  ),
  volume: (
    <>
      <rect x="3" y="10" width="26" height="13" rx="2" fill="#f1e3b3" stroke="#8a7a4a" />
      <circle cx="24" cy="14" r="1.5" fill="#e05a2b" />
    </>
  ),
  app: (
    <>
      <rect x="4" y="4" width="24" height="24" rx="5" fill="#4a7fd4" stroke="#1c3a66" />
      <path d="M10 22 16 9l6 13M12 18h8" fill="none" stroke="#fff" strokeWidth="2.5" />
    </>
  ),
  image: page(
    <>
      <rect x="9" y="13" width="15" height="12" fill="#bfe1ff" stroke="#3a6ea5" />
      <path d="M9 25l5-6 3 3 3-4 4 7z" fill="#3fae3f" />
      <circle cx="20" cy="16" r="1.5" fill="#f2c12e" />
    </>
  ),
  audio: page(<path d="M14 25a2.5 2.5 0 1 1-1-2V12l9-2v11a2.5 2.5 0 1 1-1-2v-7l-7 1.5z" fill="#7a3fb5" />),
  video: page(
    <>
      <rect x="9" y="14" width="15" height="10" fill="#333" />
      <path d="M14 16v6l5-3z" fill="#fff" />
    </>
  ),
  pdf: page(
    <>
      <rect x="8" y="16" width="17" height="8" fill="#d32f2f" />
      <text x="16.5" y="22.5" fontSize="7" fontWeight="bold" fill="#fff" textAnchor="middle" fontFamily="Tahoma">PDF</text>
    </>
  ),
  text: page(<path d="M10 14h13M10 17h13M10 20h13M10 23h9" stroke="#7a8ca8" strokeWidth="1.2" />),
  code: page(<path d="m13 15-4 4 4 4M20 15l4 4-4 4" fill="none" stroke="#2b6cb0" strokeWidth="2" />),
  archive: page(
    <>
      <rect x="10" y="12" width="13" height="14" fill="#f2c12e" stroke="#a87b13" />
      <path d="M16 12v14" stroke="#a87b13" strokeDasharray="2 1" strokeWidth="2" />
    </>
  ),
  document: page(
    <>
      <rect x="9" y="14" width="15" height="11" fill="#2b5797" />
      <text x="16.5" y="22.5" fontSize="8" fontWeight="bold" fill="#fff" textAnchor="middle" fontFamily="Tahoma">W</text>
    </>
  ),
  other: page(null),
  back: arrowCircle('#3fae3f', 'M19 9v14l-10-7z'),
  forward: arrowCircle('#3fae3f', 'M13 9v14l10-7z'),
  up: (
    <>
      {folder}
      <path d="M16 9l7 8h-4v7h-6v-7H9z" fill="#3fae3f" stroke="#1d6b1d" />
    </>
  ),
  newFolder: (
    <>
      {folder}
      <path d="M22 1l1.6 4.4L28 7l-4.4 1.6L22 13l-1.6-4.4L16 7l4.4-1.6z" fill="#fff36b" stroke="#c7a400" />
    </>
  ),
  newFile: page(<path d="M22 1l1.6 4.4L28 7l-4.4 1.6L22 13l-1.6-4.4L16 7l4.4-1.6z" fill="#fff36b" stroke="#c7a400" />),
  terminal: (
    <>
      <rect x="2" y="5" width="28" height="22" rx="2" fill="#1e1e1e" stroke="#555" />
      <rect x="2" y="5" width="28" height="4" fill="#3a6ea5" />
      <path d="m7 13 5 4-5 4M14 22h8" fill="none" stroke="#7CFC00" strokeWidth="2" />
    </>
  ),
  folders: (
    <>
      <path d="M5 4v22M5 10h6M5 20h6" stroke="#7a8ca8" strokeDasharray="2 1" />
      <path d="M11 6h6l2 2h9v6H11z" fill="#f2c12e" stroke="#a87b13" />
      <path d="M11 16h6l2 2h9v6H11z" fill="#f2c12e" stroke="#a87b13" />
    </>
  ),
  search: (
    <>
      <circle cx="13" cy="13" r="8" fill="#dfefff" stroke="#3a6ea5" strokeWidth="2.5" />
      <path d="m19 19 9 9" stroke="#8a5a2a" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  rename: (
    <>
      <rect x="3" y="10" width="26" height="12" fill="#fff" stroke="#7a8ca8" />
      <path d="M8 14h8M8 18h6" stroke="#3a6ea5" strokeWidth="2" />
      <path d="M22 7v18M20 7h4M20 25h4" stroke="#000" />
    </>
  ),
  trash: (
    <>
      <path d="M7 9h18l-2 20H9z" fill="#dfe6f2" stroke="#5a6a80" />
      <path d="M5 7h22v3H5zM13 4h6v3h-6z" fill="#b8c4d6" stroke="#5a6a80" />
      <path d="M12 13v12M16 13v12M20 13v12" stroke="#5a6a80" />
    </>
  ),
  reveal: (
    <>
      {folder}
      <circle cx="17" cy="19" r="5" fill="#dfefff" stroke="#3a6ea5" strokeWidth="2" />
      <path d="m21 23 5 5" stroke="#3a6ea5" strokeWidth="3" />
    </>
  ),
  go: arrowCircle('#3fae3f', 'M10 13h7V8l8 8-8 8v-5h-7z'),
  error: (
    <>
      <circle cx="16" cy="16" r="14" fill="#e03a2b" stroke="#8a1c12" />
      <path d="m10 10 12 12M22 10 10 22" stroke="#fff" strokeWidth="3.5" />
    </>
  ),
  copy: (
    <>
      <rect x="4" y="4" width="16" height="20" fill="#fff" stroke="#7a8ca8" />
      <rect x="12" y="9" width="16" height="20" fill="#fff" stroke="#7a8ca8" />
    </>
  ),
  group: (
    <>
      <rect x="3" y="3" width="26" height="7" rx="1" fill="#f6d36b" stroke="#a87b13" />
      <rect x="3" y="12" width="26" height="7" rx="1" fill="#8fc0f0" stroke="#3a6ea5" />
      <rect x="3" y="21" width="26" height="7" rx="1" fill="#9ddc8f" stroke="#2f7a2f" />
      <path d="M7 6.5h10M7 15.5h14M7 24.5h8" stroke="#fff" strokeWidth="2" />
    </>
  ),
  // Git branches: the main line and a side branch merging back into it.
  git: (
    <>
      <path d="M10 8v16M22 12c0 6-12 4-12 10" fill="none" stroke="#b5401f" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="10" cy="6.5" r="3.5" fill="#f37c4f" stroke="#a5341a" strokeWidth="1.3" />
      <circle cx="22" cy="10" r="3.5" fill="#f37c4f" stroke="#a5341a" strokeWidth="1.3" />
      <circle cx="10" cy="25.5" r="3.5" fill="#f37c4f" stroke="#a5341a" strokeWidth="1.3" />
    </>
  ),
  games: (
    <>
      <path d="M9 9h14a7 7 0 0 1 7 7v2a6 6 0 0 1-10.5 4h-7A6 6 0 0 1 2 18v-2a7 7 0 0 1 7-7z" fill="#6c7ae0" stroke="#2f3a8f" />
      <path d="M9 13v6M6 16h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="21" cy="15" r="1.6" fill="#ffd43b" />
      <circle cx="25" cy="18" r="1.6" fill="#ff6b6b" />
    </>
  ),
  stocks: (
    <>
      <rect x="3" y="4" width="26" height="24" rx="2" fill="#f4f8ff" stroke="#3f5f8f" />
      <path d="M6 22l6-6 4 3 9-10" fill="none" stroke="#2f9e44" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 9h5v5" fill="none" stroke="#2f9e44" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  note: (
    <>
      <path d="M5 4h22v16l-8 8H5z" fill="#fff59d" stroke="#a08a1c" />
      <path d="M27 20h-6a2 2 0 0 0-2 2v6z" fill="#e8d55a" stroke="#a08a1c" />
      <path d="M9 10h14M9 15h14M9 20h7" stroke="#8a7a3c" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  todo: (
    <>
      <rect x="5" y="3" width="22" height="26" rx="2" fill="#fffbe6" stroke="#8a7a3c" />
      <path d="M9 10l2 2 4-4M9 18l2 2 4-4" fill="none" stroke="#2f9e44" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 11h6M18 19h6M9 25h15" stroke="#7a7a7a" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  automation: (
    <>
      <path d="M9 8a10 10 0 0 1 17 7" fill="none" stroke="#3b82d0" strokeWidth="3" strokeLinecap="round" />
      <path d="m22 10 5 5 3-6" fill="none" stroke="#3b82d0" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M23 24A10 10 0 0 1 6 17" fill="none" stroke="#54a46c" strokeWidth="3" strokeLinecap="round" />
      <path d="m10 22-5-5-3 6" fill="none" stroke="#54a46c" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="m14 11 7 5-7 5z" fill="#e9b440" stroke="#8a651c" strokeWidth="1" />
    </>
  ),
  console: (
    <>
      <rect x="2" y="4" width="28" height="22" rx="2" fill="#1b1f2a" stroke="#4a5568" />
      <path d="M2 6a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v3H2z" fill="#5a6a80" />
      <path d="m7 14 4 3-4 3" fill="none" stroke="#7ee787" strokeWidth="2" />
      <path d="M13 21h6" stroke="#c9d1d9" strokeWidth="2" />
      <path d="M24 13l1.2 2.8L28 17l-2.8 1.2L24 21l-1.2-2.8L20 17l2.8-1.2z" fill="#f2a65a" />
    </>
  ),
  ai: (
    <>
      <path d="M13 3l2.4 6.6L22 12l-6.6 2.4L13 21l-2.4-6.6L4 12l6.6-2.4z" fill="#8b5cf6" stroke="#5b21b6" strokeLinejoin="round" />
      <path d="M24 17l1.2 3.3L28.5 21.5l-3.3 1.2L24 26l-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#f59e0b" stroke="#b45309" strokeLinejoin="round" />
      <circle cx="25" cy="7" r="2" fill="#38bdf8" />
    </>
  ),
  remote: (
    <>
      <path d="M9 22a6 6 0 0 1-.6-12A8 8 0 0 1 24 9.5a5.5 5.5 0 0 1 .5 11z" fill="#dbeeff" stroke="#3b7dd8" strokeLinejoin="round" />
      <rect x="9" y="19" width="14" height="9" rx="1.5" fill="#5a6a80" stroke="#2f3b4c" />
      <circle cx="12" cy="23.5" r="1.2" fill="#3fdc5a" />
      <path d="M15 23.5h5" stroke="#cfd8e3" strokeWidth="1.5" />
    </>
  ),
  star: (
    <path
      d="M16 3l3.9 8.1 8.8 1.2-6.4 6.1 1.6 8.8L16 23l-7.9 4.2 1.6-8.8-6.4-6.1 8.8-1.2z"
      fill="#f7c935"
      stroke="#b8860b"
      strokeLinejoin="round"
    />
  ),
  preview: (
    <>
      <rect x="2" y="4" width="28" height="24" fill="#fff" stroke="#5a6a80" />
      <path d="M2 4h28v5H2z" fill="#2a64e8" stroke="#5a6a80" />
      <path d="M5 13h7M5 17h5M5 21h7" stroke="#9aa8bf" strokeWidth="1.5" />
      <rect x="15" y="11" width="12" height="14" fill="#cfe6ff" stroke="#5a6a80" />
      <path d="m15 25 4-5 3 3 2-2 3 4z" fill="#3fae3f" />
      <circle cx="23.5" cy="14.5" r="1.6" fill="#f2c12e" />
    </>
  ),
  panes: (
    <>
      <rect x="2" y="4" width="28" height="24" fill="#fff" stroke="#5a6a80" />
      <path d="M2 4h28v5H2z" fill="#2a64e8" stroke="#5a6a80" />
      <path d="M16 9v19" stroke="#5a6a80" strokeWidth="2" />
      <path d="M5 13h8M5 17h6M5 21h8M19 13h8M19 17h6M19 21h8" stroke="#9aa8bf" strokeWidth="1.5" />
    </>
  ),
  theme: (
    <>
      <path d="M16 3C8.8 3 3 8.4 3 15c0 6.1 5 11 11.2 11 1.8 0 2.3-1.3 1.6-2.6-.8-1.5.1-3.4 2-3.4H22c4 0 7-3 7-6.6C29 7.6 23.2 3 16 3z" fill="#f4e3b8" stroke="#8a6a2a" />
      <circle cx="9" cy="14" r="2.3" fill="#e03a2b" />
      <circle cx="13" cy="8.5" r="2.3" fill="#2a64e8" />
      <circle cx="20" cy="8.5" r="2.3" fill="#3fae3f" />
      <circle cx="24.5" cy="13.5" r="2.3" fill="#f2c12e" />
    </>
  ),
  open: (
    <>
      <path d="M2 8h10l3 3h13v16H2z" fill="#d9a52a" stroke="#a87b13" />
      <path d="M6 14h25l-4 13H2z" fill="#ffe58a" stroke="#a87b13" />
    </>
  ),
  help: (
    <>
      <circle cx="16" cy="16" r="13" fill="#3a8ee6" stroke="#1c5aa6" />
      <path d="M12 12.5a4 4 0 1 1 5.6 3.7c-1 .5-1.6 1.3-1.6 2.4V20" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="24.2" r="1.9" fill="#fff" />
    </>
  ),
  tools: (
    <>
      <path d="M5 13h22v14a1.5 1.5 0 0 1-1.5 1.5h-19A1.5 1.5 0 0 1 5 27z" fill="#d9480f" stroke="#8a2c06" />
      <path d="M3 10.5A1.5 1.5 0 0 1 4.5 9h23A1.5 1.5 0 0 1 29 10.5V15H3z" fill="#f76707" stroke="#8a2c06" />
      <path d="M12 9V6.5A1.5 1.5 0 0 1 13.5 5h5A1.5 1.5 0 0 1 20 6.5V9" fill="none" stroke="#5c5f66" strokeWidth="2" />
      <rect x="13.5" y="13" width="5" height="4" rx="1" fill="#e9ecef" stroke="#5c5f66" />
    </>
  ),
  feedback: (
    <>
      <path d="M5 4h22a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 27 22H14.5L8 27.5V22H5a2.5 2.5 0 0 1-2.5-2.5v-13A2.5 2.5 0 0 1 5 4z" fill="#e7f0ff" stroke="#3a6ea5" />
      <path d="M16 8.5v6.5" stroke="#e8590c" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="16" cy="18.6" r="1.7" fill="#e8590c" />
    </>
  ),
  settings: (
    <>
      <g fill="#8e9aab">
        {[0, 45, 90, 135].map((a) => <rect key={a} x="13.5" y="2" width="5" height="28" rx="1" transform={`rotate(${a} 16 16)`} />)}
      </g>
      <circle cx="16" cy="16" r="9.5" fill="#b8c4d6" stroke="#5a6a80" />
      <circle cx="16" cy="16" r="4" fill="#fff" stroke="#5a6a80" />
    </>
  ),
  calculator: (
    <>
      <rect x="6" y="2.5" width="20" height="27" rx="2" fill="#c9d3e0" stroke="#5a6a80" />
      <rect x="9" y="5.5" width="14" height="6" fill="#d8f0c8" stroke="#5a6a80" />
      <path d="M19 9.5h2" stroke="#2f5a2f" strokeWidth="1.5" />
      {[14.5, 19.5, 24.5].flatMap((y) => [9, 14, 19].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="3" fill={x === 19 && y === 24.5 ? '#f2994a' : '#fff'} stroke="#7a8ca8" />))}
    </>
  ),
  ruler: (
    <g transform="rotate(-45 16 16)">
      <rect x="1" y="11" width="30" height="10" rx="1" fill="#f2c94c" stroke="#a87b13" />
      <path d="M5 11v4M9 11v2.5M13 11v4M17 11v2.5M21 11v4M25 11v2.5" stroke="#8a651c" />
    </g>
  ),
  checksum: (
    <>
      <path d="M16 2.5 27 6.5V15c0 7-5 12-11 14.5C10 27 5 22 5 15V6.5z" fill="#5a9ae8" stroke="#1c3a66" />
      <path d="m10.5 15.5 4 4 7-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  convert: (
    <>
      <rect x="2" y="4" width="22" height="17" fill="#bfe1ff" stroke="#3a6ea5" />
      <path d="m2 21 6-7 4 4 3-3 7 6z" fill="#3fae3f" />
      <circle cx="18" cy="9" r="2" fill="#f2c12e" />
      <circle cx="24" cy="24" r="7" fill="#f2994a" stroke="#b45309" />
      <path d="M20.5 22.5h7l-2-2M27.5 25.5h-7l2 2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  duplicates: (
    <>
      <rect x="3" y="2" width="15" height="19" fill="#fff" stroke="#7a8ca8" />
      <path d="M6 7h9M6 10h9M6 13h6" stroke="#9aa8bf" />
      <rect x="11" y="9" width="15" height="19" fill="#fff" stroke="#7a8ca8" />
      <path d="M14 14h9M14 17h9M14 20h6" stroke="#9aa8bf" />
      <circle cx="24" cy="24" r="6" fill="#e05a2b" stroke="#8a2c06" />
      <path d="M21 22.5h6M21 25.5h6" stroke="#fff" strokeWidth="1.8" />
    </>
  ),
  diskMap: (
    <g stroke="#2f3b4c">
      <rect x="3" y="4" width="14" height="24" fill="#5ea3e8" />
      <rect x="17" y="4" width="12" height="12" fill="#3fae3f" />
      <rect x="17" y="16" width="7" height="12" fill="#f2c12e" />
      <rect x="24" y="16" width="5" height="6" fill="#e05a2b" />
      <rect x="24" y="22" width="5" height="6" fill="#9b6bd6" />
    </g>
  ),
  json: page(
    <path
      d="M13.5 13c-2 0-2.5 1-2.5 2.5V17c0 1-.6 1.6-1.6 1.6 1 0 1.6.6 1.6 1.6v1.3c0 1.5.5 2.5 2.5 2.5M19.5 13c2 0 2.5 1 2.5 2.5V17c0 1 .6 1.6 1.6 1.6-1 0-1.6.6-1.6 1.6v1.3c0 1.5-.5 2.5-2.5 2.5"
      fill="none"
      stroke="#7a3fb5"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  encoding: (
    <>
      <rect x="2" y="3" width="14" height="14" rx="1.5" fill="#e7f0ff" stroke="#3a6ea5" />
      <text x="9" y="14" fontSize="11" fontWeight="bold" fill="#2a64e8" textAnchor="middle" fontFamily="Tahoma">A</text>
      <rect x="16" y="15" width="14" height="14" rx="1.5" fill="#fff4d6" stroke="#a87b13" />
      <text x="23" y="26" fontSize="11" fontWeight="bold" fill="#b45309" textAnchor="middle" fontFamily="Tahoma">%</text>
      <path d="M8 19.5v2.5a2 2 0 0 0 2 2h3.5M11.5 21.5l2.5 2.5-2.5 2.5" fill="none" stroke="#5a6a80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  dice: (
    <>
      <rect x="4" y="4" width="24" height="24" rx="4" fill="#fff" stroke="#5a6a80" />
      {[[10, 10], [22, 10], [16, 16], [10, 22], [22, 22]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.3" fill="#c0392b" />)}
    </>
  ),
  regex: (
    <>
      <rect x="2" y="5" width="28" height="22" rx="3" fill="#e7f0ff" stroke="#3a6ea5" />
      <circle cx="10" cy="21" r="2.6" fill="#e05a2b" />
      <path d="M20 9v10M15.7 11.5l8.6 5M15.7 16.5l8.6-5" stroke="#2a64e8" strokeWidth="2.6" strokeLinecap="round" />
    </>
  ),
  clock: (
    <>
      <circle cx="16" cy="16" r="13" fill="#fff" stroke="#3a6ea5" strokeWidth="2" />
      <path d="M16 5v2.5M16 24.5V27M5 16h2.5M24.5 16H27" stroke="#7a8ca8" strokeWidth="1.5" />
      <path d="M16 9v7l5 3" fill="none" stroke="#1c3a66" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  colors: (
    <g stroke="#3a4656" fillOpacity="0.85">
      <circle cx="16" cy="11" r="8" fill="#e03a2b" />
      <circle cx="11" cy="20" r="8" fill="#3fae3f" />
      <circle cx="21" cy="20" r="8" fill="#2a64e8" />
    </g>
  ),
  clipboard: (
    <>
      <rect x="5" y="5" width="22" height="25" rx="2" fill="#c08a4a" stroke="#7a4f1c" />
      <rect x="8" y="8" width="16" height="19" fill="#fff" stroke="#9aa8bf" />
      <rect x="11.5" y="2.5" width="9" height="5" rx="1.5" fill="#b8c4d6" stroke="#5a6a80" />
      <path d="M11 13h10M11 17h10M11 21h6" stroke="#7a8ca8" strokeWidth="1.4" />
    </>
  ),
  stopwatch: (
    <>
      <rect x="13" y="1.5" width="6" height="3" rx="1" fill="#9aa4b3" stroke="#5a6a80" />
      <path d="M16 4.5V7M24 8.5l2-2" stroke="#5a6a80" strokeWidth="2" />
      <circle cx="16" cy="18" r="11.5" fill="#fff" stroke="#5a6a80" strokeWidth="2" />
      <path d="M16 18V9a9 9 0 0 1 7.8 4.5z" fill="#ffd8cc" />
      <path d="M16 18V10" stroke="#e03a2b" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="18" r="1.6" fill="#1c3a66" />
    </>
  ),
  globe: (
    <>
      <circle cx="16" cy="16" r="13" fill="#5ea3e8" stroke="#1c3a66" />
      <path d="M8 9c3 1 5 0 6 2s-2 3-1 5 4 1 4 4-2 4-1 6M20 5c-1 2 1 3 3 3s3 2 5 2M22 17c2 0 3 1 3 3s-1 3-3 4" fill="none" stroke="#3fae3f" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="16" cy="16" rx="6" ry="13" fill="none" stroke="#fff" strokeOpacity="0.7" />
      <path d="M3 16h26" stroke="#fff" strokeOpacity="0.7" />
    </>
  ),
  scratchpad: (
    <>
      <rect x="3" y="5" width="20" height="24" fill="#fff" stroke="#7a8ca8" />
      <path d="M6 3v4M10 3v4M14 3v4M18 3v4" stroke="#5a6a80" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6 12h14M6 16h14M6 20h9" stroke="#9aa8bf" />
      <path d="m26.5 8 3 3-12 12-4 1 1-4z" fill="#f2c12e" stroke="#8a651c" strokeLinejoin="round" />
      <path d="m24 10.5 3 3" stroke="#8a651c" />
    </>
  ),
  // The Docker whale carrying its containers.
  docker: (
    <>
      <path d="M2 17h25.5c.8-1.6 2.3-2.6 4-2.5-.3 1.5-1.2 2.6-2.6 3C27.3 23 22 27.5 14.5 27.5 7.5 27.5 3 23.5 2 17z" fill="#2496ed" stroke="#1565a8" strokeLinejoin="round" />
      {[[4.5, 12.5], [9.5, 12.5], [14.5, 12.5], [19.5, 12.5], [9.5, 8], [14.5, 8], [14.5, 3.5]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="4.2" height="3.8" fill="#8fd0ff" stroke="#1565a8" strokeWidth="0.8" />)}
      <circle cx="8" cy="21" r="1.1" fill="#fff" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="4" width="28" height="22" rx="2" fill="#1b1f2a" stroke="#4a5568" />
      <path d="M2 11h28M2 18h28M9 4v22M16 4v22M23 4v22" stroke="#2d3646" />
      <path d="M4 17h5l2-6 4 11 3-8 2 3h8" fill="none" stroke="#7ee787" strokeWidth="2" strokeLinejoin="round" />
      <path d="M11 29h10" stroke="#5a6a80" strokeWidth="2" strokeLinecap="round" />
    </>
  )
}

const ICON_SET_DEFS: Record<IconSetId, IconSet> = { luna: { paths }, flat, line }
