// The Doom tab: offers the download (nothing of Doom ships with aFinder), then runs it in doom.html – an
// iframe with its own CSP that may compile WebAssembly – and hands it the engine and WAD as bytes.

import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { DOOM_BYTES, DOOM_SOURCE_URL, DOOM_WAD, type DoomStatus } from '@shared/doom'
import { joinPath } from '@shared/paths'
import { previewUrl } from '@shared/preview'
import type { DoomFrameIn, DoomFrameOut } from '../../doom/protocol'
import { formatSize } from '../../lib/format'
import { Progress } from '../tools/common'

const bytes = async (path: string): Promise<ArrayBuffer> => {
  const res = await fetch(previewUrl(path))
  if (!res.ok) throw new Error(`${res.status}`)
  return res.arrayBuffer()
}

function DoomFrame({ dir, active, onRemove }: { dir: string; active: boolean; onRemove(): void }): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [run, setRun] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'running' | 'ended'>('loading')
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  const send = (m: DoomFrameIn, transfer: Transferable[] = []): void => frame.current?.contentWindow?.postMessage(m, '*', transfer)

  useEffect(() => {
    const onMessage = async (e: MessageEvent<DoomFrameOut>): Promise<void> => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      if (e.data.type === 'loaded') {
        try {
          const [wasm, wad] = await Promise.all([bytes(joinPath(dir, 'doom.wasm')), bytes(joinPath(dir, DOOM_WAD))])
          send({ type: 'visible', visible: activeRef.current })
          send({ type: 'start', wasm, wad, clickToPlay: t('games.doom.clickToPlay') }, [wasm, wad])
        } catch (err) {
          setPhase('ended')
          setError(String(err instanceof Error ? err.message : err))
        }
      } else if (e.data.type === 'running') setPhase('running')
      else {
        setPhase('ended')
        setError(e.data.error ?? null)
      }
    }
    const listener = (e: MessageEvent<DoomFrameOut>): void => void onMessage(e)
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [dir, run])

  useEffect(() => send({ type: 'visible', visible: active }), [active])

  const restart = (): void => {
    setPhase('loading')
    setError(null)
    setRun((n) => n + 1)
  }

  return (
    <div className="game">
      <div className="game-stage doom-stage">
        {phase !== 'ended' && <iframe key={run} ref={frame} className="doom-frame" src="./doom.html" title="Doom" />}
        {phase === 'loading' && <div className="game-overlay">{t('games.doom.loading')}</div>}
        {phase === 'ended' && (
          <div className="game-overlay">
            {error ? t('games.doom.crashed', { error }) : t('games.doom.quit')}{' '}
            <button className="todo-btn" onClick={restart}>
              {t('games.restart')}
            </button>
          </div>
        )}
      </div>
      <div className="game-hint doom-footer">
        <span>{t('games.hint.doom')}</span>
        <button className="todo-btn" onClick={onRemove}>
          {t('games.doom.remove')}
        </button>
      </div>
    </div>
  )
}

/** The Doom tab of the Games area. */
export function DoomGame({ active }: { active: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<DoomStatus | null>(null)

  useEffect(() => {
    void window.api.doom.status().then(setStatus)
    return window.api.doom.onChanged(setStatus)
  }, [])

  if (!status) return <div className="game" />
  if (status.state === 'ready') return <DoomFrame dir={status.dir} active={active} onRemove={() => void window.api.doom.remove().then(setStatus)} />

  return (
    <div className="game doom-intro">
      <p>{t('games.doom.intro', { size: formatSize(DOOM_BYTES) })}</p>
      <p className="game-hint">
        {t('games.doom.licence')}{' '}
        <a href={DOOM_SOURCE_URL} target="_blank" rel="noreferrer">
          {t('games.doom.source')}
        </a>
      </p>
      {status.state === 'downloading' ? (
        <Progress progress={{ done: Math.round((status.progress / 100) * DOOM_BYTES), total: DOOM_BYTES }} onCancel={() => void window.api.doom.cancel()} />
      ) : (
        <div>
          <button className="todo-btn" onClick={() => void window.api.doom.download().then(setStatus)}>
            {t('games.doom.download')}
          </button>
        </div>
      )}
      {status.state === 'failed' && <p className="tool-error">{t('games.doom.failed', { error: status.error })}</p>}
    </div>
  )
}
