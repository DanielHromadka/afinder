// The VS Code editor (Monaco) for the text preview, loaded on first use so it costs nothing at startup.
// Only the core editor and the Monarch grammars are bundled – no language services, which a
// read-only preview does not need.

import type * as Monaco from 'monaco-editor/editor/editor.api'

export type MonacoApi = typeof Monaco

let loading: Promise<MonacoApi> | null = null

export function loadMonaco(): Promise<MonacoApi> {
  loading ??= (async () => {
    const [monaco, { default: EditorWorker }] = await Promise.all([
      import('monaco-editor/editor/editor.api'),
      import('monaco-editor/editor/editor.worker?worker'),
      import('monaco-editor/basic-languages/monaco.contribution')
    ])
    self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
    return monaco
  })()
  return loading
}

/** "rgb(12, 34, 56)" → "#0c2238"; null for transparent or unparsable colours. */
export function cssColorToHex(color: string): string | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color.trim())
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

/** Relative luminance 0–1 of a "#rrggbb" colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
