import { useState } from 'react'
import { t } from '@shared/i18n'
import { baseName, dirOf } from '@shared/paths'
import type { DuplicateGroup } from '@shared/types'
import { formatSize } from '@renderer/lib/format'
import { api, PathField, Progress, ToolError, useJob, type ToolProps } from './common'

/** Files with the same content below a folder; the chosen copies go to the trash. */
export default function Duplicates({ folder }: Pick<ToolProps, 'folder'>): React.JSX.Element {
  const [dir, setDir] = useState(folder)
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const job = useJob<DuplicateGroup[]>()

  const find = async (): Promise<void> => {
    setGroups(null)
    setChosen(new Set())
    const result = await job.run((id) => api.tools.duplicates(id, dir.trim()))
    if (result) setGroups(result)
  }
  const toggle = (p: string): void => {
    const next = new Set(chosen)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    setChosen(next)
  }
  // Keeps the first (alphabetically) copy of each group.
  const allButFirst = (): void => setChosen(new Set(groups!.flatMap((g) => g.paths.slice(1))))
  const trash = async (): Promise<void> => {
    try {
      await api.trash([...chosen])
      setGroups(groups!.map((g) => ({ ...g, paths: g.paths.filter((p) => !chosen.has(p)) })).filter((g) => g.paths.length > 1))
      setChosen(new Set())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const wasted = groups?.reduce((a, g) => a + g.size * (g.paths.length - 1), 0) ?? 0
  const freed = groups?.reduce((a, g) => a + g.size * g.paths.filter((p) => chosen.has(p)).length, 0) ?? 0
  // Never every copy of a file.
  const unsafe = groups?.some((g) => g.paths.every((p) => chosen.has(p))) ?? false

  return (
    <div className="tool">
      <PathField value={dir} onChange={setDir} kind="folder" folder={folder} />
      {job.busy ? (
        <Progress progress={job.progress} onCancel={job.cancel} />
      ) : (
        <div className="tool-row">
          <button className="todo-btn" disabled={!dir.trim()} onClick={() => void find()}>
            {t('tools.findDuplicates')}
          </button>
        </div>
      )}
      <ToolError text={job.error ?? error} />
      {groups && (
        <>
          <p>{groups.length ? t('tools.dupesFound', { groups: groups.length, size: formatSize(wasted) }) : t('tools.dupesNone')}</p>
          {groups.length > 0 && (
            <div className="tool-row">
              <button className="todo-btn" onClick={allButFirst}>
                {t('tools.dupesSelectCopies')}
              </button>
              <button className="todo-btn" disabled={!chosen.size || unsafe} onClick={() => void trash()}>
                {t('tools.dupesTrash', { count: chosen.size, size: formatSize(freed) })}
              </button>
              {unsafe && <span className="tool-error">{t('tools.dupesKeepOne')}</span>}
            </div>
          )}
          {groups.slice(0, 500).map((g) => (
            <div key={g.paths[0]} className="dupe-group">
              <div className="tool-muted">{t('tools.dupesGroup', { count: g.paths.length, size: formatSize(g.size) })}</div>
              {g.paths.map((p) => (
                <label key={p} className="dupe-path" title={p}>
                  <input type="checkbox" checked={chosen.has(p)} onChange={() => toggle(p)} />
                  <span className="dupe-name">{baseName(p)}</span>
                  <button className="link-button dupe-dir" onClick={(e) => (e.preventDefault(), void api.reveal(p))}>
                    {dirOf(p)}
                  </button>
                </label>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
