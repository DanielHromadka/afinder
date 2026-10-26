import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t, type MessageKey } from '@shared/i18n'
import { keys } from '@renderer/lib/keys'

// The guided tour: one step at a time it lights up a real part of the window (everything else dimmed)
// and explains it in a balloon next to it. Targets are CSS selectors, mostly data-tour attributes; a
// step whose element is hidden in the current layout is shown in the middle of the window instead.

interface TourStep {
  id: string
  /** Each entry lights up the first visible element it matches, each in its own hole of the dimming. */
  targets: string[]
  /** A wider balloon, for texts with a list. */
  wide?: boolean
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', targets: [] },
  { id: 'navigation', targets: ['[data-tour="back"]', '[data-tour="forward"]', '[data-tour="up"]', '.addressbar'] },
  { id: 'tabs', targets: ['.tabstrip'] },
  { id: 'files', targets: ['.filelist'] },
  { id: 'filter', targets: ['.filter-box'] },
  { id: 'sidebar', targets: ['.area.area-tasks, .area.area-folders', '[data-tour="folders"]'] },
  { id: 'view', targets: ['[data-tour="view"]', '[data-tour="group"]'] },
  { id: 'panes', targets: ['[data-tour="panes"]'] },
  { id: 'preview', targets: ['[data-tour="preview"]'] },
  { id: 'console', targets: ['[data-tour="terminal"]', '[data-tour="console"]'] },
  { id: 'automations', targets: ['[data-tour="automations"]'] },
  { id: 'areaTypes', targets: ['.area-editor'], wide: true },
  { id: 'layout', targets: ['.area-grip', '.area-header', '.workspace-bar'], wide: true },
  { id: 'palette', targets: [] },
  { id: 'settings', targets: ['[data-tour="settings"]'] },
  { id: 'help', targets: ['[data-tour="help"]'] },
  { id: 'summary', targets: [], wide: true },
  { id: 'done', targets: [] }
]

const PAD = 6
const GAP = 12
const BALLOON_W = 340

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false
  return getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], .area-parking')
}

/** The targets on screen now. */
export function targetRects(step: TourStep): DOMRect[] {
  return step.targets.map((sel) => [...document.querySelectorAll(sel)].find(visible)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r)
}

/** All of them together: the balloon keeps clear of this. */
function union(rects: DOMRect[]): DOMRect | null {
  if (!rects.length) return null
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top)
}

const sameRects = (a: DOMRect[], b: DOMRect[]): boolean => a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height)

/** Below the target if it fits, else above, else beside it; always inside the window. */
function balloonPosition(target: DOMRect | null, w: number, h: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!target) return { left: (vw - w) / 2, top: (vh - h) / 2 }
  const clampX = (x: number): number => Math.max(8, Math.min(vw - w - 8, x))
  const clampY = (y: number): number => Math.max(8, Math.min(vh - h - 8, y))
  const centerX = target.left + target.width / 2 - w / 2
  if (target.bottom + PAD + GAP + h < vh) return { left: clampX(centerX), top: target.bottom + PAD + GAP }
  if (target.top - PAD - GAP - h > 0) return { left: clampX(centerX), top: target.top - PAD - GAP - h }
  const centerY = clampY(target.top + target.height / 2 - h / 2)
  if (target.right + PAD + GAP + w < vw) return { left: target.right + PAD + GAP, top: centerY }
  if (target.left - PAD - GAP - w > 0) return { left: target.left - PAD - GAP - w, top: centerY }
  // A target as big as the window (the file list in a small window): over its lower part.
  return { left: clampX(centerX), top: clampY(target.bottom - h - 24) }
}

/** Shortcuts named in the texts, as this platform and the user's bindings show them. */
const shortcuts = (): Record<string, string> => ({
  palette: keys.label('palette'),
  filter: keys.label('filter'),
  recursive: keys.label('recursive'),
  split: keys.label('split'),
  copyToPane: keys.label('copyToPane'),
  moveToPane: keys.label('moveToPane'),
  newTab: keys.label('newTab'),
  preview: keys.label('preview'),
  quickLook: keys.label('quickLook'),
  console: keys.label('toggleConsole'),
  maximizeArea: keys.label('maximizeArea'),
  tour: keys.label('tour') || 'F1'
})

export function Tour({ onClose }: { onClose(): void }): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [rects, setRects] = useState<DOMRect[]>([])
  const [size, setSize] = useState({ w: BALLOON_W, h: 180 })
  const balloon = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1

  const go = useCallback((to: number) => (to < 0 || to >= TOUR_STEPS.length ? onClose() : setIndex(to)), [onClose])

  // The layout moves (window resized, an area appears): follow it.
  useLayoutEffect(() => {
    const update = (): void => {
      const now = targetRects(step)
      setRects((old) => (sameRects(old, now) ? old : now))
    }
    update()
    const timer = setInterval(update, 300)
    window.addEventListener('resize', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', update)
    }
  }, [step])
  useLayoutEffect(() => {
    const el = balloon.current
    if (el && (el.offsetWidth !== size.w || el.offsetHeight !== size.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight })
  })
  useEffect(() => next.current?.focus(), [index])

  // Captured before the app's shortcuts; the app ignores keys while the tour is open (modalOpen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const action = e.key === 'Escape' ? -Infinity : e.key === 'ArrowRight' || e.key === 'Enter' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!action) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (action === -Infinity) onClose()
      else if (action === -1) setIndex((i) => Math.max(0, i - 1))
      else go(index + 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, index, onClose])

  const pos = balloonPosition(union(rects), size.w, size.h)
  const params = shortcuts()
  // A portal: the app's own containers must not clip or stack over the dimming (the XP title bar did).
  return createPortal(
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={t('tour.title')} data-step={step.id}>
      <svg className="tour-dim" width="100%" height="100%" aria-hidden="true">
        <defs>
          <mask id="tour-holes">
            <rect width="100%" height="100%" fill="#fff" />
            {rects.map((r, i) => (
              <rect key={i} x={r.left - PAD} y={r.top - PAD} width={r.width + PAD * 2} height={r.height + PAD * 2} rx={6} fill="#000" />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask="url(#tour-holes)" />
      </svg>
      {rects.map((r, i) => (
        <div key={i} className="tour-spotlight" style={{ left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }} />
      ))}
      <div ref={balloon} className={`tour-balloon${step.wide ? ' wide' : ''}`} style={pos}>
        <div className="tour-head">
          <span className="tour-title">{t(`tour.${step.id}.title` as MessageKey)}</span>
          <span className="tour-count">
            {index + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <TourText text={t(`tour.${step.id}.text` as MessageKey, params)} />
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.id} className={i === index ? 'on' : i < index ? 'seen' : ''} />
          ))}
        </div>
        <div className="tour-buttons">
          {!last && (
            <button className="link-button tour-skip" onClick={onClose}>
              {t('tour.skip')}
            </button>
          )}
          <span className="tour-spacer" />
          {index > 0 && (
            <button className="xp-button" onClick={() => go(index - 1)}>
              {t('tour.back')}
            </button>
          )}
          <button ref={next} className="xp-button tour-next" onClick={() => go(index + 1)}>
            {last ? t('tour.finish') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Lines starting with "• " become a list, so the texts stay plain strings in the dictionaries. */
function TourText({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  const items = lines.filter((l) => l.startsWith('• ')).map((l) => l.slice(2))
  const intro = lines.filter((l) => !l.startsWith('• ')).join(' ')
  return (
    <div className="tour-text">
      {intro && <p>{intro}</p>}
      {items.length > 0 && (
        <ul>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The one-time offer after the first start (or after the update that brought the tour). */
export function TourOffer({ onStart, onDismiss }: { onStart(): void; onDismiss(): void }): React.JSX.Element {
  return (
    <div className="tour-offer" role="status">
      <button className="tour-offer-close" title={t('tour.notNow')} onClick={onDismiss}>
        ✕
      </button>
      <strong>{t('tour.offerTitle')}</strong>
      <p>{t('tour.offerText', { tour: keys.label('tour') || 'F1' })}</p>
      <div className="tour-buttons">
        <span className="tour-spacer" />
        <button className="xp-button" onClick={onDismiss}>
          {t('tour.notNow')}
        </button>
        <button className="xp-button tour-next" onClick={onStart}>
          {t('tour.start')}
        </button>
      </div>
    </div>
  )
}
