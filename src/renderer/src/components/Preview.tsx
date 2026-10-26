import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { dirOf, joinPath } from '@shared/paths'
import { canEditImage } from '@shared/imageEdit'
import { extensionOf, looksLikeText, MAX_MODEL_BYTES, previewKind, previewUrl, sniffable, textLanguage, type PreviewKind } from '@shared/preview'
import { THEMES, type FileEntry, type SheetPreview, type SizeUpdate, type ThemeId } from '@shared/types'
import { formatDate, formatSize, numberFormat } from '../lib/format'
import { kindLabel } from '../lib/kinds'
import { keys } from '../lib/keys'
import { cssColorToHex, loadMonaco, luminance, type MonacoApi } from '../lib/monaco'
import { Icon } from './Icon'
import { useBlame, useChangeBars, useDiffView, useGitBase } from './previewGit'

const api = window.api

/** Text files are read up to this size; the rest is cut off with a note. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024
/** Files of unknown type up to this size are sniffed and shown as text when they look like it. */
const MAX_SNIFF_BYTES = 8 * 1024 * 1024

interface Props {
  entry: FileEntry | null
  /** Computed folder size, when known. */
  size?: SizeUpdate
  theme: ThemeId
  /** Pane: compact, follows the selection with a short delay. Overlay: Quick Look, large. */
  mode: 'pane' | 'overlay'
  /** Text cannot be edited (e.g. inside an archive). */
  readOnly?: boolean
  /** Errors that happen after the viewer is gone (saving on the way out). */
  onError(err: unknown): void
  /** Pane only: opens the image editor (in Quick Look – the pane is too small for it). */
  onEditImage?(): void
}

/** Header with the file's name and details, and the viewer that fits its type. */
export function Preview({ entry, size, theme, mode, readOnly = false, onError, onEditImage }: Props): React.JSX.Element {
  // Arrowing through a folder should not start a dozen loads – the pane waits for the selection to settle.
  const shown = useSettled(entry, mode === 'pane' ? 140 : 0)
  if (!shown) return <div className={`preview ${mode}`}><p className="preview-note center">{t('preview.empty')}</p></div>
  const bytes = shown.size ?? size?.size
  return (
    <div className={`preview ${mode}`}>
      {mode === 'pane' && (
        <div className="preview-head">
          <Icon name={shown.kind} size={32} />
          <div className="preview-title">
            <strong title={shown.name}>{shown.name}</strong>
            <span>
              {kindLabel(shown)}
              {bytes != null ? ` · ${formatSize(bytes)}` : ''}
            </span>
            <span>{formatDate(shown.modified)}</span>
          </div>
        </div>
      )}
      <Viewer key={shown.path} entry={shown} theme={theme} mode={mode} readOnly={readOnly} onError={onError} onEditImage={onEditImage} />
    </div>
  )
}

function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (delay === 0) return setSettled(value)
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return delay === 0 ? value : settled
}

function Viewer({ entry, theme, mode, readOnly, onError, onEditImage }: Pick<Props, 'theme' | 'mode' | 'onError' | 'onEditImage'> & { entry: FileEntry; readOnly: boolean }): React.JSX.Element {
  // Remount viewers when the file changes on disk (an agent rewrote it); the text editor syncs itself.
  const stamp = `${entry.modified}|${entry.size}`
  const [kind, setKind] = useState<PreviewKind | 'none' | null>(() => (entry.isDir ? 'none' : null))
  const [language, setLanguage] = useState<string>('plaintext')

  useEffect(() => {
    if (entry.isDir) return
    const byName = previewKind(entry.name)
    if (byName !== 'thumbnail') {
      setLanguage(textLanguage(entry.name) ?? 'plaintext')
      return setKind(byName)
    }
    // Unknown extension: plain text if the first bytes say so (logs, configs, scripts without one).
    if (!sniffable(entry.name) || entry.size === null || entry.size > MAX_SNIFF_BYTES) return setKind('thumbnail')
    const ctrl = new AbortController()
    fetch(previewUrl(entry.path), { headers: { Range: 'bytes=0-8191' }, signal: ctrl.signal })
      .then((r) => r.arrayBuffer())
      .then((buf) => setKind(looksLikeText(new Uint8Array(buf)) ? 'text' : 'thumbnail'))
      .catch(() => !ctrl.signal.aborted && setKind('thumbnail'))
    return () => ctrl.abort()
  }, [entry])

  if (kind === null) return <Note text={t('preview.loading')} />
  switch (kind) {
    case 'image':
      return <ImageView key={stamp} entry={entry} onEdit={!readOnly && canEditImage(entry.name) ? onEditImage : undefined} />
    case 'pdf':
      // Chromium's own PDF viewer, with its toolbar only where there is room for it.
      return <iframe key={stamp} className="preview-frame" src={`${previewUrl(entry.path)}#toolbar=${mode === 'overlay' ? 1 : 0}&view=FitH`} title={entry.name} />
    case 'video':
      return <video key={stamp} className="preview-media" src={previewUrl(entry.path)} controls preload="metadata" />
    case 'audio':
      return (
        <div className="preview-audio">
          <Icon name="audio" size={96} />
          <audio src={previewUrl(entry.path)} controls preload="metadata" />
        </div>
      )
    case 'text':
      return <TextView entry={entry} language={language} theme={theme} mode={mode} readOnly={readOnly} onError={onError} />
    case 'docx':
      return <DocxView key={stamp} entry={entry} />
    case 'sheet':
      return <SheetView key={stamp} entry={entry} />
    case 'model':
      return <ModelView key={stamp} entry={entry} mode={mode} />
    case 'thumbnail':
      return <ThumbnailView key={stamp} entry={entry} mode={mode} />
    case 'none':
      return <BigIcon entry={entry} />
  }
}

function Note({ text, error }: { text: string; error?: boolean }): React.JSX.Element {
  return <p className={`preview-note center${error ? ' error' : ''}`}>{text}</p>
}

function BigIcon({ entry, note }: { entry: FileEntry; note?: string }): React.JSX.Element {
  return (
    <div className="preview-icon">
      <Icon name={entry.kind} size={96} />
      {note && <p className="preview-note">{note}</p>}
    </div>
  )
}

function ImageView({ entry, onEdit }: { entry: FileEntry; onEdit?: () => void }): React.JSX.Element {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  if (failed) return <ThumbnailView entry={entry} mode="pane" /> // HEIC, TIFF … – the OS may still render it
  return (
    <div className="preview-image">
      <img
        src={previewUrl(entry.path)}
        alt={entry.name}
        draggable={false}
        onLoad={(e) => setDims({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        onError={() => setFailed(true)}
      />
      {dims && dims.width > 0 && <span className="preview-caption">{t('preview.dimensions', dims)}</span>}
      {onEdit && (
        <button className="xp-button preview-image-edit" title={t('imageEditor.editTitle')} onClick={onEdit}>
          {t('preview.edit')}
        </button>
      )}
    </div>
  )
}

function ThumbnailView({ entry, mode }: { entry: FileEntry; mode: Props['mode'] }): React.JSX.Element {
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    api.preview.thumbnail(entry.path, mode === 'overlay' ? 1600 : 800).then(
      (url) => live && setSrc(url),
      () => live && setSrc(null)
    )
    return () => {
      live = false
    }
  }, [entry, mode])
  if (src === undefined) return <Note text={t('preview.loading')} />
  if (src === null) return <BigIcon entry={entry} note={t(api.platform === 'linux' ? 'preview.noThumbnail' : 'preview.none')} />
  return (
    <div className="preview-image">
      <img src={src} alt={entry.name} draggable={false} />
    </div>
  )
}

/** Rotatable 3D model; too large or unreadable ones fall back to the OS thumbnail. */
function ModelView({ entry, mode }: { entry: FileEntry; mode: Props['mode'] }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const tooLarge = entry.size !== null && entry.size > MAX_MODEL_BYTES
  const [state, setState] = useState<{ triangles: number } | 'loading' | 'failed'>('loading')
  useEffect(() => {
    if (tooLarge) return
    const ctrl = new AbortController()
    let dispose: (() => void) | undefined
    // .gltf side files (buffers, textures) sit next to the file; their URIs are percent-encoded.
    const resolve = (uri: string): string => previewUrl(joinPath(dirOf(entry.path), decodeURIComponent(uri).replace(/^\.\//, '')))
    void (async () => {
      try {
        const [{ mountModel }, data] = await Promise.all([
          import('../lib/modelViewer'),
          fetch(previewUrl(entry.path), { signal: ctrl.signal }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        ])
        if (ctrl.signal.aborted || !host.current) return
        const mounted = await mountModel(host.current, data, extensionOf(entry.name), resolve)
        if (ctrl.signal.aborted) return mounted.dispose()
        dispose = mounted.dispose
        setState(mounted.info)
      } catch (err) {
        if (!ctrl.signal.aborted) {
          console.warn('3D preview failed', err)
          setState('failed')
        }
      }
    })()
    return () => {
      ctrl.abort()
      dispose?.()
    }
  }, [entry, tooLarge])
  if (tooLarge) return <ModelFallback entry={entry} mode={mode} note={t('preview.modelTooLarge', { size: formatSize(MAX_MODEL_BYTES) })} />
  if (state === 'failed') return <ModelFallback entry={entry} mode={mode} note={t('preview.modelFailed')} />
  return (
    <div className="preview-model">
      <div ref={host} className="model-canvas" />
      {state === 'loading' ? <p className="preview-note center">{t('preview.loading')}</p> : <span className="preview-caption">{t('preview.triangles', { count: numberFormat(0).format(state.triangles) })}</span>}
    </div>
  )
}

function ModelFallback({ entry, mode, note }: { entry: FileEntry; mode: Props['mode']; note: string }): React.JSX.Element {
  return (
    <>
      <ThumbnailView entry={entry} mode={mode} />
      <p className="preview-note">{note}</p>
    </>
  )
}

function DocxView({ entry }: { entry: FileEntry }): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api.preview.docx(entry.path).then(
      (h) => live && setHtml(h),
      (e: Error) => live && setError(e.message)
    )
    return () => {
      live = false
    }
  }, [entry])
  if (error) return <Note text={error} error />
  if (html === null) return <Note text={t('preview.loading')} />
  // sandbox="" – no scripts, no navigation, no same-origin access; the document is just painted.
  return <iframe className="preview-frame paper" sandbox="" srcDoc={DOC_STYLE + html} title={entry.name} />
}

const DOC_STYLE = `<!doctype html><meta charset="utf-8"><style>
html{background:#fff}body{margin:0 auto;max-width:720px;padding:28px 32px;font:14px/1.5 Calibri,Carlito,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;word-wrap:break-word}
h1,h2,h3{font-family:'Calibri Light',Calibri,'Segoe UI',sans-serif;font-weight:normal;color:#1f3864;line-height:1.2}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #bbb;padding:3px 6px;vertical-align:top}
img{max-width:100%;height:auto}a{color:#0563c1}
</style>`

function SheetView({ entry }: { entry: FileEntry }): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [data, setData] = useState<SheetPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api.preview.sheet(entry.path, index).then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e.message)
    )
    return () => {
      live = false
    }
  }, [entry, index])
  if (error) return <Note text={error} error />
  if (!data) return <Note text={t('preview.loading')} />
  const columns = data.rows[0]?.length ?? 0
  return (
    <div className="preview-sheet">
      <div className="sheet-scroll">
        <table>
          <thead>
            <tr>
              <th />
              {Array.from({ length: columns }, (_, c) => (
                <th key={c}>{columnName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                <th>{r + 1}</th>
                {row.map((cell, c) => (
                  <td key={c} className={/^-?[\d\s.,]+$/.test(cell) ? 'num' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.truncated && <p className="preview-note">{t('preview.truncatedSheet')}</p>}
      {data.sheets.length > 1 && (
        <div className="sheet-tabs">
          {data.sheets.map((name, i) => (
            <button key={i} className={i === data.index ? 'active' : ''} onClick={() => setIndex(i)}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 0 → A, 25 → Z, 26 → AA. */
function columnName(n: number): string {
  let s = ''
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

type Editor = ReturnType<MonacoApi['editor']['create']>

interface Loaded {
  text: string
  /** Modification time the text belongs to. */
  modified: number
  bom: boolean
  /** Whole file read and valid UTF-8 – safe to write back. */
  editable: boolean
}

async function loadText(path: string, signal: AbortSignal): Promise<Loaded & { truncated: boolean }> {
  const res = await fetch(previewUrl(path), { headers: { Range: `bytes=0-${MAX_TEXT_BYTES - 1}` }, signal })
  const bytes = new Uint8Array(await res.arrayBuffer())
  const total = Number(res.headers.get('Content-Range')?.split('/')[1] ?? bytes.length)
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text: string
  let valid = true
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) // strips the BOM
  } catch {
    valid = false
    text = new TextDecoder('utf-8').decode(bytes)
  }
  const truncated = total > MAX_TEXT_BYTES
  return { text, modified: 0, bom, editable: valid && !truncated, truncated }
}

type SaveState = { kind: 'idle' } | { kind: 'saved' } | { kind: 'conflict' } | { kind: 'error'; message: string }

function TextView(props: {
  entry: FileEntry
  language: string
  theme: ThemeId
  mode: Props['mode']
  readOnly: boolean
  onError(err: unknown): void
}): React.JSX.Element {
  const { entry, language, theme, mode } = props
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const loaded = useRef<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [ready, setReady] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  // The editor as state too, so the git hooks follow it when it is recreated (theme, size class).
  const [editor, setEditor] = useState<Editor | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [showBlame, setShowBlame] = useState(false)
  const diffHost = useRef<HTMLDivElement>(null)
  const latest = useRef({ props, dirty, editing })
  latest.current = { props, dirty, editing }

  const canEdit = ready && !props.readOnly && loaded.current?.editable === true

  const doSave = async (force = false): Promise<boolean> => {
    const editor = editorRef.current
    const base = loaded.current
    if (!editor || !base) return false
    const text = editor.getValue()
    try {
      const modified = await api.preview.save(entry.path, text, base.modified, base.bom, force)
      loaded.current = { ...base, text, modified }
      setDirty(false)
      setSave({ kind: 'saved' })
      return true
    } catch (err) {
      const message = (err as Error).message
      setSave(message === t('preview.changedOnDisk') ? { kind: 'conflict' } : { kind: 'error', message })
      return false
    }
  }
  const saveRef = useRef(doSave)
  saveRef.current = doSave

  // Create the editor once per file (and theme / size class); content changes are synced below.
  useEffect(() => {
    const ctrl = new AbortController()
    let disposed = false
    void (async () => {
      try {
        const [monaco, file] = await Promise.all([loadMonaco(), loadText(entry.path, ctrl.signal)])
        if (disposed || !host.current) return
        loaded.current = { ...file, modified: latest.current.props.entry.modified }
        setTruncated(file.truncated)
        monaco.editor.setTheme(editorTheme(monaco, host.current, theme))
        const wrap = language === 'markdown' || language === 'plaintext' || language === 'mdx'
        const editor = monaco.editor.create(host.current, {
          value: file.text,
          language,
          readOnly: true,
          domReadOnly: true,
          automaticLayout: true,
          minimap: { enabled: mode === 'overlay' },
          wordWrap: wrap ? 'on' : 'off',
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          lineNumbersMinChars: 3,
          glyphMargin: false,
          stickyScroll: { enabled: false },
          fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', monospace",
          fontSize: mode === 'overlay' ? 13 : 12,
          padding: { top: 6 },
          unicodeHighlight: { ambiguousCharacters: false },
          occurrencesHighlight: 'off',
          links: false
        })
        editor.onDidChangeModelContent(() => setDirty(editor.getValue() !== loaded.current?.text))
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current())
        editorRef.current = editor
        setEditor(editor)
        setReady(true)
      } catch (err) {
        if (!ctrl.signal.aborted) setError(t('preview.error') + `\n${(err as Error).message}`)
      }
    })()
    return () => {
      disposed = true
      ctrl.abort()
      const editor = editorRef.current
      editorRef.current = null
      setEditor(null)
      // Leaving with unsaved edits (another file selected, Quick Look closed): save them, like an
      // editor with auto-save would. A conflict on disk is reported instead of overwriting it.
      if (editor && latest.current.dirty && loaded.current) {
        const { modified, bom } = loaded.current
        const { entry: e, onError } = latest.current.props
        api.preview.save(e.path, editor.getValue(), modified, bom).catch(onError)
      }
      editor?.getModel()?.dispose()
      editor?.dispose()
    }
    // entry.path, not entry: a new listing object for the same file must not recreate the editor.
  }, [entry.path, language, theme, mode])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !editing, domReadOnly: !editing })
    if (editing) editorRef.current?.focus()
  }, [editing, ready])

  // The file changed on disk (an agent, another editor, or our own save). Reload it unless there are
  // unsaved edits – then the conflict is shown and the user decides.
  useEffect(() => {
    const base = loaded.current
    const editor = editorRef.current
    if (!ready || !base || !editor || Math.abs(entry.modified - base.modified) <= 1) return
    if (latest.current.dirty) return setSave({ kind: 'conflict' })
    const ctrl = new AbortController()
    void loadText(entry.path, ctrl.signal).then(
      (file) => {
        const view = editor.saveViewState()
        loaded.current = { ...file, modified: entry.modified }
        if (editor.getValue() !== file.text) editor.setValue(file.text)
        if (view) editor.restoreViewState(view)
        setTruncated(file.truncated)
        setDirty(false)
      },
      () => {}
    )
    return () => ctrl.abort()
  }, [entry.modified, entry.size, entry.path, ready])

  const base = useGitBase(entry.path, entry.modified)
  const inRepo = base !== undefined
  useChangeBars(editor, base)
  useBlame(showBlame && !showDiff ? editor : null, entry.path, entry.modified)
  useDiffView(showDiff && inRepo ? editor : null, diffHost, base, mode === 'overlay')

  const reload = (): void => {
    const editor = editorRef.current
    if (!editor) return
    void loadText(entry.path, new AbortController().signal).then((file) => {
      loaded.current = { ...file, modified: entry.modified }
      editor.setValue(file.text)
      setDirty(false)
      setSave({ kind: 'idle' })
    })
  }

  if (error) return <Note text={error} error />
  return (
    <div className="preview-text">
      <div className="preview-tools">
        <button
          className={`xp-button${editing ? ' pressed' : ''}`}
          disabled={!canEdit || showDiff}
          title={ready && !canEdit && !props.readOnly ? t('preview.notEditable') : undefined}
          onClick={() => setEditing((e) => !e)}
        >
          {t(editing ? 'preview.done' : 'preview.edit')}
        </button>
        {editing && (
          <button className="xp-button" disabled={!dirty} title={`${t('preview.save')} (${keys.isMac ? '⌘S' : 'Ctrl+S'})`} onClick={() => void doSave()}>
            {t('preview.save')}
          </button>
        )}
        {inRepo && ready && (
          <>
            <button
              className={`xp-button${showDiff ? ' pressed' : ''}`}
              title={t('preview.diffTitle')}
              onClick={() => {
                setShowDiff((d) => !d)
                setEditing(false)
              }}
            >
              {t('preview.diff')}
            </button>
            <button
              className={`xp-button${showBlame ? ' pressed' : ''}`}
              disabled={base === null || showDiff}
              title={t('preview.blameTitle')}
              onClick={() => setShowBlame((b) => !b)}
            >
              {t('preview.blame')}
            </button>
          </>
        )}
        <span className={`preview-status${save.kind === 'conflict' || save.kind === 'error' ? ' error' : ''}`}>
          {save.kind === 'conflict'
            ? t('preview.changedOnDisk')
            : save.kind === 'error'
              ? save.message
              : dirty
                ? t('preview.unsaved')
                : save.kind === 'saved'
                  ? t('preview.saved')
                  : ''}
        </span>
        {save.kind === 'conflict' && (
          <>
            <button className="xp-button" onClick={() => void doSave(true)}>
              {t('preview.overwrite')}
            </button>
            <button className="xp-button" onClick={reload}>
              {t('preview.reload')}
            </button>
          </>
        )}
      </div>
      {!ready && <Note text={t('preview.loading')} />}
      <div ref={host} className="preview-editor" hidden={showDiff && inRepo} />
      {showDiff && inRepo && <div ref={diffHost} className="preview-editor" />}
      {truncated && <p className="preview-note">{t('preview.truncatedText', { size: formatSize(MAX_TEXT_BYTES) })}</p>}
    </div>
  )
}

/** The first opaque background behind el, else the theme's window colour. */
function backdrop(el: HTMLElement, theme: ThemeId): string {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const hex = cssColorToHex(getComputedStyle(node).backgroundColor)
    if (hex) return hex
  }
  return THEMES.find((x) => x.id === theme)?.background ?? '#ffffff'
}

/**
 * An editor theme over the pane's own background, light or dark to match the app theme. Themes with a
 * see-through pane (Matrix rain, J.A.R.V.I.S.) keep the editor transparent and judge by what shows through.
 */
export function editorTheme(monaco: MonacoApi, el: HTMLElement, theme: ThemeId): string {
  const own = cssColorToHex(getComputedStyle(el).backgroundColor)
  const bg = own ?? '#00000000'
  const fg = cssColorToHex(getComputedStyle(el).color)
  const dark = luminance(own ?? backdrop(el, theme)) < 0.35
  const name = `afinder-${theme}`
  monaco.editor.defineTheme(name, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      ...(fg ? { 'editor.foreground': fg } : {}),
      'editorGutter.background': bg,
      'editorLineNumber.foreground': dark ? '#6b7280' : '#a0a0a0'
    }
  })
  return name
}
