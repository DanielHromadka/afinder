import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { locale, t } from '@shared/i18n'
import { ancestors, baseName, samePath } from '@shared/paths'
import { dropTargetProps } from '@renderer/lib/dnd'
import { rootLabel } from '@renderer/lib/places'
import { Icon } from './Icon'

interface Props {
  currentPath: string
  homeDir: string
  /** Top-level nodes besides home: "/" on macOS and Linux, the drives on Windows. */
  roots: string[]
  showHidden: boolean
  onNavigate(path: string): void
  dropTarget: string | null
  canDropOn(dest: string): boolean
  onDropTarget(dest: string | null): void
  onDropFiles(files: File[], dest: string, copy: boolean): void
}

type Children = string[] | 'loading' | 'error'

/** Every tab mounts its own tree, so the last one's state is kept here: a new or switched-to tab then starts
 * with the tree already filled in instead of blinking through "Loading…" and losing what was expanded. */
const last = { showHidden: false, expanded: null as Set<string> | null, children: new Map<string, Children>(), scrollTop: 0 }

export function FolderTree(p: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(last.expanded ?? [p.homeDir]))
  const [children, setChildren] = useState<Map<string, Children>>(() =>
    last.showHidden === p.showHidden ? new Map([...last.children].filter(([, k]) => Array.isArray(k))) : new Map()
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const shownHidden = useRef(p.showHidden)

  const load = useCallback(
    async (dir: string) => {
      // Cached children stay on screen while they refresh.
      setChildren((m) => (Array.isArray(m.get(dir)) ? m : new Map(m).set(dir, 'loading')))
      try {
        const listing = await window.api.list(dir)
        const dirs = listing.entries
          .filter((e) => e.isDir && (p.showHidden || !e.hidden))
          .map((e) => e.path)
          .sort((a, b) => baseName(a).localeCompare(baseName(b), locale(), { numeric: true, sensitivity: 'base' }))
        setChildren((m) => new Map(m).set(dir, dirs))
      } catch {
        setChildren((m) => new Map(m).set(dir, 'error'))
      }
    },
    [p.showHidden]
  )

  // Reload everything that is open when hidden-files visibility changes.
  useEffect(() => {
    if (shownHidden.current === p.showHidden) return
    shownHidden.current = p.showHidden
    setChildren(new Map())
  }, [p.showHidden])

  // Refresh the cached folders quietly, they may have changed while another tab was shown.
  useEffect(() => {
    for (const [dir, kids] of children) if (Array.isArray(kids)) void load(dir)
  }, [])

  useEffect(() => {
    Object.assign(last, { showHidden: p.showHidden, expanded, children })
  }, [p.showHidden, expanded, children])

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = last.scrollTop
  }, [])

  // Reveal the current folder: expand all its ancestors.
  useEffect(() => {
    const chain = ancestors(p.currentPath, p.homeDir)
    const root = p.roots.find((r) => ancestors(p.currentPath, r).length > 0)
    const path = chain.length ? chain : root ? ancestors(p.currentPath, root) : []
    setExpanded((s) => {
      const next = new Set(s)
      path.slice(0, -1).forEach((a) => next.add(a))
      return next
    })
  }, [p.currentPath, p.homeDir, p.roots])

  useEffect(() => {
    for (const dir of expanded) if (!children.has(dir)) void load(dir)
  }, [expanded, children, load])

  // Scroll to the current folder once per navigation, as soon as its row exists (ancestors load lazily).
  // Not on every children change: expanding a folder elsewhere would yank the tree back to the current one.
  const reveal = useRef(true)
  useEffect(() => {
    reveal.current = true
  }, [p.currentPath])
  useEffect(() => {
    if (!reveal.current) return
    const row = scrollRef.current?.querySelector('.tree-row.current')
    if (!row) return
    reveal.current = false
    row.scrollIntoView({ block: 'nearest' })
  }, [p.currentPath, children])

  const toggle = (dir: string): void =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })

  const renderNode = (dir: string, depth: number, label?: string): React.ReactNode => {
    const isOpen = expanded.has(dir)
    const kids = children.get(dir)
    const leaf = Array.isArray(kids) && kids.length === 0
    return (
      <div key={dir} className="tree-node" style={{ '--tree-depth': depth } as CSSProperties}>
        <div
          className={`tree-row${samePath(dir, p.currentPath) ? ' current' : ''}${p.dropTarget === dir ? ' drop-target' : ''}`}
          style={{ paddingLeft: `calc(4px + ${depth} * var(--tree-indent))` }}
          title={dir}
          {...dropTargetProps({
            destFor: () => (p.canDropOn(dir) ? dir : null),
            onTarget: p.onDropTarget,
            onDrop: p.onDropFiles
          })}
          onClick={() => p.onNavigate(dir)}
        >
          {/* Classic themes draw +/− from aria-expanded; the macOS theme shows the chevron instead. */}
          <button
            className={`tree-toggle${leaf ? ' leaf' : ''}`}
            aria-expanded={isOpen}
            onClick={(e) => {
              e.stopPropagation()
              toggle(dir)
            }}
          >
            <svg className="tree-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <Icon name={depth === 0 ? (dir === p.homeDir ? 'home' : 'disk') : isOpen ? 'open' : 'folder'} size={16} />
          <span className="tree-label">{label ?? baseName(dir)}</span>
        </div>
        {isOpen && Array.isArray(kids) && kids.length > 0 && (
          <div className="tree-children">{kids.map((k) => renderNode(k, depth + 1))}</div>
        )}
        {isOpen && kids === 'loading' && <div className="tree-note" style={{ paddingLeft: `calc(24px + ${depth} * var(--tree-indent))` }}>{t('tree.loading')}</div>}
      </div>
    )
  }

  return (
    <aside className="foldertree">
      <div className="pane-header">{t('tree.title')}</div>
      <div className="tree-scroll" ref={scrollRef} onScroll={(e) => (last.scrollTop = e.currentTarget.scrollTop)}>
        {renderNode(p.homeDir, 0)}
        {p.roots.map((r) => renderNode(r, 0, rootLabel(r)))}
      </div>
    </aside>
  )
}
