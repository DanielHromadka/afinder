import { chars } from '@shared/matcher'

/** Renders a name with the matched characters underlined. */
export function Highlight({ text, hits }: { text: string; hits: number[] }): React.JSX.Element {
  if (hits.length === 0) return <>{text}</>
  const set = new Set(hits)
  const out: React.ReactNode[] = []
  let run = ''
  let runIsHit = false
  chars(text).forEach((ch, i) => {
    const isHit = set.has(i)
    if (isHit !== runIsHit && run) {
      out.push(runIsHit ? <u key={i} className="hit">{run}</u> : run)
      run = ''
    }
    run += ch
    runIsHit = isHit
  })
  if (run) out.push(runIsHit ? <u key="end" className="hit">{run}</u> : run)
  return <>{out}</>
}
