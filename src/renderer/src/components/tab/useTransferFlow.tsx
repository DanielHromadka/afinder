import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArchiveRequest, ConflictPolicy, FileEntry, TransferMode, TransferPlan, TransferProgress } from '@shared/types'
import { playSound } from '@renderer/lib/sound'
import { ConflictDialog, ProgressDialog } from '../TransferDialogs'

// Copying and moving in a tab: the plan from main, the conflict question, the progress dialog (shown only
// for operations that take a moment), the file clipboard with its "cut" marks, and archive creation, which
// shares the progress dialog. The tab reloads itself afterwards through `reload`.

const api = window.api
/** Quick operations finish without flashing a dialog. */
const PROGRESS_DELAY_MS = 400

export interface TransferFlow {
  /** Items cut to the clipboard (shown dimmed). */
  cutPaths: Set<string>
  /** A transfer or archive is running or asking: plain keys belong to its dialogs. */
  busy: boolean
  transfer(sources: string[], dest: string, mode: TransferMode | 'auto'): Promise<void>
  copyToClipboard(entries: FileEntry[], cut: boolean): Promise<void>
  /** Pastes into `dest` (moves when the files were cut, or always with `forceMove`, like ⌥⌘V in Finder). */
  paste(dest: string, forceMove?: boolean): Promise<void>
  createArchive(request: ArchiveRequest, onCreated: (created: string | null) => Promise<void>): Promise<void>
  /** The conflict and progress dialogs, rendered by the tab. */
  dialogs: React.ReactNode
}

export function useTransferFlow(options: { reload(selectPaths?: string[]): Promise<void>; currentPath: string | null; showError(err: unknown): void }): TransferFlow {
  const { reload, currentPath, showError } = options
  const [cutPaths, setCutPaths] = useState<Set<string>>(new Set())
  const [conflict, setConflict] = useState<{ plan: TransferPlan; resolve(p: ConflictPolicy | null): void } | null>(null)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [showProgress, setShowProgress] = useState(false)

  // Transfers run one at a time per window; only the tab that started one shows its progress.
  useEffect(() => api.onTransferProgress((p) => setProgress((cur) => (cur ? p : cur))), [])

  /** Runs `job` with the progress dialog appearing after a short delay and gone afterwards. */
  const withProgress = async (start: TransferProgress, job: () => Promise<void>): Promise<void> => {
    setProgress(start)
    const timer = setTimeout(() => setShowProgress(true), PROGRESS_DELAY_MS)
    try {
      await job()
    } finally {
      clearTimeout(timer)
      setShowProgress(false)
      setProgress(null)
    }
  }

  const transfer = async (sources: string[], dest: string, mode: TransferMode | 'auto'): Promise<void> => {
    if (sources.length === 0) return
    try {
      const plan = await api.planTransfer({ sources, dest, mode })
      let policy: ConflictPolicy = 'keepBoth'
      if (plan.conflicts.length) {
        const chosen = await new Promise<ConflictPolicy | null>((resolve) => setConflict({ plan, resolve }))
        setConflict(null)
        if (!chosen) return
        policy = chosen
      }
      await withProgress({ mode: plan.mode, done: 0, total: plan.sources.length, current: '' }, async () => {
        const created = await api.runTransfer(plan, policy)
        playSound('transfer')
        // Only what actually moved is no longer cut; an auto batch may have copied some items.
        const moved = new Set(plan.sources.filter((_, i) => plan.modes[i] === 'move').map((p) => p.normalize('NFC')))
        if (moved.size) setCutPaths((cut) => new Set([...cut].filter((p) => !moved.has(p.normalize('NFC')))))
        await reload(dest === currentPath ? created : undefined)
      })
    } catch (err) {
      showError(err)
      void reload()
    }
  }

  const copyToClipboard = async (entries: FileEntry[], cut: boolean): Promise<void> => {
    if (entries.length === 0) return
    const paths = entries.map((e) => e.path)
    try {
      await api.writeFileClipboard(paths, cut)
      playSound('copy')
      setCutPaths(new Set(cut ? paths : []))
    } catch (err) {
      showError(err)
    }
  }

  const paste = async (dest: string, forceMove = false): Promise<void> => {
    try {
      const clip = await api.readFileClipboard()
      if (clip.paths.length) await transfer(clip.paths, dest, clip.cut || forceMove ? 'move' : 'copy')
    } catch (err) {
      showError(err)
    }
  }

  const createArchive = async (request: ArchiveRequest, onCreated: (created: string | null) => Promise<void>): Promise<void> => {
    try {
      await withProgress({ mode: 'archive', done: 0, total: 0, current: '' }, async () => {
        const created = await api.createArchive(request)
        if (created) playSound('transfer')
        await onCreated(created)
      })
    } catch (err) {
      showError(err)
    }
  }

  const dialogs = (
    <>
      {conflict && createPortal(<ConflictDialog plan={conflict.plan} onChoose={conflict.resolve} />, document.body)}
      {progress && showProgress && createPortal(<ProgressDialog progress={progress} onCancel={api.cancelTransfer} />, document.body)}
    </>
  )

  return { cutPaths, busy: conflict !== null || progress !== null, transfer, copyToClipboard, paste, createArchive, dialogs }
}
