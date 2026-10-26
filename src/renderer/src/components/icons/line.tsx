// Line: monochrome outlines in currentColor, so they take the theme's text colour (and the
// selection colour on selected rows). Stroke styling comes from the shared frame.
import type { IconSet } from '../Icon'

const dot = (cx: number, cy: number, r = 1.2): React.ReactNode => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />

const folder = <path d="M4 9a2 2 0 0 1 2-2h6l3 3h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />

const page = (badge: React.ReactNode): React.ReactNode => (
  <>
    <path d="M8 3h11l6 6v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M19 3v6h6" />
    {badge}
  </>
)

const sparkle = (x: number, y: number, r: number): React.ReactNode => (
  <path d={`M${x} ${y - r}l${r * 0.27} ${r * 0.73} ${r * 0.73} ${r * 0.27}-${r * 0.73} ${r * 0.27}-${r * 0.27} ${r * 0.73}-${r * 0.27}-${r * 0.73}-${r * 0.73}-${r * 0.27} ${r * 0.73}-${r * 0.27}z`} />
)

const windowFrame = <rect x="3" y="5" width="26" height="22" rx="2.5" />

export const line: IconSet = {
  frame: { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  paths: {
    folder,
    app: (
      <>
        <rect x="5" y="5" width="22" height="22" rx="5" />
        <path d="M11.5 21.5 16 10.5l4.5 11M13 18h6" />
      </>
    ),
    image: page(
      <>
        {dot(12.5, 15, 1.5)}
        <path d="m10 24 4-4 2.5 2.5 3-3.5 2 2.5" />
      </>
    ),
    audio: page(
      <>
        <path d="M13.5 23.5v-9l7-2v9" />
        {dot(12, 23.5, 1.8)}
        {dot(19, 21.5, 1.8)}
      </>
    ),
    video: page(<path d="M13 15v8l6-4z" />),
    pdf: page(<text x="15.5" y="22.5" fontSize="6.5" fontWeight="bold" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="system-ui, sans-serif">PDF</text>),
    text: page(<path d="M10 15h11M10 19h11M10 23h7" />),
    code: page(<path d="m13 15-3 4 3 4M19 15l3 4-3 4" />),
    archive: page(
      <>
        <path d="M14 4v1.5M14 8v1.5M14 12v1.5" />
        <rect x="12" y="16" width="4" height="6" rx="1" />
      </>
    ),
    document: page(<path d="m10 15 2 8 3.5-6 3.5 6 2-8" />),
    other: page(null),
    home: (
      <>
        <path d="M4 15 16 5l12 10" />
        <path d="M7 13v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V13" />
        <path d="M13 27v-7h6v7" />
      </>
    ),
    desktop: (
      <>
        <rect x="3" y="5" width="26" height="17" rx="2" />
        <path d="M11 27h10M16 22v5" />
      </>
    ),
    documents: (
      <>
        {folder}
        <path d="M10 16h12M10 20h8" />
      </>
    ),
    downloads: (
      <>
        {folder}
        <path d="M16 13v9M12.5 18.5 16 22l3.5-3.5" />
      </>
    ),
    apps: (
      <>
        <rect x="4" y="4" width="10" height="10" rx="3" />
        <rect x="18" y="4" width="10" height="10" rx="3" />
        <rect x="4" y="18" width="10" height="10" rx="3" />
        <rect x="18" y="18" width="10" height="10" rx="3" />
      </>
    ),
    disk: (
      <>
        <rect x="3" y="10" width="26" height="12" rx="2" />
        <path d="M3 16h26" />
        {dot(24, 19)}
      </>
    ),
    volume: (
      <>
        <rect x="3" y="10" width="26" height="12" rx="6" />
        <path d="M9 16h8" />
        {dot(23, 16)}
      </>
    ),
    back: <path d="M26 16H6M13 9l-7 7 7 7" />,
    forward: <path d="M6 16h20M19 9l7 7-7 7" />,
    up: <path d="M16 26V6M9 13l7-7 7 7" />,
    go: (
      <>
        <circle cx="16" cy="16" r="12" />
        <path d="M10 16h11M17 11.5l4.5 4.5-4.5 4.5" />
      </>
    ),
    newFolder: (
      <>
        {folder}
        <path d="M16 13v8M12 17h8" />
      </>
    ),
    newFile: page(<path d="M15.5 14v8M11.5 18h8" />),
    terminal: (
      <>
        <rect x="3" y="5" width="26" height="22" rx="3" />
        <path d="m9 13 4 3-4 3M15 20h7" />
      </>
    ),
    folders: (
      <>
        <path d="M6 4v18M6 9.5h5M6 21.5h5" />
        <rect x="12" y="6" width="15" height="7" rx="1.5" />
        <rect x="12" y="18" width="15" height="7" rx="1.5" />
      </>
    ),
    search: (
      <>
        <circle cx="14" cy="14" r="8" />
        <path d="m20 20 7 7" />
      </>
    ),
    rename: (
      <>
        <path d="M21 10H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16" />
        <path d="M8 16h7" />
        <path d="M26 7v18M23.5 7h5M23.5 25h5" />
      </>
    ),
    trash: <path d="M5 8h22M13 8V5h6v3M8 8l1.5 19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2L24 8M13.5 13v11M18.5 13v11" />,
    reveal: (
      <>
        {folder}
        <circle cx="15" cy="17.5" r="3.5" />
        <path d="m17.5 20 3 3" />
      </>
    ),
    error: (
      <>
        <circle cx="16" cy="16" r="12" />
        <path d="m11.5 11.5 9 9M20.5 11.5l-9 9" />
      </>
    ),
    copy: (
      <>
        <rect x="11" y="11" width="16" height="17" rx="2" />
        <path d="M21 11V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h4" />
      </>
    ),
    open: <path d="M4 26V8a2 2 0 0 1 2-2h6l3 3h9a2 2 0 0 1 2 2v3M4 26l4.5-12H30l-4.5 12z" />,
    theme: (
      <>
        <path d="M16 3C8.8 3 3 8.4 3 15c0 6.1 5 11 11.2 11 1.8 0 2.3-1.3 1.6-2.6-.8-1.5.1-3.4 2-3.4H22c4 0 7-3 7-6.6C29 7.6 23.2 3 16 3z" />
        {dot(9.5, 14, 1.8)}
        {dot(13, 9, 1.8)}
        {dot(19.5, 9, 1.8)}
        {dot(23.5, 13.5, 1.8)}
      </>
    ),
    group: (
      <>
        <rect x="3" y="4" width="26" height="6" rx="1.5" />
        <rect x="3" y="13" width="26" height="6" rx="1.5" />
        <rect x="3" y="22" width="26" height="6" rx="1.5" />
      </>
    ),
    git: (
      <>
        <path d="M10 9.5v13M22 13c0 6-12 3.5-12 9.5" />
        <circle cx="10" cy="6.5" r="3" />
        <circle cx="22" cy="10" r="3" />
        <circle cx="10" cy="25.5" r="3" />
      </>
    ),
    games: (
      <>
        <path d="M9 9h14a7 7 0 0 1 7 7v2a6 6 0 0 1-10.5 4h-7A6 6 0 0 1 2 18v-2a7 7 0 0 1 7-7zM9 13v6M6 16h6" />
        <circle cx="21" cy="15" r="1" />
        <circle cx="25" cy="18" r="1" />
      </>
    ),
    stocks: (
      <>
        <rect x="3" y="4" width="26" height="24" rx="2.5" />
        <path d="M7.5 21.5l5-5 4 3 8-9M20 10.5h4.5V15" />
      </>
    ),
    note: (
      <>
        <path d="M5 4h22v16l-8 8H5z" />
        <path d="M27 20h-6a2 2 0 0 0-2 2v6M9.5 10h13M9.5 15h13M9.5 20h6" />
      </>
    ),
    todo: (
      <>
        <rect x="5" y="3" width="22" height="26" rx="2.5" />
        <path d="M9.5 10.5l2 2 4-4M9.5 18.5l2 2 4-4M18.5 11h5M18.5 19h5M9.5 25h14" />
      </>
    ),
    view: (
      <>
        <rect x="4" y="4" width="10" height="10" rx="1" />
        <rect x="18" y="4" width="10" height="10" rx="1" />
        <rect x="4" y="18" width="10" height="10" rx="1" />
        <rect x="18" y="18" width="10" height="10" rx="1" />
      </>
    ),
    panes: (
      <>
        {windowFrame}
        <path d="M3 10h26M16 10v17" />
      </>
    ),
    preview: (
      <>
        <path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z" />
        <circle cx="16" cy="16" r="4" />
      </>
    ),
    automation: (
      <>
        <path d="M8 10a10 10 0 0 1 18 5M22 11l4 4 3-5" />
        <path d="M24 22a10 10 0 0 1-18-5M10 21l-4-4-3 5" />
        <path d="m14 12.5 5.5 3.5-5.5 3.5z" />
      </>
    ),
    console: (
      <>
        {windowFrame}
        <path d="M3 10h26" />
        <path d="m8 15 3 2.5L8 20M13 21h4" />
        {sparkle(23.5, 18, 4)}
      </>
    ),
    ai: (
      <>
        {sparkle(13, 12.5, 9)}
        {sparkle(24, 22, 4.5)}
        {dot(25, 6.5, 1.6)}
      </>
    ),
    remote: (
      <>
        <path d="M9 20a6 6 0 0 1-.6-12A8 8 0 0 1 24 7.5a5.5 5.5 0 0 1 1.5 10.7" />
        <rect x="10" y="17" width="13" height="10" rx="1.5" />
        {dot(13.5, 22)}
        <path d="M16.5 22h3.5" />
      </>
    ),
    star: <path d="M16 3.5l3.8 7.8 8.5 1.2-6.2 6 1.5 8.5L16 23l-7.6 4 1.5-8.5-6.2-6 8.5-1.2z" />,
    help: (
      <>
        <circle cx="16" cy="16" r="12.5" />
        <path d="M12 12.5a4 4 0 1 1 5.6 3.7c-1 .5-1.6 1.3-1.6 2.4V20" />
        {dot(16, 23.6, 1.5)}
      </>
    ),
    tools: (
      <>
        <path d="M4 10.5h24v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
        <path d="M12 10.5V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3.5M4 16h24M14 14.5v3h4v-3" />
      </>
    ),
    feedback: (
      <>
        <path d="M5 4h22a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 27 22H14.5L8 27.5V22H5a2.5 2.5 0 0 1-2.5-2.5v-13A2.5 2.5 0 0 1 5 4z" />
        <path d="M16 9v5.5" />
        {dot(16, 18.3, 1.4)}
      </>
    ),
    settings: (
      <>
        <circle cx="16" cy="16" r="4" />
        <circle cx="16" cy="16" r="8.5" />
        <path d="M16 3v4.5M16 24.5V29M3 16h4.5M24.5 16H29M6.8 6.8l3.2 3.2M22 22l3.2 3.2M6.8 25.2l3.2-3.2M22 10l3.2-3.2" />
      </>
    ),
    calculator: (
      <>
        <rect x="6" y="3" width="20" height="26" rx="3" />
        <rect x="10" y="7" width="12" height="5" rx="1" />
        {[16.5, 20.5, 24.5].flatMap((y) => [11.5, 16, 20.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" stroke="none" />))}
      </>
    ),
    ruler: (
      <g transform="rotate(-45 16 16)">
        <rect x="2" y="11.5" width="28" height="9" rx="1.5" />
        <path d="M7 11.5v3.5M11.5 11.5v2M16 11.5v3.5M20.5 11.5v2M25 11.5v3.5" />
      </g>
    ),
    checksum: (
      <>
        <path d="M16 3 26 6.8V15c0 6.5-4.5 11-10 13.5C10.5 26 6 21.5 6 15V6.8z" />
        <path d="m11.5 15.5 3 3 6-6.5" />
      </>
    ),
    convert: (
      <>
        <path d="M17 21H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v9" />
        <path d="m3 18 5-5 4 4 3-3" />
        {dot(17.5, 9, 1.6)}
        <path d="M20 22.5h8.5l-2.5-2.5M28.5 26.5H20l2.5 2.5" />
      </>
    ),
    duplicates: (
      <>
        <path d="M17 9V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h4" />
        <rect x="11" y="9" width="16" height="20" rx="2" />
        <path d="M15.5 16.5h7M15.5 21h7" />
      </>
    ),
    diskMap: (
      <>
        <rect x="3" y="4" width="26" height="24" rx="2" />
        <path d="M16 4v24M16 15h13M23 15v13M23 21.5h6" />
      </>
    ),
    json: page(<path d="M13.5 13c-2 0-2.5 1-2.5 2.5V17c0 1-.6 1.6-1.6 1.6 1 0 1.6.6 1.6 1.6v1.3c0 1.5.5 2.5 2.5 2.5M18.5 13c2 0 2.5 1 2.5 2.5V17c0 1 .6 1.6 1.6 1.6-1 0-1.6.6-1.6 1.6v1.3c0 1.5-.5 2.5-2.5 2.5" />),
    encoding: (
      <>
        <rect x="3" y="3" width="13" height="13" rx="2" />
        <text x="9.5" y="13.5" fontSize="9.5" fontWeight="bold" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="system-ui, sans-serif">A</text>
        <rect x="16" y="16" width="13" height="13" rx="2" />
        <text x="22.5" y="26.3" fontSize="9.5" fontWeight="bold" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="system-ui, sans-serif">%</text>
        <path d="M8 20v2.5a2 2 0 0 0 2 2h2.5M10.5 22l2.5 2.5-2.5 2.5" />
      </>
    ),
    dice: (
      <>
        <rect x="4.5" y="4.5" width="23" height="23" rx="4.5" />
        {dot(10.5, 10.5, 1.8)}
        {dot(21.5, 10.5, 1.8)}
        {dot(16, 16, 1.8)}
        {dot(10.5, 21.5, 1.8)}
        {dot(21.5, 21.5, 1.8)}
      </>
    ),
    regex: (
      <>
        {dot(9, 22, 2.2)}
        <path d="M20 7v14M14 10.5l12 7M14 17.5l12-7" />
      </>
    ),
    clock: (
      <>
        <circle cx="16" cy="16" r="12.5" />
        <path d="M16 9v7l4.5 3" />
      </>
    ),
    colors: (
      <>
        <circle cx="16" cy="11.5" r="7.5" />
        <circle cx="11.5" cy="19.5" r="7.5" />
        <circle cx="20.5" cy="19.5" r="7.5" />
      </>
    ),
    clipboard: (
      <>
        <path d="M11 5.5H8a2 2 0 0 0-2 2V27a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7.5a2 2 0 0 0-2-2h-3" />
        <rect x="11" y="3" width="10" height="5" rx="1.5" />
        <path d="M11 15h10M11 20h7" />
      </>
    ),
    stopwatch: (
      <>
        <circle cx="16" cy="18" r="11" />
        <path d="M13 3h6M16 3v4M24 9.5l2-2M16 18v-5.5" />
      </>
    ),
    globe: (
      <>
        <circle cx="16" cy="16" r="12.5" />
        <ellipse cx="16" cy="16" rx="5.5" ry="12.5" />
        <path d="M3.5 16h25" />
      </>
    ),
    scratchpad: (
      <>
        <path d="M21 13v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12" />
        <path d="M8 3v4M12.5 3v4M8 13h7M8 18h5" />
        <path d="m26 6.5 3 3-10.5 10.5-4 1 1-4z" />
      </>
    ),
    docker: (
      <>
        <path d="M2 17h25.5c.8-1.6 2.3-2.6 4-2.5-.3 1.5-1.2 2.6-2.6 3C27.3 23 22 27.5 14.5 27.5 7.5 27.5 3 23.5 2 17z" />
        <path d="M4.5 12.5h19v4.5M9.5 12.5V8h9.5v4.5M14.5 8V3.5h4.5V8" />
        {dot(8, 21.5, 1.2)}
      </>
    ),
    monitor: (
      <>
        <rect x="3" y="4" width="26" height="20" rx="2.5" />
        <path d="M6 15h4l2-5 4 10 3-7 1.5 2H26M11 28h10" />
      </>
    )
  }
}
