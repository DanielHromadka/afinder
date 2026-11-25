import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { baseName, dirOf } from '@shared/paths'
import { groupSimilar } from '@shared/phash'
import type { DuplicateGroup, ImageFile } from '@shared/types'
import { formatSize } from '@renderer/lib/format'
import { mapLimit } from '@renderer/lib/mediaInfo'
import { hashPhoto } from '@renderer/lib/similarPhotos'
import { thumbnail } from '@renderer/lib/thumbnails'
import { api, PathField, Progress, ToolError, useJob, useStored, type ToolProps } from './common'

type Mode = 'same' | 'similar'

/**
 * Files with the same content below a folder, or photos that look alike (resized, recompressed, edited);
 * the chosen copies go to the trash.
 */
export default function Duplicates({ folder }: Pick<ToolProps, 'folder'>): React.JSX.Element {
  const [dir, setDir] = useState(folder)
  const [mode, setMode] = useStored<Mode>('dupes.mode', 'same')
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  /** Similar photos: how many are hashed, while it runs. */
  const [hashing, setHashing] = useState<{ done: number; total: number } | null>(null)
  /** Sizes of the photos in similar groups (they differ within a group). */
  const sizes = useRef(new Map<string, number>())
  const stopHashing = useRef<AbortController | null>(null)
  const job = useJob<DuplicateGroup[]>()
  const listJob = useJob<ImageFile[]>()
  useEffect(() => () => stopHashing.current?.abort(), [])

  const find = async (): Promise<void> => {
    setGroups(null)
    setChosen(new Set())
    setError(null)
    if (mode === 'same') {
      const result = await job.run((id) => api.tools.duplicates(id, dir.trim()))
      if (result) setGroups(result)
      return
    }
    const files = await listJob.run((id) => api.tools.images(id, dir.trim()))
    if (!files) return
    const ctrl = new AbortController()
    stopHashing.current = ctrl
    setHashing({ done: 0, total: files.length })
    let done = 0
    const hashes = await mapLimit(files, 4, async (f) => {
      if (ctrl.signal.aborted) return null
      const h = await hashPhoto(f)
      setHashing({ done: ++done, total: files.length })
      return h
    })
    setHashing(null)
    stopHashing.current = null
    if (ctrl.signal.aborted) return
    const usable = files.flatMap((f, i) => (hashes[i] ? [{ f, h: hashes[i]! }] : []))
    sizes.current = new Map(usable.map(({ f }) => [f.path, f.size]))
    // The largest file (usually the original) first, so "all but first" keeps it.
    setGroups(
      groupSimilar(usable.map((x) => x.h)).map((g) => {
        const paths = g.map((i) => usable[i].f).sort((a, b) => b.size - a.size).map((f) => f.path)
        return { size: usable[g[0]].f.size, paths }
      })
    )
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

  const sizeOf = (g: DuplicateGroup, p: string): number => (mode === 'similar' ? (sizes.current.get(p) ?? 0) : g.size)
  const wasted = groups?.reduce((a, g) => a + g.paths.slice(1).reduce((n, p) => n + sizeOf(g, p), 0), 0) ?? 0
  const freed = groups?.reduce((a, g) => a + g.paths.filter((p) => chosen.has(p)).reduce((n, p) => n + sizeOf(g, p), 0), 0) ?? 0
  const busy = job.busy || listJob.busy || hashing !== null
  // Never every copy of a file.
  const unsafe = groups?.some((g) => g.paths.every((p) => chosen.has(p))) ?? false

  return (
    <div className="tool">
      <PathField value={dir} onChange={setDir} kind="folder" folder={folder} />
      <div className="tool-row">
        {(['same', 'similar'] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="dupes-mode" checked={mode === m} disabled={busy} onChange={() => (setMode(m), setGroups(null), setChosen(new Set()))} />
            {t(`similar.mode.${m}`)}
          </label>
        ))}
      </div>
      {job.busy ? (
        <Progress progress={job.progress} onCancel={job.cancel} />
      ) : listJob.busy ? (
        <Progress progress={listJob.progress} onCancel={listJob.cancel} />
      ) : hashing ? (
        <div className="tool-row">
          <div className="tool-progress">
            <div style={{ width: `${Math.round((hashing.done / Math.max(1, hashing.total)) * 100)}%` }} />
          </div>
          <span className="tool-muted">{t('similar.hashing', { done: hashing.done, total: hashing.total })}</span>
          <button className="todo-btn" onClick={() => stopHashing.current?.abort()}>
            {t('dialog.cancel')}
          </button>
        </div>
      ) : (
        <div className="tool-row">
          <button className="todo-btn" disabled={!dir.trim()} onClick={() => void find()}>
            {t(mode === 'similar' ? 'similar.find' : 'tools.findDuplicates')}
          </button>
        </div>
      )}
      <ToolError text={job.error ?? listJob.error ?? error} />
      {groups && (
        <>
          <p>
            {groups.length
              ? t(mode === 'similar' ? 'similar.found' : 'tools.dupesFound', { groups: groups.length, size: formatSize(wasted) })
              : t(mode === 'similar' ? 'similar.none' : 'tools.dupesNone')}
          </p>
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
              <div className="tool-muted">{mode === 'similar' ? t('similar.group', { count: g.paths.length }) : t('tools.dupesGroup', { count: g.paths.length, size: formatSize(g.size) })}</div>
              {g.paths.map((p) => (
                <label key={p} className="dupe-path" title={p}>
                  <input type="checkbox" checked={chosen.has(p)} onChange={() => toggle(p)} />
                  {mode === 'similar' && <PhotoThumb path={p} size={sizes.current.get(p) ?? null} />}
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

/** A small picture of a photo in a similar group, with its size, so the copies can be told apart. */
function PhotoThumb({ path, size }: { path: string; size: number | null }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    void thumbnail({ path, name: baseName(path), size, modified: 0 }, ctrl.signal).then((u) => !ctrl.signal.aborted && setUrl(u))
    return () => ctrl.abort()
  }, [path, size])
  return (
    <span className="dupe-thumb">
      {url && <img src={url} alt="" />}
      {size !== null && <span className="tool-muted">{formatSize(size)}</span>}
    </span>
  )
}
