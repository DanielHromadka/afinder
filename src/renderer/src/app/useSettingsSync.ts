import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/types'

// The window's settings: changes apply at once and are saved shortly after (column resizing fires on every
// mouse move); settings that switch features on or off are saved immediately. Changes made in another window
// arrive here, except what is this window's own. A failed save is reported once, until a save works again.

const api = window.api

/** These change what runs in main (models, indexing), so they are saved without waiting. */
const IMMEDIATE: (keyof Settings)[] = ['fileAssistantEnabled', 'fileAssistantReadContent', 'activityEnabled', 'semanticEnabled', 'activityRetentionDays']
const SAVE_DELAY_MS = 300

export interface SettingsSync {
  settings: Settings | null
  /** The first load (and a window taking over another's state). */
  setSettings(settings: Settings): void
  updateSettings(patch: Partial<Settings>): void
  /** Saves now and resolves when saved; for changes that must be in main before what follows (language). */
  saveNow(patch: Partial<Settings>): Promise<void>
  /** Saves what is not window state shown here (the window's layout); failures are reported like any save. */
  persist(patch: Partial<Settings>): void
}

export function useSettingsSync(showError: (err: unknown) => void, onOtherLanguage: () => void): SettingsSync {
  const [settings, setSettings] = useState<Settings | null>(null)
  const pending = useRef<Partial<Settings>>({})
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const failed = useRef(false)
  const report = useRef(showError)
  report.current = showError

  const save = useCallback((patch: Partial<Settings>): Promise<void> =>
    api.setSettings(patch).then(
      () => void (failed.current = false),
      (err: unknown) => {
        // One message per failure streak, not one per debounced save.
        if (!failed.current) report.current(err)
        failed.current = true
      }
    ), [])

  const flush = useCallback((): Promise<void> => {
    const patch = pending.current
    pending.current = {}
    return save(patch)
  }, [save])

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((s) => (s ? { ...s, ...patch } : s))
      pending.current = { ...pending.current, ...patch }
      clearTimeout(timer.current)
      if (IMMEDIATE.some((key) => key in patch)) return void flush()
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush]
  )

  const saveNow = useCallback(
    (patch: Partial<Settings>): Promise<void> => {
      setSettings((s) => (s ? { ...s, ...patch } : s))
      clearTimeout(timer.current)
      pending.current = { ...pending.current, ...patch }
      const all = pending.current
      pending.current = {}
      return api.setSettings(all)
    },
    []
  )

  // Settings changed in another window: take them over, except what is this window's own (its layout,
  // last folder and workspace) and what this window changed itself but has not saved yet.
  const languageRef = useRef(settings?.language)
  languageRef.current = settings?.language
  const otherLanguage = useRef(onOtherLanguage)
  otherLanguage.current = onOtherLanguage
  useEffect(
    () =>
      api.onSettingsChanged(({ layout: _layout, lastPath: _lastPath, activeWorkspace: _workspace, ...shared }) => {
        if (shared.language !== languageRef.current) otherLanguage.current()
        setSettings((s) => (s ? { ...s, ...shared, ...pending.current } : s))
      }),
    []
  )

  const persist = useCallback((patch: Partial<Settings>) => void save(patch), [save])

  return { settings, setSettings, updateSettings, saveNow, persist }
}
