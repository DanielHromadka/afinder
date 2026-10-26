import { useState } from 'react'
import { t, type MessageKey } from '@shared/i18n'
import { DoomGame } from './DoomGame'
import { GameCanvas, type CanvasGame } from './engine'
import { flappy } from './flappy'
import { kong } from './kong'
import { Minesweeper } from './Minesweeper'
import { snake } from './snake'
import { tetris } from './tetris'
import { tron } from './tron'

const CANVAS: Record<string, CanvasGame<never>> = { tetris, kong, tron, flappy, snake } as unknown as Record<string, CanvasGame<never>>
const GAMES = ['mines', 'tetris', 'kong', 'tron', 'flappy', 'snake', 'doom'] as const
type GameId = (typeof GAMES)[number]

const remembered = (): GameId => {
  try {
    const id = localStorage.getItem('afinder.games.last')
    return (GAMES as readonly string[]).includes(id ?? '') ? (id as GameId) : 'mines'
  } catch {
    return 'mines'
  }
}

/** The Games area: a picker on top and one game below; a hidden area pauses it. */
export function GamesPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const [game, setGame] = useState<GameId>(remembered)
  const pick = (id: GameId): void => {
    setGame(id)
    try {
      localStorage.setItem('afinder.games.last', id)
    } catch {
      // Only a convenience.
    }
  }
  return (
    <div className="games-panel">
      <div className="todo-seg games-tabs">
        {GAMES.map((id) => (
          <button key={id} className={id === game ? 'on' : ''} onClick={() => pick(id)}>
            {t(`games.${id}` as MessageKey)}
          </button>
        ))}
      </div>
      {game === 'mines' ? (
        <Minesweeper />
      ) : game === 'doom' ? (
        <DoomGame active={visible} />
      ) : (
        <GameCanvas key={game} id={game} game={CANVAS[game]} active={visible} hint={t(`games.hint.${game}` as MessageKey)} />
      )}
    </div>
  )
}
