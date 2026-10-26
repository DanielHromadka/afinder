import { lazy, Suspense, useState } from 'react'
import { t, type MessageKey } from '@shared/i18n'
import { Icon, type IconName } from '../Icon'
import type { ToolProps } from './common'

// The Tools area: a list of small utilities on the left (a menu when the area is narrow), the chosen
// one on the right. Every tool is its own chunk, loaded the first time it is opened.

const TOOLS = {
  calc: { icon: 'calculator', load: () => import('./Calculator') },
  units: { icon: 'ruler', load: () => import('./Units') },
  hash: { icon: 'checksum', load: () => import('./Checksums') },
  image: { icon: 'convert', load: () => import('./ImageConvert') },
  dupes: { icon: 'duplicates', load: () => import('./Duplicates') },
  disk: { icon: 'diskMap', load: () => import('./DiskMap') },
  json: { icon: 'json', load: () => import('./JsonYaml') },
  encode: { icon: 'encoding', load: () => import('./Encoding') },
  generate: { icon: 'dice', load: () => import('./Generators') },
  regex: { icon: 'regex', load: () => import('./RegexTester') },
  time: { icon: 'clock', load: () => import('./TimeTool') },
  color: { icon: 'colors', load: () => import('./Colors') },
  clipboard: { icon: 'clipboard', load: () => import('./ClipboardHistory') },
  timer: { icon: 'stopwatch', load: () => import('./Timers') },
  clock: { icon: 'globe', load: () => import('./WorldClock') },
  scratch: { icon: 'scratchpad', load: () => import('./Scratchpad') },
  tasks: { icon: 'monitor', load: () => import('./SystemMonitor') }
} as const satisfies Record<string, { icon: IconName; load: unknown }>
export type ToolId = keyof typeof TOOLS
const IDS = Object.keys(TOOLS) as ToolId[]

const VIEWS = Object.fromEntries(IDS.map((id) => [id, lazy(TOOLS[id].load as () => Promise<{ default: React.ComponentType<ToolProps> }>)])) as Record<ToolId, React.LazyExoticComponent<React.ComponentType<ToolProps>>>

const remembered = (): ToolId => {
  try {
    const id = localStorage.getItem('afinder.tools.last')
    return IDS.includes(id as ToolId) ? (id as ToolId) : 'calc'
  } catch {
    return 'calc'
  }
}

export const toolName = (id: ToolId): string => t(`tools.${id}` as MessageKey)

export function ToolsPanel(props: ToolProps): React.JSX.Element {
  const [tool, setTool] = useState<ToolId>(remembered)
  // Tools stay mounted once opened, so a running timer or a long scan survives switching tools.
  const [opened, setOpened] = useState<ToolId[]>(() => [remembered()])
  const pick = (id: ToolId): void => {
    setTool(id)
    setOpened((o) => (o.includes(id) ? o : [...o, id]))
    try {
      localStorage.setItem('afinder.tools.last', id)
    } catch {
      // Only a convenience.
    }
  }
  return (
    <div className="tools-panel">
      <nav className="tools-nav" aria-label={t('editor.tools')}>
        {IDS.map((id) => (
          <button key={id} className={id === tool ? 'on' : ''} onClick={() => pick(id)}>
            <Icon name={TOOLS[id].icon} size={18} className="tools-icon" />
            {toolName(id)}
          </button>
        ))}
      </nav>
      <select className="tools-select" value={tool} onChange={(e) => pick(e.target.value as ToolId)}>
        {IDS.map((id) => (
          <option key={id} value={id}>
            {toolName(id)}
          </option>
        ))}
      </select>
      <div className="tools-body">
        {opened.map((id) => {
          const View = VIEWS[id]
          return (
            <div key={id} className="tool-page" hidden={id !== tool}>
              <h3 className="tool-title">
                <Icon name={TOOLS[id].icon} size={20} /> {toolName(id)}
              </h3>
              <Suspense fallback={<p className="tool-muted">…</p>}>
                <View {...props} visible={props.visible && id === tool} />
              </Suspense>
            </div>
          )
        })}
      </div>
    </div>
  )
}
