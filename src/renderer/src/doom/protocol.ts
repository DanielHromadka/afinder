// Messages between the Games panel and doom.html.

export type DoomFrameIn =
  | { type: 'start'; wasm: ArrayBuffer; wad: ArrayBuffer; clickToPlay: string }
  | { type: 'visible'; visible: boolean }

export type DoomFrameOut = { type: 'loaded' } | { type: 'running' } | { type: 'ended'; error?: string }
