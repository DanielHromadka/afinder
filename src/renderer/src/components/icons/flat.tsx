// Flat: solid modern colours, rounded shapes, no outlines or gradients.
import type { IconSet } from '../Icon'

const C = { blue: '#3b82f6', sky: '#38bdf8', green: '#22c55e', red: '#ef4444', violet: '#8b5cf6', amber: '#f59e0b', slate: '#64748b', ink: '#1e293b', mist: '#e2e8f0' }
const round = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const folder = (
  <>
    <path d="M3 8a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#f0a830" />
    <path d="M3 13a2 2 0 0 1 2-2h22a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#fcc93f" />
  </>
)

const page = (badge: React.ReactNode): React.ReactNode => (
  <>
    <path d="M7 3h12l7 7v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill={C.mist} />
    <path d="M19 3v5a2 2 0 0 0 2 2h5z" fill="#c3cddc" />
    {badge}
  </>
)

const label = (text: string, fill: string, size = 6.5): React.ReactNode =>
  page(
    <>
      <rect x="8" y="15" width="16" height="10" rx="2" fill={fill} />
      <text x="16" y="22.4" fontSize={size} fontWeight="bold" fill="#fff" textAnchor="middle" fontFamily="system-ui, sans-serif">{text}</text>
    </>
  )

const plus = (
  <>
    <circle cx="24" cy="24" r="6.5" fill={C.green} />
    <path d="M24 20.5v7M20.5 24h7" stroke="#fff" strokeWidth="2.2" {...round} />
  </>
)

const disc = (d: string): React.ReactNode => (
  <>
    <circle cx="16" cy="16" r="13" fill={C.green} />
    <path d={d} stroke="#fff" strokeWidth="3.2" {...round} />
  </>
)

const sparkle = (x: number, y: number, r: number, fill: string): React.ReactNode => (
  <path d={`M${x} ${y - r}l${r * 0.27} ${r * 0.73} ${r * 0.73} ${r * 0.27}-${r * 0.73} ${r * 0.27}-${r * 0.27} ${r * 0.73}-${r * 0.27}-${r * 0.73}-${r * 0.73}-${r * 0.27} ${r * 0.73}-${r * 0.27}z`} fill={fill} />
)

const windowFrame = (
  <>
    <rect x="2" y="5" width="28" height="22" rx="3" fill={C.mist} />
    <path d="M2 8a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v2H2z" fill={C.blue} />
  </>
)

export const flat: IconSet = {
  paths: {
    folder,
    app: (
      <>
        <rect x="4" y="4" width="24" height="24" rx="6" fill={C.blue} />
        <path d="M11 22l5-12 5 12M13 18h6" stroke="#fff" strokeWidth="2.5" {...round} />
      </>
    ),
    image: page(
      <>
        <rect x="9" y="14" width="14" height="11" rx="1.5" fill={C.sky} />
        <path d="M9 25l5-6 3 3 3-4 3 4v3z" fill="#16a34a" />
        <circle cx="19" cy="17" r="1.5" fill="#fde047" />
      </>
    ),
    audio: page(
      <>
        <path d="M14 23v-9l8-2v9" stroke={C.violet} strokeWidth="2" {...round} />
        <circle cx="12" cy="23" r="2.5" fill={C.violet} />
        <circle cx="20" cy="21" r="2.5" fill={C.violet} />
      </>
    ),
    video: page(
      <>
        <rect x="9" y="14" width="14" height="11" rx="2" fill={C.red} />
        <path d="M14 17v5l4.5-2.5z" fill="#fff" />
      </>
    ),
    pdf: label('PDF', C.red),
    text: page(<path d="M10 14h12M10 18h12M10 22h8" stroke="#94a3b8" strokeWidth="2" {...round} />),
    code: page(<path d="m13 15-3.5 4 3.5 4M19 15l3.5 4-3.5 4" stroke={C.blue} strokeWidth="2.2" {...round} />),
    archive: page(
      <>
        <rect x="10" y="12" width="12" height="14" rx="2" fill={C.amber} />
        <path d="M16 13v2M16 17v2M16 21v2" stroke="#fff" strokeWidth="2" {...round} />
      </>
    ),
    document: label('W', '#2563eb', 8),
    other: page(null),
    home: (
      <>
        <path d="M6 15 16 6l10 9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="#fb923c" />
        <path d="M3.5 15.5 16 4.5l12.5 11" stroke="#c2410c" strokeWidth="3" {...round} />
        <path d="M13 28v-7h6v7z" fill="#fff" />
      </>
    ),
    desktop: (
      <>
        <rect x="3" y="5" width="26" height="17" rx="2" fill="#334155" />
        <rect x="5" y="7" width="22" height="13" rx="1" fill={C.sky} />
        <path d="M13 22h6v4h-6zM9 26h14v2H9z" fill="#94a3b8" />
      </>
    ),
    documents: (
      <>
        {folder}
        <rect x="11" y="14" width="10" height="11" rx="1" fill="#fff" />
        <path d="M13 18h6M13 21h4" stroke="#94a3b8" strokeWidth="1.5" {...round} />
      </>
    ),
    downloads: (
      <>
        {folder}
        <path d="M16 14v9M12 19l4 4 4-4" stroke="#fff" strokeWidth="2.5" {...round} />
      </>
    ),
    apps: (
      <>
        <rect x="4" y="4" width="11" height="11" rx="3" fill={C.red} />
        <rect x="17" y="4" width="11" height="11" rx="3" fill={C.blue} />
        <rect x="4" y="17" width="11" height="11" rx="3" fill={C.green} />
        <rect x="17" y="17" width="11" height="11" rx="3" fill={C.amber} />
      </>
    ),
    disk: (
      <>
        <rect x="3" y="10" width="26" height="13" rx="3" fill="#94a3b8" />
        <rect x="3" y="17" width="26" height="6" rx="3" fill={C.slate} />
        <circle cx="24" cy="20" r="1.5" fill={C.green} />
      </>
    ),
    volume: (
      <>
        <rect x="3" y="10" width="26" height="13" rx="3" fill="#fdba74" />
        <rect x="3" y="17" width="26" height="6" rx="3" fill="#f97316" />
        <circle cx="24" cy="20" r="1.5" fill="#fff" />
      </>
    ),
    back: disc('M18 9l-7 7 7 7'),
    forward: disc('M14 9l7 7-7 7'),
    go: disc('M9 16h13M17 10l6 6-6 6'),
    up: (
      <>
        {folder}
        <circle cx="16" cy="19" r="6" fill={C.green} />
        <path d="M16 22.5v-7M13 18.5l3-3 3 3" stroke="#fff" strokeWidth="2" {...round} />
      </>
    ),
    newFolder: (
      <>
        {folder}
        {plus}
      </>
    ),
    newFile: page(plus),
    terminal: (
      <>
        <rect x="2" y="5" width="28" height="22" rx="3" fill={C.ink} />
        <path d="m8 13 4 3-4 3M14 21h8" stroke="#4ade80" strokeWidth="2.2" {...round} />
      </>
    ),
    folders: (
      <>
        <path d="M7 5v17M7 10h4M7 22h4" stroke="#94a3b8" strokeWidth="2" {...round} />
        <rect x="12" y="6" width="16" height="8" rx="2" fill="#fcc93f" />
        <rect x="12" y="18" width="16" height="8" rx="2" fill="#fcc93f" />
      </>
    ),
    search: (
      <>
        <circle cx="14" cy="14" r="8" fill="#bfdbfe" stroke={C.blue} strokeWidth="3" />
        <path d="m20 20 7 7" stroke="#334155" strokeWidth="4" strokeLinecap="round" />
      </>
    ),
    rename: (
      <>
        <rect x="3" y="10" width="21" height="12" rx="2" fill={C.mist} />
        <path d="M7 16h9" stroke={C.blue} strokeWidth="2.5" {...round} />
        <path d="M27 7v18M24.5 7h5M24.5 25h5" stroke="#334155" strokeWidth="2" {...round} />
      </>
    ),
    trash: (
      <>
        <path d="M8 10h16l-1.5 17a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z" fill="#94a3b8" />
        <rect x="5" y="6" width="22" height="4" rx="2" fill={C.slate} />
        <path d="M13 4h6" stroke={C.slate} strokeWidth="3" strokeLinecap="round" />
        <path d="M13 14v10M19 14v10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    reveal: (
      <>
        {folder}
        <circle cx="16" cy="18.5" r="4.5" fill="#fff" stroke={C.blue} strokeWidth="2.5" />
        <path d="m19.5 22 4 4" stroke={C.blue} strokeWidth="3" strokeLinecap="round" />
      </>
    ),
    error: (
      <>
        <circle cx="16" cy="16" r="14" fill={C.red} />
        <path d="m11 11 10 10M21 11 11 21" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      </>
    ),
    copy: (
      <>
        <rect x="4" y="3" width="16" height="20" rx="2" fill="#cbd5e1" />
        <rect x="12" y="9" width="16" height="20" rx="2" fill={C.blue} />
        <path d="M16 15h8M16 19h8M16 23h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
    open: (
      <>
        <path d="M3 8a2 2 0 0 1 2-2h7l3 3h10a2 2 0 0 1 2 2v16H3z" fill="#f0a830" />
        <path d="M8 13h22l-4 14H3z" fill="#fcc93f" />
      </>
    ),
    theme: (
      <>
        <path d="M16 3C8.8 3 3 8.4 3 15c0 6.1 5 11 11.2 11 1.8 0 2.3-1.3 1.6-2.6-.8-1.5.1-3.4 2-3.4H22c4 0 7-3 7-6.6C29 7.6 23.2 3 16 3z" fill="#fde68a" />
        <circle cx="9" cy="14" r="2.3" fill={C.red} />
        <circle cx="13" cy="8.5" r="2.3" fill={C.blue} />
        <circle cx="20" cy="8.5" r="2.3" fill={C.green} />
        <circle cx="24.5" cy="13.5" r="2.3" fill={C.violet} />
      </>
    ),
    group: (
      <>
        <rect x="3" y="3" width="26" height="7" rx="2" fill={C.amber} />
        <rect x="3" y="12.5" width="26" height="7" rx="2" fill={C.blue} />
        <rect x="3" y="22" width="26" height="7" rx="2" fill={C.green} />
        <path d="M7 6.5h10M7 16h14M7 25.5h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    git: (
      <>
        <path d="M10 8v16M22 12c0 6-12 4-12 10" stroke={C.slate} strokeWidth="2.6" {...round} />
        <circle cx="10" cy="6.5" r="3.6" fill={C.blue} />
        <circle cx="22" cy="10" r="3.6" fill={C.amber} />
        <circle cx="10" cy="25.5" r="3.6" fill={C.green} />
      </>
    ),
    games: (
      <>
        <path d="M9 9h14a7 7 0 0 1 7 7v2a6 6 0 0 1-10.5 4h-7A6 6 0 0 1 2 18v-2a7 7 0 0 1 7-7z" fill={C.violet} />
        <path d="M9 13v6M6 16h6" stroke="#fff" strokeWidth="2.2" {...round} />
        <circle cx="21" cy="15" r="1.7" fill="#fff" />
        <circle cx="25" cy="18" r="1.7" fill="#fff" />
      </>
    ),
    stocks: (
      <>
        <rect x="3" y="4" width="26" height="24" rx="4" fill={C.green} />
        <path d="M7.5 21.5l5-5 4 3 8-9M20 10.5h4.5V15" stroke="#fff" strokeWidth="2.4" {...round} />
      </>
    ),
    note: (
      <>
        <path d="M5 6a2 2 0 0 1 2-2h18a2 2 0 0 1 2 2v14l-8 8H7a2 2 0 0 1-2-2z" fill="#facc15" />
        <path d="M27 20h-6a2 2 0 0 0-2 2v6z" fill="#ca8a04" />
        <path d="M9.5 10h13M9.5 15h13M9.5 20h6" stroke="#fff" strokeWidth="1.8" {...round} />
      </>
    ),
    todo: (
      <>
        <rect x="5" y="3" width="22" height="26" rx="3" fill={C.amber} />
        <path d="M9.5 10.5l2 2 4-4M9.5 18.5l2 2 4-4" stroke="#fff" strokeWidth="2.2" {...round} />
        <path d="M18.5 11h5M18.5 19h5M9.5 25h14" stroke="#fff" strokeWidth="1.8" {...round} />
      </>
    ),
    view: (
      <>
        <rect x="4" y="4" width="10" height="10" rx="2" fill={C.blue} />
        <rect x="18" y="4" width="10" height="10" rx="2" fill={C.blue} />
        <rect x="4" y="18" width="10" height="10" rx="2" fill={C.blue} />
        <rect x="18" y="18" width="10" height="10" rx="2" fill={C.sky} />
      </>
    ),
    panes: (
      <>
        {windowFrame}
        <path d="M16 10v17" stroke={C.slate} strokeWidth="2" />
        <path d="M6 15h6M6 19h4M20 15h6M20 19h4" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
    preview: (
      <>
        {windowFrame}
        <path d="M6 15h5M6 19h4M6 23h5" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="15" y="13" width="12" height="11" rx="1.5" fill={C.sky} />
        <path d="M15 24l4-4.5 3 3 2-2 3 3.5z" fill="#16a34a" />
      </>
    ),
    automation: (
      <>
        <path d="M8 9a10 10 0 0 1 18 6" stroke={C.blue} strokeWidth="3" {...round} />
        <path d="m22 11 4 4 3-6" stroke={C.blue} strokeWidth="2.5" {...round} />
        <path d="M24 23A10 10 0 0 1 6 17" stroke={C.green} strokeWidth="3" {...round} />
        <path d="m10 21-4-4-3 6" stroke={C.green} strokeWidth="2.5" {...round} />
        <path d="m14 11.5 6.5 4.5-6.5 4.5z" fill={C.amber} />
      </>
    ),
    console: (
      <>
        <rect x="2" y="4" width="28" height="22" rx="3" fill={C.ink} />
        <path d="m7 13 4 3-4 3M13 20h5" stroke="#4ade80" strokeWidth="2" {...round} />
        {sparkle(24, 17, 4.5, '#fb923c')}
      </>
    ),
    ai: (
      <>
        {sparkle(13, 12, 9, C.violet)}
        {sparkle(24, 21.5, 4.5, C.amber)}
        <circle cx="25" cy="7" r="2" fill={C.sky} />
      </>
    ),
    remote: (
      <>
        <path d="M9 22a6 6 0 0 1-.6-12A8 8 0 0 1 24 9.5a5.5 5.5 0 0 1 .5 11z" fill="#bfdbfe" />
        <rect x="9" y="18" width="14" height="10" rx="2" fill="#475569" />
        <circle cx="12.5" cy="23" r="1.3" fill="#4ade80" />
        <path d="M15.5 23h4.5" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
    star: <path d="M16 3l3.9 8.1 8.8 1.2-6.4 6.1 1.6 8.8L16 23l-7.9 4.2 1.6-8.8-6.4-6.1 8.8-1.2z" fill="#fbbf24" strokeLinejoin="round" />,
    help: (
      <>
        <circle cx="16" cy="16" r="13" fill={C.blue} />
        <path d="M12 12.5a4 4 0 1 1 5.6 3.7c-1 .5-1.6 1.3-1.6 2.4V20" stroke="#fff" strokeWidth="3" {...round} />
        <circle cx="16" cy="24.2" r="1.9" fill="#fff" />
      </>
    ),
    tools: (
      <>
        <path d="M12 10V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" stroke={C.slate} strokeWidth="2.2" {...round} />
        <rect x="3" y="10" width="26" height="18" rx="3" fill={C.red} />
        <path d="M3 16h26" stroke="#b91c1c" strokeWidth="1.5" />
        <rect x="13.5" y="14" width="5" height="4" rx="1" fill="#fff" />
      </>
    ),
    feedback: (
      <>
        <path d="M5 4h22a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 27 22H14.5L8 27.5V22H5a2.5 2.5 0 0 1-2.5-2.5v-13A2.5 2.5 0 0 1 5 4z" fill={C.blue} />
        <path d="M16 8.5v6.5" stroke="#fff" strokeWidth="2.8" {...round} />
        <circle cx="16" cy="18.6" r="1.7" fill="#fff" />
      </>
    ),
    // One gear outline with eight tapered teeth; the hub is a real hole (evenodd), so dark themes show through.
    settings: (
      <path
        d="M13.93 5.60 14.33 1.90 17.67 1.90 18.07 5.60 21.89 7.19 24.79 4.85 27.15 7.21 24.81 10.11 26.40 13.93 30.10 14.33 30.10 17.67 26.40 18.07 24.81 21.89 27.15 24.79 24.79 27.15 21.89 24.81 18.07 26.40 17.67 30.10 14.33 30.10 13.93 26.40 10.11 24.81 7.21 27.15 4.85 24.79 7.19 21.89 5.60 18.07 1.90 17.67 1.90 14.33 5.60 13.93 7.19 10.11 4.85 7.21 7.21 4.85 10.11 7.19ZM20.6 16a4.6 4.6 0 1 0 -9.2 0a4.6 4.6 0 1 0 9.2 0Z"
        fill={C.slate}
        fillRule="evenodd"
        stroke={C.slate}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    ),
    calculator: (
      <>
        <rect x="6" y="2.5" width="20" height="27" rx="3.5" fill={C.slate} />
        <rect x="9" y="5.5" width="14" height="6" rx="1.5" fill="#bbf7d0" />
        {[14.5, 19.5, 24.5].flatMap((y) => [9, 14, 19].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="3" rx="1" fill={x === 19 && y === 24.5 ? C.amber : '#fff'} />))}
      </>
    ),
    ruler: (
      <g transform="rotate(-45 16 16)">
        <rect x="1" y="11" width="30" height="10" rx="2" fill={C.amber} />
        <path d="M5 11v4M9 11v2.5M13 11v4M17 11v2.5M21 11v4M25 11v2.5" stroke="#fff" strokeWidth="1.6" />
      </g>
    ),
    checksum: (
      <>
        <path d="M16 2.5 27 6.5V15c0 7-5 12-11 14.5C10 27 5 22 5 15V6.5z" fill={C.green} />
        <path d="m10.5 15.5 4 4 7-8" stroke="#fff" strokeWidth="3" {...round} />
      </>
    ),
    convert: (
      <>
        <rect x="2" y="4" width="22" height="17" rx="2" fill={C.sky} />
        <path d="M2 19l6-6 4 4 3-3 9 7v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#16a34a" />
        <circle cx="18" cy="9" r="2" fill="#fde047" />
        <circle cx="24" cy="24" r="7" fill={C.amber} />
        <path d="M20.5 22.5h7l-2-2M27.5 25.5h-7l2 2" stroke="#fff" strokeWidth="1.8" {...round} />
      </>
    ),
    duplicates: (
      <>
        <rect x="3" y="2" width="15" height="19" rx="2" fill="#cbd5e1" />
        <rect x="11" y="9" width="15" height="19" rx="2" fill={C.blue} />
        <path d="M14.5 14h8M14.5 17.5h8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="24" cy="24" r="6" fill={C.red} />
        <path d="M21 22.5h6M21 25.5h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
    diskMap: (
      <>
        <rect x="3" y="4" width="13" height="24" rx="2" fill={C.blue} />
        <rect x="17.5" y="4" width="11.5" height="11" rx="2" fill={C.green} />
        <rect x="17.5" y="16.5" width="5.5" height="11.5" rx="1.5" fill={C.amber} />
        <rect x="24.5" y="16.5" width="4.5" height="5" rx="1.5" fill={C.red} />
        <rect x="24.5" y="23" width="4.5" height="5" rx="1.5" fill={C.violet} />
      </>
    ),
    json: page(
      <path
        d="M13.5 13c-2 0-2.5 1-2.5 2.5V17c0 1-.6 1.6-1.6 1.6 1 0 1.6.6 1.6 1.6v1.3c0 1.5.5 2.5 2.5 2.5M19.5 13c2 0 2.5 1 2.5 2.5V17c0 1 .6 1.6 1.6 1.6-1 0-1.6.6-1.6 1.6v1.3c0 1.5-.5 2.5-2.5 2.5"
        stroke={C.violet}
        strokeWidth="2"
        {...round}
      />
    ),
    encoding: (
      <>
        <rect x="2" y="3" width="14" height="14" rx="3" fill={C.blue} />
        <text x="9" y="14" fontSize="11" fontWeight="bold" fill="#fff" textAnchor="middle" fontFamily="system-ui, sans-serif">A</text>
        <rect x="16" y="15" width="14" height="14" rx="3" fill={C.amber} />
        <text x="23" y="26" fontSize="11" fontWeight="bold" fill="#fff" textAnchor="middle" fontFamily="system-ui, sans-serif">%</text>
        <path d="M8 19.5v2.5a2 2 0 0 0 2 2h3.5M11.5 21.5l2.5 2.5-2.5 2.5" stroke={C.slate} strokeWidth="1.8" {...round} />
      </>
    ),
    dice: (
      <>
        <rect x="4" y="4" width="24" height="24" rx="5" fill={C.red} />
        {[[10, 10], [22, 10], [16, 16], [10, 22], [22, 22]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.3" fill="#fff" />)}
      </>
    ),
    regex: (
      <>
        <rect x="2" y="5" width="28" height="22" rx="4" fill={C.blue} />
        <circle cx="10" cy="21" r="2.6" fill="#fff" />
        <path d="M20 9v10M15.7 11.5l8.6 5M15.7 16.5l8.6-5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </>
    ),
    clock: (
      <>
        <circle cx="16" cy="16" r="14" fill={C.blue} />
        <circle cx="16" cy="16" r="10.5" fill="#fff" />
        <path d="M16 9.5V16l4.5 3" stroke={C.ink} strokeWidth="2.4" {...round} />
      </>
    ),
    colors: (
      <g fillOpacity="0.85">
        <circle cx="16" cy="11" r="8" fill={C.red} />
        <circle cx="11" cy="20" r="8" fill={C.green} />
        <circle cx="21" cy="20" r="8" fill={C.blue} />
      </g>
    ),
    clipboard: (
      <>
        <rect x="5" y="5" width="22" height="25" rx="3" fill="#d97706" />
        <rect x="8" y="8" width="16" height="19" rx="1.5" fill="#fff" />
        <rect x="11.5" y="2.5" width="9" height="5" rx="2" fill={C.slate} />
        <path d="M11.5 13h9M11.5 17h9M11.5 21h5" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
    stopwatch: (
      <>
        <rect x="13" y="1.5" width="6" height="3.5" rx="1.5" fill={C.slate} />
        <path d="M24 8.5l2-2" stroke={C.slate} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="16" cy="18" r="12" fill={C.red} />
        <circle cx="16" cy="18" r="9" fill="#fff" />
        <path d="M16 18v-6" stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" />
      </>
    ),
    globe: (
      <>
        <circle cx="16" cy="16" r="14" fill={C.blue} />
        <path d="M8 9c3 1 5 0 6 2s-2 3-1 5 4 1 4 4-2 4-1 6M20 5c-1 2 1 3 3 3s3 2 5 2M22 17c2 0 3 1 3 3s-1 3-3 4" stroke={C.green} strokeWidth="2.8" {...round} />
        <ellipse cx="16" cy="16" rx="6" ry="14" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.4" fill="none" />
        <path d="M2 16h28" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.4" />
      </>
    ),
    scratchpad: (
      <>
        <rect x="3" y="5" width="20" height="24" rx="2.5" fill={C.mist} />
        <path d="M6 3v4M10 3v4M14 3v4M18 3v4" stroke={C.slate} strokeWidth="2" strokeLinecap="round" />
        <path d="M6.5 12h13M6.5 16h13M6.5 20h8" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
        <path d="m26.5 8 3 3-12 12-4 1 1-4z" fill={C.amber} />
        <path d="m13.5 24 1-4 3 3z" fill={C.ink} />
      </>
    ),
    docker: (
      <>
        <path d="M2 17h25.5c.8-1.6 2.3-2.6 4-2.5-.3 1.5-1.2 2.6-2.6 3C27.3 23 22 27.5 14.5 27.5 7.5 27.5 3 23.5 2 17z" fill="#2496ed" />
        {[[4.5, 12.5], [9.5, 12.5], [14.5, 12.5], [19.5, 12.5], [9.5, 8], [14.5, 8], [14.5, 3.5]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="4.2" height="3.8" rx="0.8" fill="#2496ed" />)}
        <circle cx="8" cy="21" r="1.2" fill="#fff" />
      </>
    ),
    monitor: (
      <>
        <rect x="2" y="4" width="28" height="22" rx="3" fill={C.ink} />
        <path d="M4.5 17h4.5l2-6 4 11 3-8 2 3h7.5" stroke="#4ade80" strokeWidth="2.2" {...round} />
        <path d="M11 29h10" stroke={C.slate} strokeWidth="2.2" strokeLinecap="round" />
      </>
    )
  }
}
