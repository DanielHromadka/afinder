import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/xp.css'
// Feature styles in the order they always had: rules of equal weight later in the list win.
import './styles/features/panes.css'
import './styles/features/console.css'
import './styles/features/preview.css'
import './styles/features/dialogs.css'
import './styles/features/workspace.css'
import './styles/features/git.css'
import './styles/features/image-editor.css'
import './styles/features/recent-sessions.css'
import './styles/features/slideshow.css'
import './styles/features/todo.css'
import './styles/features/games-stocks.css'
import './styles/features/inline-folders.css'
import './styles/features/companion.css'
import './styles/features/tools.css'
import './styles/features/docker.css'
import './styles/features/task-manager.css'
import './styles/features/tour.css'
import './styles/features/disk-access.css'
import './styles/theme-classic.css'
import './styles/theme-cyberpunk.css'
import './styles/theme-fbi.css'
import './styles/theme-jarvis.css'
import './styles/theme-barbie.css'
import './styles/theme-batman.css'
import './styles/theme-bitcoin.css'
import './styles/theme-matrix.css'
import './styles/theme-dos.css'
import './styles/theme-apple.css'
import './styles/theme-apple-clean.css'

// Themes that follow platform conventions (the Apple theme's native traffic lights) style by it.
document.documentElement.dataset.platform = window.api.platform
// Windows/Linux in the Apple theme: the system's window buttons sit over the title bar (titleBarOverlay).
const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay
document.documentElement.toggleAttribute('data-native-buttons', overlay?.visible === true)
window.api.window.onFullScreen((on) => (document.documentElement.dataset.fullscreen = String(on)))
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
