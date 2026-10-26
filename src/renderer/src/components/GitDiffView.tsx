import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { DiffSource, FileDiff } from '@shared/git'
import { textLanguage } from '@shared/preview'
import type { ThemeId } from '@shared/types'
import { loadMonaco } from '@renderer/lib/monaco'
import { editorTheme } from './Preview'

const api = window.api

/** Both versions of a changed file in Monaco's diff editor: side by side, inline when narrow or asked to. */
export function GitDiffView({ cwd, source, inline }: { cwd: string; source: DiffSource; inline: boolean }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(source)

  useEffect(() => {
    let live = true
    setDiff(null)
    setError(null)
    api.gitDiff(cwd, JSON.parse(key) as DiffSource).then(
      (d) => live && setDiff(d),
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err))
    )
    return () => {
      live = false
    }
  }, [cwd, key])

  const showable = diff && !diff.binary && !diff.tooLarge
  useEffect(() => {
    if (!showable || !host.current) return
    let disposed = false
    let cleanup = (): void => {}
    void loadMonaco().then((monaco) => {
      if (disposed || !host.current) return
      monaco.editor.setTheme(editorTheme(monaco, host.current, (document.documentElement.dataset.theme ?? 'xp') as ThemeId))
      const language = textLanguage(source.path.split('/').pop() ?? '') ?? 'plaintext'
      const original = monaco.editor.createModel(diff.original, language)
      const modified = monaco.editor.createModel(diff.modified, language)
      const editor = monaco.editor.createDiffEditor(host.current, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: !inline,
        useInlineViewWhenSpaceIsLimited: true,
        hideUnchangedRegions: { enabled: true },
        // Both draw codicon glyphs, a font the app does not load.
        renderIndicators: false,
        renderMarginRevertIcon: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbersMinChars: 3,
        stickyScroll: { enabled: false },
        fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', monospace",
        fontSize: 12,
        unicodeHighlight: { ambiguousCharacters: false },
        links: false
      })
      editor.setModel({ original, modified })
      cleanup = () => {
        editor.dispose()
        original.dispose()
        modified.dispose()
      }
    })
    return () => {
      disposed = true
      cleanup()
    }
    // source.path only picks the language; the diff itself changes with it.
  }, [diff, showable, inline])

  if (error) return <div className="git-diff-note error">{error}</div>
  if (!diff) return <div className="git-diff-note">…</div>
  if (diff.binary) return <div className="git-diff-note">{t('git.diff.binary')}</div>
  if (diff.tooLarge) return <div className="git-diff-note">{t('git.diff.tooLarge')}</div>
  return <div className="git-diff-editor" ref={host} />
}
