import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t, type MessageKey } from '@shared/i18n'
import { STATE_LETTER, type DiffSource, type GitAction, type RepoChange, type RepoState } from '@shared/git'
import type { TerminalProfile } from '@shared/types'
import { formatRelative } from '@renderer/lib/format'
import { keys } from '@renderer/lib/keys'
import type { MenuItem, MenuState } from './ContextMenu'
import { GitDiffDialog } from './GitDiffDialog'
import { GitGraphDialog } from './GitGraphDialog'

const api = window.api
const POLL_MS = 4000
/** Window event after a git action, so file lists refresh their git badges. */
export const GIT_CHANGED = 'afinder:git-changed'

type Section = 'staged' | 'unstaged' | 'conflicts'

interface Props {
  /** Folder of the focused tab; the panel shows the repository it belongs to. */
  cwd: string
  visible: boolean
  showError(err: unknown): void
  showMenu(menu: MenuState): void
  onOpenConsole(profile: TerminalProfile, cwd: string, prompt?: string): void
  onOpenFolder(path: string): void
}

/**
 * Source control area: the repository of the focused folder – branch, sync with the remote, staging,
 * commit, rebase and the recent history. Every action is a plain git command run by the main process.
 */
export function GitPanel(p: Props): React.JSX.Element {
  const [repo, setRepo] = useState<RepoState | null | undefined>(undefined)
  const [busy, setBusy] = useState<MessageKey | null>(null)
  const [amend, setAmend] = useState(false)
  const [newBranch, setNewBranch] = useState<string | null>(null)
  /** The file whose diff is open, or null. */
  const [diff, setDiff] = useState<DiffSource | null>(null)
  const [graph, setGraph] = useState(false)
  /** Commit message drafts per repository, so switching folders keeps them. */
  const drafts = useRef(new Map<string, string>())
  const [message, setMessageState] = useState('')
  const request = useRef(0)
  const { cwd, visible, showError } = p

  const refresh = useCallback(() => {
    const id = ++request.current
    void api.gitRepo(cwd).then(
      (r) => id === request.current && setRepo(r),
      () => id === request.current && setRepo(null)
    )
  }, [cwd])

  useEffect(() => {
    if (!visible) return
    refresh()
    // Changes made outside the app (an editor, the console) show up while the panel is visible.
    const timer = setInterval(() => document.hasFocus() && refresh(), POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [visible, refresh])

  const root = repo?.root ?? null
  useEffect(() => setMessageState(root ? (drafts.current.get(root) ?? '') : ''), [root])
  const setMessage = (text: string): void => {
    setMessageState(text)
    if (root) drafts.current.set(root, text)
  }

  const run = async (label: MessageKey, ...actions: GitAction[]): Promise<boolean> => {
    setBusy(label)
    try {
      for (const action of actions) await api.gitAction(cwd, action)
      return true
    } catch (err) {
      showError(err)
      return false
    } finally {
      setBusy(null)
      refresh()
      window.dispatchEvent(new Event(GIT_CHANGED))
    }
  }

  if (repo === undefined) return <div className="git-panel"><div className="git-empty">…</div></div>
  if (repo === null)
    return (
      <div className="git-panel">
        <div className="git-empty">
          <p>{t('git.noRepo')}</p>
          <button className="xp-button" disabled={busy !== null} onClick={() => void run('git.init', { type: 'init' })}>
            {t('git.init')}
          </button>
        </div>
      </div>
    )

  const changes = repo.staged.length + repo.unstaged.length + repo.conflicts.length
  const repoName = repo.root.split(/[\\/]/).pop() ?? repo.root

  const commit = async (push: boolean): Promise<void> => {
    const stageAll = repo.staged.length === 0 && !amend
    if (stageAll && !window.confirm(t('git.confirmCommitAll'))) return
    const ok = await run(push ? 'git.commitPush' : 'git.commit', ...(stageAll ? [{ type: 'stageAll' } as const] : []), { type: 'commit', message, amend }, ...(push ? [{ type: 'push' } as const] : []))
    if (ok) {
      setMessage('')
      setAmend(false)
    }
  }
  const canCommit = busy === null && repo.conflicts.length === 0 && (amend || (message.trim() !== '' && changes > 0))

  const menuAt = (e: React.MouseEvent, items: MenuItem[]): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    p.showMenu({ x: e.type === 'contextmenu' ? e.clientX : r.left, y: e.type === 'contextmenu' ? e.clientY : r.bottom + 2, items })
  }

  const branchMenu = (e: React.MouseEvent): void =>
    menuAt(e, [
      ...repo.branches.map((b) => ({ label: b, checked: b === repo.branch, onClick: () => b !== repo.branch && void run('git.checkout', { type: 'checkout', branch: b }) })),
      ...(repo.branches.length ? ['separator' as const] : []),
      { label: t('git.newBranch'), onClick: () => setNewBranch('') }
    ])

  const others = [...repo.branches.filter((b) => b !== repo.branch), ...repo.remoteBranches]
  const moreMenu = (e: React.MouseEvent): void =>
    menuAt(e, [
      { label: t('git.fetch'), onClick: () => void run('git.fetch', { type: 'fetch' }) },
      ...(repo.upstream ? [{ label: t('git.rebaseUpstream', { branch: repo.upstream }), onClick: () => void run('git.rebase', { type: 'rebase', onto: repo.upstream! }) }] : []),
      { label: t('git.rebaseOnto'), disabled: others.length === 0, items: others.map((b) => ({ label: b, onClick: () => void run('git.rebase', { type: 'rebase', onto: b }) })) },
      { label: t('git.graph'), onClick: () => setGraph(true) },
      'separator',
      { label: t('git.stash'), disabled: changes === 0, onClick: () => void run('git.stash', { type: 'stash' }) },
      { label: t('git.stashPop', { n: repo.stashes }), disabled: repo.stashes === 0, onClick: () => void run('git.stashPop', { type: 'stashPop' }) },
      'separator',
      { label: t('git.terminal'), onClick: () => p.onOpenConsole('shell', repo.root) },
      { label: t('git.refresh'), onClick: refresh }
    ])

  const fullPath = (c: RepoChange): string => `${repo.root}/${c.path}`
  const fileMenu = (c: RepoChange, section: Section, e: React.MouseEvent): void => {
    e.preventDefault()
    const path = fullPath(c)
    menuAt(e, [
      { label: t('action.open'), bold: true, disabled: c.state === 'deleted', onClick: () => void api.open(path).catch(showError) },
      { label: t('git.showInFolder'), onClick: () => p.onOpenFolder(path.slice(0, path.lastIndexOf('/')) || repo.root) },
      'separator',
      ...(section === 'staged'
        ? [{ label: t('git.unstage'), onClick: () => void run('git.unstage', { type: 'unstage', paths: [c.path] }) }]
        : [{ label: t('git.stage'), onClick: () => void run('git.stage', { type: 'stage', paths: [c.path] }) }]),
      ...(section === 'unstaged' ? [{ label: t('git.discard'), onClick: () => discard([c]) }] : [])
    ])
  }

  const sourceOf = (c: RepoChange, key: Section): DiffSource =>
    key === 'staged' ? { kind: 'staged', path: c.path, ...(c.from ? { from: c.from } : {}) } : { kind: 'unstaged', path: c.path, untracked: c.state === 'untracked' }

  const discard = (list: RepoChange[]): void => {
    if (list.length === 0) return
    const question = list.length === 1 ? t('git.confirmDiscard', { name: list[0].path }) : t('git.confirmDiscardAll', { n: list.length })
    if (window.confirm(question)) void run('git.discard', { type: 'discard', paths: list.map((c) => c.path) })
  }

  /** Conflicts appear only when there are some; the staging area and the changes always show, empty or not. */
  const section = (key: Section, list: RepoChange[]): React.ReactNode =>
    (list.length > 0 || key !== 'conflicts') && (
      <section className={`git-section ${key}`}>
        <div className="git-section-head">
          <span>
            {t(`git.section.${key}`)} <span className="git-count">{list.length}</span>
          </span>
          <span className="git-row-actions">
            {key === 'staged' && list.length > 0 && <button title={t('git.unstageAll')} onClick={() => void run('git.unstage', { type: 'unstageAll' })}>−</button>}
            {key === 'unstaged' && list.length > 0 && <button title={t('git.discardAll')} onClick={() => discard(list)}>↺</button>}
            {key !== 'staged' && list.length > 0 && <button title={t('git.stageAll')} onClick={() => void run('git.stage', key === 'unstaged' ? { type: 'stageAll' } : { type: 'stage', paths: list.map((c) => c.path) })}>+</button>}
          </span>
        </div>
        {list.length === 0 && <div className="git-clean">{t(key === 'staged' ? 'git.stagedEmpty' : 'git.clean')}</div>}
        {list.map((c) => {
          const slash = c.path.lastIndexOf('/')
          return (
            <div
              key={`${key}:${c.path}`}
              className={`git-file ${c.state}`}
              title={`${c.from ? `${c.from} → ${c.path}` : c.path}\n${t('git.diffHint')}`}
              onClick={(e) => !(e.target as HTMLElement).closest('button') && key !== 'conflicts' && setDiff(sourceOf(c, key))}
              onDoubleClick={() => c.state !== 'deleted' && void api.open(fullPath(c)).catch(showError)}
              onContextMenu={(e) => fileMenu(c, key, e)}
            >
              <span className="git-file-name">{c.path.slice(slash + 1)}</span>
              <span className="git-file-dir">{slash > 0 ? c.path.slice(0, slash) : ''}</span>
              <span className="git-row-actions">
                {key === 'unstaged' && <button title={t('git.discard')} onClick={() => discard([c])}>↺</button>}
                {key === 'staged' ? (
                  <button title={t('git.unstage')} onClick={() => void run('git.unstage', { type: 'unstage', paths: [c.path] })}>−</button>
                ) : (
                  <button title={t('git.stage')} onClick={() => void run('git.stage', { type: 'stage', paths: [c.path] })}>+</button>
                )}
              </span>
              <span className="git-state" title={t(`git.state.${c.state}` as MessageKey)}>{STATE_LETTER[c.state]}</span>
            </div>
          )
        })}
      </section>
    )

  return (
    <div className={`git-panel${busy ? ' busy' : ''}`}>
      <div className="git-head">
        <span className="git-repo" title={repo.root}>{repoName}</span>
        {newBranch === null ? (
          <button className="git-branch" title={t('git.branchTitle')} onClick={branchMenu}>
            ⎇ {repo.branch ?? `${t('git.detached')} ${repo.head?.slice(0, 7) ?? ''}`} ▾
          </button>
        ) : (
          <input
            className="git-branch-input"
            autoFocus
            placeholder={t('git.newBranchName')}
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setNewBranch(null)
              if (e.key === 'Enter' && newBranch.trim()) {
                void run('git.newBranch', { type: 'createBranch', name: newBranch.trim() })
                setNewBranch(null)
              }
            }}
            onBlur={() => setNewBranch(null)}
          />
        )}
        <div className="toolbar-spacer" />
        <button className="git-btn" disabled={busy !== null} title={t('git.pullTitle')} onClick={() => void run('git.pull', { type: 'pull' })}>
          ↓ {t('git.pull')}{repo.behind > 0 && <span className="git-badge">{repo.behind}</span>}
        </button>
        <button className="git-btn" disabled={busy !== null || !repo.head} title={repo.upstream ? t('git.pushTitle', { branch: repo.upstream }) : t('git.publishTitle')} onClick={() => void run('git.push', { type: 'push' })}>
          ↑ {repo.upstream ? t('git.push') : t('git.publish')}{repo.ahead > 0 && <span className="git-badge">{repo.ahead}</span>}
        </button>
        <button className="git-btn" disabled={busy !== null} title={t('git.more')} onClick={moreMenu}>
          ⋯
        </button>
      </div>
      {busy && <div className="git-busy" role="status">{t('git.running', { action: t(busy) })}</div>}
      {repo.operation && (
        <div className="git-operation" role="alert">
          <span>{t(`git.op.${repo.operation}` as MessageKey)}</span>
          <div className="toolbar-spacer" />
          <button className="xp-button" disabled={busy !== null || repo.conflicts.length > 0} onClick={() => void run('git.continue', { type: 'continue' })}>{t('git.continue')}</button>
          {repo.operation !== 'merge' && <button className="xp-button" disabled={busy !== null} onClick={() => void run('git.skip', { type: 'skip' })}>{t('git.skip')}</button>}
          <button className="xp-button" disabled={busy !== null} onClick={() => void run('git.abort', { type: 'abort' })}>{t('git.abort')}</button>
        </div>
      )}
      <div className="git-commit">
        <textarea
          value={message}
          placeholder={t('git.messagePlaceholder', { key: keys.isMac ? '⌘↩' : 'Ctrl+Enter' })}
          spellCheck={false}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && (keys.isMac ? e.metaKey : e.ctrlKey) && canCommit) {
              e.preventDefault()
              void commit(false)
            }
          }}
        />
        <div className="git-commit-row">
          <button className="xp-button" disabled={!canCommit} onClick={() => void commit(false)}>{t(amend ? 'git.amendCommit' : 'git.commit')}</button>
          <button className="xp-button" disabled={!canCommit} onClick={() => void commit(true)}>{t('git.commitPush')}</button>
          <label className="settings-check" title={t('git.amendTitle')}>
            <input type="checkbox" checked={amend} disabled={!repo.head} onChange={(e) => setAmend(e.target.checked)} />
            {t('git.amend')}
          </label>
        </div>
      </div>
      <div className="git-scroll">
        {section('conflicts', repo.conflicts)}
        {section('staged', repo.staged)}
        {section('unstaged', repo.unstaged)}
        {repo.truncated && <div className="git-clean">{t('git.truncated')}</div>}
        {repo.commits.length > 0 && (
          <section className="git-section">
            <div className="git-section-head">
              <span>{t('git.section.history')}</span>
              <span className="git-row-actions shown">
                <button title={t('git.graph')} onClick={() => setGraph(true)}>⑂ {t('git.graphShort')}</button>
              </span>
            </div>
            {repo.commits.map((c, i) => (
              <div key={c.hash} className={`git-commit-item${i < repo.ahead ? ' unpushed' : ''}`} title={`${c.hash}\n${c.author}`}>
                <span className="git-hash">{c.short}</span>
                <span className="git-subject">{c.subject}</span>
                <span className="git-when">{formatRelative(c.time)}</span>
              </div>
            ))}
          </section>
        )}
      </div>
      {diff &&
        createPortal(
          <GitDiffDialog
            cwd={repo.root}
            source={diff}
            onClose={() => setDiff(null)}
            onOpen={(diff.kind === 'staged' ? repo.staged : repo.unstaged).some((c) => c.path === diff.path && c.state === 'deleted') ? undefined : () => void api.open(`${repo.root}/${diff.path}`).catch(showError)}
            onToggleStage={() => {
              setDiff(null)
              void run(diff.kind === 'staged' ? 'git.unstage' : 'git.stage', { type: diff.kind === 'staged' ? 'unstage' : 'stage', paths: [diff.path] })
            }}
          />,
          document.body
        )}
      {graph && createPortal(<GitGraphDialog cwd={repo.root} repo={repo} showError={showError} onClose={() => setGraph(false)} />, document.body)}
    </div>
  )
}
