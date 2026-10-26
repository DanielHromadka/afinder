// Whether something modal has the keyboard: a context menu, a dialog (ours or a native <dialog>) or the
// guided tour. The window's and the tabs' shortcuts both stand back while one is open.

const MODAL = '.context-menu, .modal-backdrop, dialog[open], .tour-overlay'

export const isModalOpen = (): boolean => document.querySelector(MODAL) !== null
