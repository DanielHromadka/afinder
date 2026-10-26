import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t, type MessageKey } from '@shared/i18n'
import { layoutGraph, STATE_LETTER, type CommitDetails, type GraphCommit, type GraphRow, type RepoChange, type RepoState } from '@shared/git'
import { formatDate, formatRelative } from '@renderer/lib/format'
import { Dialog } from './Dialog'
import { GitDiffView } from './GitDiffView'

const api = window.api
const ROW = 24
const LANE = 14
/** Wider graphs scroll inside their column rather than squeezing the subjects. */
const MAX_LANES = 16
const PAGE = 400
const COLORS = ['#1f77d0', '#d9480f', '#2f9e44', '#ae3ec9', '#e8590c', '#0c8599', '#c2255c', '#5c7cfa']
const color = (lane: number): string => COLORS[lane % COLORS.length]
const x = (lane: number): number => LANE / 2 + 1 + lane * LANE

/** Lines and the dot of one row; curves where a lane joins or leaves the dot. */
function GraphCell({ row, width }: { row: GraphRow; width: number }): React.JSX.Element {
  const { lane } = row
  const mid = ROW / 2
  return (
    <svg className="git-graph-cell" width={width * LANE + 2} height={ROW} aria-hidden>
      {row.through.map((i) => (
        <line key={`t${i}`} x1={x(i)} y1={0} x2={x(i)} y2={ROW} stroke={color(i)} />
      ))}
      {row.joins.map((i) => (
        <path key={`j${i}`} d={`M${x(i)} 0 C${x(i)} ${mid * 0.7} ${x(lane)} ${mid * 0.4} ${x(lane)} ${mid}`} stroke={color(i)} fill="none" />
      ))}
      {row.parents.map((i) => (
        <path key={`p${i}`} d={`M${x(lane)} ${mid} C${x(lane)} ${mid * 1.6} ${x(i)} ${mid * 1.3} ${x(i)} ${ROW}`} stroke={color(i === lane ? lane : i)} fill="none" />
      ))}
      <circle cx={x(lane)} cy={mid} r={row.commit.parents.length > 1 ? 3.5 : 4} fill={row.commit.parents.length > 1 ? 'var(--list-bg, #fff)' : color(lane)} stroke={color(lane)} strokeWidth={1.5} />
    </svg>
  )
}

/** "HEAD -> main" → HEAD + main, "tag: v1" → a tag, remote branches marked as such. */
function RefBadges({ refs, remotes }: { refs: string[]; remotes: Set<string> }): React.JSX.Element | null {
  if (refs.length === 0) return null
  const badges = refs.flatMap((r): { label: string; kind: string }[] => {
    if (r.startsWith('HEAD -> ')) return [{ label: 'HEAD', kind: 'head' }, { label: r.slice(8), kind: 'local' }]
    if (r === 'HEAD') return [{ label: 'HEAD', kind: 'head' }]
    if (r.startsWith('tag: ')) return [{ label: r.slice(5), kind: 'tag' }]
    return [{ label: r, kind: remotes.has(r) ? 'remote' : 'local' }]
  })
  return (
    <>
      {badges.map((b) => (
        <span key={`${b.kind}:${b.label}`} className={`git-ref ${b.kind}`}>
          {b.label}
        </span>
      ))}
    </>
  )
}

interface Props {
  cwd: string
  repo: RepoState
  showError(err: unknown): void
  onClose(): void
}

/** The history of one branch or all of them as a graph, with the details and file diffs of a commit. */
export function GitGraphDialog({ cwd, repo, showError, onClose }: Props): React.JSX.Element {
  /** null = all branches. */
  const [ref, setRef] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [commits, setCommits] = useState<GraphCommit[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [file, setFile] = useState<RepoChange | null>(null)
  const [nonce, setNonce] = useState(0)
  const scroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    api.gitGraph(cwd, ref, limit).then(
      (list) => live && setCommits(list),
      (err) => live && (showError(err), setCommits([]))
    )
    return () => {
      live = false
    }
  }, [cwd, ref, limit, nonce, showError])

  useEffect(() => {
    setDetails(null)
    setFile(null)
    if (!selected) return
    let live = true
    api.gitCommit(cwd, selected).then((d) => live && setDetails(d), (err) => live && showError(err))
    return () => {
      live = false
    }
  }, [cwd, selected, showError])

  const rows = useMemo(() => layoutGraph(commits ?? []), [commits])
  const lanes = Math.min(MAX_LANES, Math.max(1, ...rows.map((r) => r.width)))
  const remotes = useMemo(() => new Set(repo.remoteBranches), [repo.remoteBranches])
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => ROW, overscan: 20 })

  const choose = (next: string | null): void => {
    setRef(next)
    setLimit(PAGE)
    setSelected(null)
    setCommits(null)
  }

  const move = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rows.findIndex((r) => r.commit.hash === selected)
    const next = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    if (rows[next]) {
      setSelected(rows[next].commit.hash)
      virtualizer.scrollToIndex(next)
    }
  }

  const repoName = repo.root.split(/[\\/]/).pop() ?? repo.root
  return (
    <Dialog title={t('git.graphTitle', { repo: repoName })} className="git-graph-dialog" onClose={onClose} onEscape={() => (file ? setFile(null) : onClose())} resizable>
        <div className="git-diff-bar">
          <label className="git-graph-ref">
            {t('git.graphBranch')}
            <select value={ref ?? ''} onChange={(e) => choose(e.target.value || null)}>
              <option value="">{t('git.allBranches')}</option>
              {repo.branches.length > 0 && (
                <optgroup label={t('git.localBranches')}>
                  {repo.branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </optgroup>
              )}
              {repo.remoteBranches.length > 0 && (
                <optgroup label={t('git.remoteBranches')}>
                  {repo.remoteBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <span className="git-diff-label">{commits ? t('git.commitCount', { n: commits.length }) : '…'}</span>
          <div className="toolbar-spacer" />
          {commits && commits.length === limit && (
            <button className="xp-button" onClick={() => setLimit(limit + PAGE)}>
              {t('git.loadMore')}
            </button>
          )}
          <button className="xp-button" onClick={() => setNonce(nonce + 1)}>
            {t('git.refresh')}
          </button>
        </div>
        <div className="git-graph-list" ref={scroll} tabIndex={0} onKeyDown={move}>
          {commits && rows.length === 0 && <div className="git-diff-note">{t('git.noCommits')}</div>}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]
              const c = row.commit
              return (
                <div
                  key={c.hash}
                  className={`git-graph-row${c.hash === selected ? ' selected' : ''}`}
                  style={{ transform: `translateY(${v.start}px)` }}
                  title={`${c.hash}\n${c.author}`}
                  onClick={() => setSelected(c.hash)}
                >
                  <span className="git-graph-lanes" style={{ width: lanes * LANE + 2 }}>
                    <GraphCell row={row} width={Math.max(lanes, row.width)} />
                  </span>
                  <span className="git-graph-subject">
                    <RefBadges refs={c.refs} remotes={remotes} />
                    {c.subject}
                  </span>
                  <span className="git-graph-author">{c.author}</span>
                  <span className="git-graph-when" title={formatDate(c.time)}>{formatRelative(c.time)}</span>
                  <span className="git-hash">{c.short}</span>
                </div>
              )
            })}
          </div>
        </div>
        {selected && (
          <div className="git-graph-details">
            {!details ? (
              <div className="git-diff-note">…</div>
            ) : file ? (
              <>
                <div className="git-diff-bar">
                  <button className="xp-button" onClick={() => setFile(null)}>
                    ← {t('git.back')}
                  </button>
                  <span className="git-diff-label" title={file.from ? `${file.from} → ${file.path}` : file.path}>
                    {file.path}
                  </span>
                </div>
                <GitDiffView cwd={cwd} source={{ kind: 'commit', hash: details.hash, path: file.path, ...(file.from ? { from: file.from } : {}) }} inline={false} />
              </>
            ) : (
              <div className="git-commit-details">
                <div className="git-commit-meta">
                  <pre className="git-commit-message">{details.message}</pre>
                  <div>
                    {details.author} &lt;{details.email}&gt; · {formatDate(details.time)}
                  </div>
                  <div className="git-commit-hashes">
                    <button className="xp-button" title={t('git.copyHash')} onClick={() => void api.copyText(details.hash).catch(showError)}>
                      {details.hash.slice(0, 12)} ⧉
                    </button>
                    {details.parents.length > 0 && (
                      <span>
                        {t('git.parents')}: {details.parents.map((p) => p.slice(0, 7)).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="git-commit-files">
                  <div className="git-section-head">
                    <span>
                      {t('git.filesChanged')} <span className="git-count">{details.files.length}</span>
                    </span>
                  </div>
                  {details.files.map((f) => {
                    const slash = f.path.lastIndexOf('/')
                    return (
                      <div key={f.path} className={`git-file ${f.state}`} title={f.from ? `${f.from} → ${f.path}` : f.path} onClick={() => setFile(f)}>
                        <span className="git-file-name">{f.path.slice(slash + 1)}</span>
                        <span className="git-file-dir">{slash > 0 ? f.path.slice(0, slash) : ''}</span>
                        <span className="git-state" title={t(`git.state.${f.state}` as MessageKey)}>{STATE_LETTER[f.state]}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
    </Dialog>
  )
}
