import { useState } from 'react'
import { t } from '@shared/i18n'
import type { DiffSource } from '@shared/git'
import { Dialog } from './Dialog'
import { GitDiffView } from './GitDiffView'

interface Props {
  cwd: string
  source: DiffSource
  /** Stage or unstage the file; shown for working copy and index diffs. */
  onToggleStage?(): void
  onOpen?(): void
  onClose(): void
}

/** What a diff compares, for the toolbar. */
export function diffLabel(source: DiffSource): string {
  if (source.kind === 'staged') return t('git.diff.staged')
  if (source.kind === 'unstaged') return t(source.untracked ? 'git.diff.untracked' : 'git.diff.unstaged')
  return t('git.diff.commit', { hash: source.hash.slice(0, 7) })
}

/** A changed file of the source control area, in a resizable window over the app. */
export function GitDiffDialog({ cwd, source, onToggleStage, onOpen, onClose }: Props): React.JSX.Element {
  const [inline, setInline] = useState(false)
  return (
    <Dialog title={source.path} className="git-diff-dialog" onClose={onClose} resizable>
        <div className="git-diff-bar">
          <span className="git-diff-label" title={'from' in source && source.from ? `${source.from} → ${source.path}` : source.path}>
            {diffLabel(source)}
          </span>
          <div className="toolbar-spacer" />
          <label className="settings-check">
            <input type="checkbox" checked={inline} onChange={(e) => setInline(e.target.checked)} />
            {t('git.diff.inline')}
          </label>
          {onToggleStage && (
            <button className="xp-button" onClick={onToggleStage}>
              {t(source.kind === 'staged' ? 'git.unstage' : 'git.stage')}
            </button>
          )}
          {onOpen && (
            <button className="xp-button" onClick={onOpen}>
              {t('action.open')}
            </button>
          )}
        </div>
        <GitDiffView cwd={cwd} source={source} inline={inline} />
    </Dialog>
  )
}
