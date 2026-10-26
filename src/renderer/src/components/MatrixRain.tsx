import { useEffect, useRef } from 'react'

/** Half-width katakana, digits and a few Latin letters, as in the film. */
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ZXCVBNMAEIOU:.=*+-<>¦'
const CELL = 16
const FPS = 20
/** How much of the previous frame fades per frame: lower = longer trails. */
const FADE = 'rgba(0, 4, 0, 0.09)'

const glyph = (): string => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]

/**
 * Digital rain behind the Matrix theme's window: one falling drop per column, a bright head
 * and a green trail that fades. Paused while the window is hidden; a still frame with reduced motion.
 */
export function MatrixRain(): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current!
    const ctx = el.getContext('2d')!
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let drops: number[] = []
    let width = 0
    let height = 0

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      width = el.clientWidth
      height = el.clientHeight
      el.width = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = `${CELL - 2}px 'SF Mono', Menlo, Consolas, monospace`
      ctx.textBaseline = 'top'
      const rows = Math.ceil(height / CELL)
      // Keep the columns already falling; new ones start somewhere above the top.
      drops = Array.from({ length: Math.ceil(width / CELL) }, (_, i) => drops[i] ?? -Math.floor(Math.random() * rows))
    }

    const step = (): void => {
      ctx.fillStyle = FADE
      ctx.fillRect(0, 0, width, height)
      const rows = Math.ceil(height / CELL)
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i]
        if (y >= 0) {
          // The cell above the head turns from white to green as the head moves on.
          ctx.fillStyle = '#00ff41'
          if (y > 0) ctx.fillText(glyph(), i * CELL, (y - 1) * CELL)
          ctx.fillStyle = '#d7ffe0'
          ctx.fillText(glyph(), i * CELL, y * CELL)
        }
        drops[i] = y > rows && Math.random() > 0.975 ? -Math.floor(Math.random() * 20) : y + 1
      }
    }

    resize()
    if (still) {
      // One settled frame: run the rain for a while without showing the steps.
      for (let i = 0; i < 120; i++) step()
      const observer = new ResizeObserver(() => {
        resize()
        for (let i = 0; i < 120; i++) step()
      })
      observer.observe(el)
      return () => observer.disconnect()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(el)
    let timer: ReturnType<typeof setInterval> | null = null
    const run = (): void => {
      if (timer) clearInterval(timer)
      timer = document.hidden ? null : setInterval(step, 1000 / FPS)
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', run)
      if (timer) clearInterval(timer)
    }
  }, [])

  return <canvas ref={canvas} className="matrix-rain" aria-hidden="true" />
}
