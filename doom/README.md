# Doom add-on for the Games panel

aFinder ships only the Doom tab and a small WASI host (`src/renderer/src/doom/`). The engine and the game data are a
separate download, fetched from the Games panel only after the user clicks Download:

- `doom.wasm`: [doomgeneric](https://github.com/ozkl/doomgeneric) at a pinned commit plus `afinder_platform.c`,
  compiled with wasi-sdk as a WASI reactor. GPLv2, see `COPYING`.
- `freedoom1.wad`: [Freedoom: Phase 1](https://freedoom.github.io/), BSD licence.
- `doom-source.tar.gz`: the complete corresponding source of `doom.wasm` (the GPL requires shipping it next to the binary).

The wasm talks to aFinder only through standard WASI calls and five exports (`dg_start`, `dg_tick`, `dg_key`,
`dg_screen`, `dg_width`/`dg_height`), so it stays a separate program and aFinder's own licence is unaffected.

## Release

```bash
doom/build.sh          # needs Docker; writes doom/out/ and prints sizes and SHA-256
```

Upload everything in `doom/out/` to the `doom-<n>` release of `DanielHromadka/afinder`, then put the printed
sizes and hashes and the release tag into `src/shared/doom.ts`.
