#!/usr/bin/env bash
# Builds the Doom add-on for aFinder's Games panel into doom/out/: doom.wasm (doomgeneric, GPLv2, as a
# WASI reactor), freedoom1.wad (Freedoom, BSD), their licences and doom-source.tar.gz – the complete
# corresponding source the GPL asks to ship next to the binary. Needs Docker; nothing else is installed.
# Upload the contents of out/ to the release named in src/shared/doom.ts, then pin the printed hashes.
set -euo pipefail

DOOMGENERIC_COMMIT=e257a09527062bfb986b6e5e0780839b6cbd5b71
FREEDOOM_VERSION=0.13.0
FREEDOOM_SHA256=3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59
WASI_SDK_IMAGE=ghcr.io/webassembly/wasi-sdk:wasi-sdk-25

here="$(cd "$(dirname "$0")" && pwd)"
work="$here/build"
out="$here/out"
rm -rf "$work" "$out"
mkdir -p "$work" "$out"

git clone --quiet https://github.com/ozkl/doomgeneric.git "$work/doomgeneric"
git -C "$work/doomgeneric" checkout --quiet "$DOOMGENERIC_COMMIT"
cp "$here/afinder_platform.c" "$work/doomgeneric/doomgeneric/"

# The engine files from doomgeneric's own Makefile, without the SDL sound/music and other platform layers.
src="dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net f_finale f_wipe g_game
  hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound i_system i_timer memio m_argv m_bbox m_cheat m_config
  m_controls m_fixed m_menu m_misc m_random p_ceilng p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj
  p_plats p_pspr p_saveg p_setup p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw r_main r_plane
  r_segs r_sky r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video wi_stuff w_checksum w_file w_main
  w_wad z_zone w_file_stdc i_input i_video doomgeneric afinder_platform"
files=$(for f in $src; do printf '%s.c ' "$f"; done)

docker run --rm -v "$work/doomgeneric/doomgeneric:/src" -w /src "$WASI_SDK_IMAGE" sh -c "
  /opt/wasi-sdk/bin/clang --target=wasm32-wasip1 -O2 -mexec-model=reactor \
    -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS \
    -Wno-everything -Wl,--strip-all -Wl,-z,stack-size=1048576 \
    $files -lwasi-emulated-signal -lwasi-emulated-process-clocks -o /src/doom.wasm"
cp "$work/doomgeneric/doomgeneric/doom.wasm" "$out/"

curl -fsSL -o "$work/freedoom.zip" "https://github.com/freedoom/freedoom/releases/download/v$FREEDOOM_VERSION/freedoom-$FREEDOOM_VERSION.zip"
echo "$FREEDOOM_SHA256  $work/freedoom.zip" | shasum -a 256 -c -
unzip -q -j "$work/freedoom.zip" "freedoom-$FREEDOOM_VERSION/freedoom1.wad" "freedoom-$FREEDOOM_VERSION/COPYING.txt" -d "$work/freedoom"
cp "$work/freedoom/freedoom1.wad" "$out/"
cp "$work/freedoom/COPYING.txt" "$out/FREEDOOM-COPYING.txt"
cp "$here/COPYING" "$out/DOOM-COPYING.txt"

# Complete corresponding source: doomgeneric at the pinned commit plus this folder.
rm -rf "$work/doomgeneric/.git" "$work/doomgeneric/doomgeneric/"*.o "$work/doomgeneric/doomgeneric/doom.wasm"
mkdir -p "$work/source"
cp -R "$work/doomgeneric" "$work/source/doomgeneric"
mkdir -p "$work/source/afinder"
cp "$here/afinder_platform.c" "$here/build.sh" "$here/COPYING" "$here/README.md" "$work/source/afinder/"
tar -czf "$out/doom-source.tar.gz" -C "$work/source" .

cd "$out"
for f in doom.wasm freedoom1.wad DOOM-COPYING.txt FREEDOOM-COPYING.txt; do
  printf "  { file: '%s', size: %s, sha256: '%s' },\n" "$f" "$(wc -c < "$f" | tr -d ' ')" "$(shasum -a 256 "$f" | cut -d' ' -f1)"
done
