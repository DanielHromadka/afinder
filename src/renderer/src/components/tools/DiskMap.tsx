import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { squarify } from '@shared/tools/treemap'
import type { DiskNode } from '@shared/types'
import { formatSize } from '@renderer/lib/format'
import { api, PathField, Progress, ToolError, useJob, type ToolProps } from './common'

/** A stable hue per file extension, so the same kinds of files share a colour. */
function hue(name: string): number {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  let h = 0
  for (const c of ext) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** What takes the space below a folder, as a treemap; a click on a folder zooms into it. */
export default function DiskMap({ folder }: Pick<ToolProps, 'folder'>): React.JSX.Element {
  const [dir, setDir] = useState(folder)
  // The path from the scanned folder to the one shown.
  const [trail, setTrail] = useState<DiskNode[]>([])
  const job = useJob<DiskNode>()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [trail.length > 0])

  const scan = async (path: string, keep: DiskNode[] = []): Promise<void> => {
    const node = await job.run((id) => api.tools.diskTree(id, path))
    if (node) setTrail([...keep, node])
  }
  const node = trail[trail.length - 1]
  const open = (child: DiskNode): void => {
    if (!child.dir) return void api.reveal(child.path)
    // Deeper than the scanned levels: scan from there, keeping the way back.
    if (child.children) setTrail([...trail, child])
    else void scan(child.path, trail)
  }
  useEffect(() => setTrail([]), [dir])

  const items = node?.children ?? []
  const rects = squarify(
    items.map((c) => c.size),
    { x: 0, y: 0, w: size.w, h: size.h }
  )

  return (
    <div className="tool disk">
      <PathField value={dir} onChange={setDir} kind="folder" folder={folder} />
      {job.busy ? (
        <Progress progress={job.progress} onCancel={job.cancel} />
      ) : (
        <div className="tool-row">
          <button className="todo-btn" disabled={!dir.trim()} onClick={() => void scan(dir.trim())}>
            {t('tools.scan')}
          </button>
        </div>
      )}
      <ToolError text={job.error} />
      {node && (
        <>
          <div className="tool-row disk-trail">
            {trail.map((n, i) => (
              <button key={n.path} className="link-button" disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>
                {n.name}
              </button>
            ))}
            <span className="tool-muted">
              {formatSize(node.size)} · {t('tools.filesCount', { count: (node.files ?? 0).toLocaleString() })}
            </span>
          </div>
          <div className="disk-map" ref={box}>
            {items.map((c, i) => {
              const r = rects[i]
              if (r.w < 2 || r.h < 2) return null
              const label = c.other ? t('tools.diskOther', { count: c.other }) : c.name
              return (
                <button
                  key={c.path || `other-${i}`}
                  className={`disk-box${c.dir ? ' dir' : ''}${c.other ? ' other' : ''}`}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, ...(c.dir || c.other ? {} : { background: `hsl(${hue(c.name)} 55% 62%)` }) }}
                  title={`${c.path || label}\n${formatSize(c.size)}`}
                  disabled={!!c.other}
                  onClick={() => open(c)}
                >
                  {r.w > 46 && r.h > 18 && (
                    <span>
                      {label}
                      {r.h > 32 && <small>{formatSize(c.size)}</small>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
