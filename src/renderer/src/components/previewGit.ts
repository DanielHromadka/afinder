// Git in the text preview: change bars against HEAD in the gutter, a diff view, and blame for the
// cursor line. Everything stays off for files outside a local repository.

import { useEffect, useState, type RefObject } from 'react'
import { t } from '@shared/i18n'
import { isUncommitted, lineChanges, type BlameCommit, type GitBlame } from '@shared/git'
import { formatDate, formatRelative } from '../lib/format'
import type * as Monaco from 'monaco-editor/editor/editor.api'
import { loadMonaco, type MonacoApi } from '../lib/monaco'

const api = window.api

type Editor = ReturnType<MonacoApi['editor']['create']>

/** Recomputing the bars while typing waits for a pause. */
const BARS_DELAY_MS = 250

/**
 * The file's HEAD version: undefined outside a repository (no git UI at all), null for a file that is
 * not committed yet. Fetched again when the file changes on disk (a save, a checkout).
 */
export function useGitBase(path: string, modified: number): string | null | undefined {
  const [base, setBase] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    api.gitFile(path).then(
      (f) => live && setBase(f ? f.base : undefined),
      () => live && setBase(undefined)
    )
    return () => {
      live = false
    }
  }, [path, modified])
  return base
}

const wholeLines = (start: number, end: number): Monaco.IRange => ({ startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 })

/** Added / modified / deleted bars in the gutter, kept up to date while editing. */
export function useChangeBars(editor: Editor | null, base: string | null | undefined): void {
  useEffect(() => {
    if (!editor || base === undefined) return
    const bars = editor.createDecorationsCollection()
    const update = (): void => {
      const model = editor.getModel()
      if (!model) return
      const changes = base === null ? [{ kind: 'added' as const, start: 1, end: model.getLineCount() }] : (lineChanges(base, model.getValue()) ?? [])
      bars.set(changes.map((c) => ({ range: wholeLines(c.start, c.end), options: { isWholeLine: true, linesDecorationsClassName: `git-bar git-${c.kind}` } })))
    }
    update()
    let timer: ReturnType<typeof setTimeout> | undefined
    const sub = editor.onDidChangeModelContent(() => {
      clearTimeout(timer)
      timer = setTimeout(update, BARS_DELAY_MS)
    })
    return () => {
      clearTimeout(timer)
      sub.dispose()
      if (editor.getModel()) bars.clear() // a disposed editor (theme change) has nothing to clear
    }
  }, [editor, base])
}

/** Markdown-escapes commit text for a hover. */
const md = (s: string): string => s.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, '\\$&')

function blameLabel(c: BlameCommit): string {
  return isUncommitted(c.sha) ? t('preview.notCommitted') : `${c.author}, ${formatRelative(c.time)} · ${c.summary}`
}

function blameHover(c: BlameCommit): string {
  if (isUncommitted(c.sha)) return md(t('preview.notCommitted'))
  return `**${c.sha.slice(0, 8)}** · ${md(c.author)} · ${md(formatDate(c.time))}\n\n${md(c.summary)}`
}

/**
 * GitLens-style blame: a dim note after the cursor line, the full commit on hover. The blame belongs to
 * the file on disk; invisible per-line decorations follow the lines through unsaved edits.
 */
export function useBlame(editor: Editor | null, path: string, modified: number): void {
  useEffect(() => {
    if (!editor) return
    let live = true
    let blame: GitBlame | null = null
    const lines = editor.createDecorationsCollection()
    const note = editor.createDecorationsCollection()
    const show = (): void => {
      const model = editor.getModel()
      const line = editor.getPosition()?.lineNumber
      const index = line && blame ? lines.getRanges().findIndex((r) => r.startLineNumber === line) : -1
      const commit = index >= 0 && blame ? blame.commits[blame.lines[index]] : undefined
      if (!model || !line || !commit) return note.clear()
      const end = model.getLineMaxColumn(line)
      note.set([
        {
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: end },
          options: { hoverMessage: { value: blameHover(commit) }, after: { content: ` ${blameLabel(commit)}`, inlineClassName: 'git-blame-note' } }
        }
      ])
    }
    void api.gitBlame(path).then(
      (b) => {
        if (!live || !b || !editor.getModel()) return
        blame = b
        lines.set(b.lines.map((_, i) => ({ range: wholeLines(i + 1, i + 1), options: {} })))
        show()
      },
      () => {}
    )
    const subs = [editor.onDidChangeCursorPosition(show), editor.onDidChangeModelContent(show)]
    return () => {
      live = false
      subs.forEach((s) => s.dispose())
      if (editor.getModel()) lines.clear(), note.clear()
    }
  }, [editor, path, modified])
}

/**
 * A diff editor of the preview's text against HEAD: inline in the pane, side by side in Quick Look
 * (inline again when that gets narrow). It mirrors the editor into its own model – sharing the model
 * would break when the editor is recreated (theme change) and disposes it first.
 */
export function useDiffView(editor: Editor | null, host: RefObject<HTMLDivElement | null>, base: string | null | undefined, overlay: boolean): void {
  useEffect(() => {
    const model = editor?.getModel()
    if (!editor || !model || base === undefined) return
    let disposed = false
    let cleanup = (): void => {}
    void loadMonaco().then((monaco) => {
      if (disposed || !host.current) return
      const original = monaco.editor.createModel(base ?? '', model.getLanguageId())
      const modified = monaco.editor.createModel(model.getValue(), model.getLanguageId())
      const mirror = model.onDidChangeContent(() => modified.setValue(model.getValue()))
      const diff = monaco.editor.createDiffEditor(host.current, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: overlay,
        useInlineViewWhenSpaceIsLimited: true,
        renderOverviewRuler: overlay,
        hideUnchangedRegions: { enabled: true },
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbersMinChars: 3,
        stickyScroll: { enabled: false },
        fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', monospace",
        fontSize: overlay ? 13 : 12,
        unicodeHighlight: { ambiguousCharacters: false },
        links: false
      })
      diff.setModel({ original, modified })
      cleanup = () => {
        mirror.dispose()
        diff.dispose()
        original.dispose()
        modified.dispose()
      }
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [editor, base, overlay, host])
}
