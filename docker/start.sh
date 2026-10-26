#!/bin/bash
set -Eeuo pipefail
if [[ ! "$AFINDER_SCREEN" =~ ^[0-9]{3,4}x[0-9]{3,4}x(16|24|32)$ ]]; then
  echo 'AFINDER_SCREEN must be WIDTHxHEIGHTxDEPTH, for example 1440x900x24' >&2
  exit 1
fi
mkdir -p "$XDG_CONFIG_HOME/aFinder" /tmp/afinder-runtime
chmod 700 /tmp/afinder-runtime
export XDG_RUNTIME_DIR=/tmp/afinder-runtime
# Seed only a new profile. Persisted user choices (including AI opt-ins) are never overwritten.
if [[ ! -e "$XDG_CONFIG_HOME/aFinder/settings.json" ]]; then
  printf '%s\n' '{"lastPath":"/workspace","autoUpdate":false}' > "$XDG_CONFIG_HOME/aFinder/settings.json"
fi
pids=()
cleanup() {
  trap - EXIT INT TERM
  if ((${#pids[@]})); then kill -TERM "${pids[@]}" 2>/dev/null || true; wait "${pids[@]}" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM
# A killed X server can leave locks across a container restart. This container owns its display.
display_number=${DISPLAY#:}; display_number=${display_number%%.*}
if [[ ! "$display_number" =~ ^[0-9]+$ ]]; then echo 'DISPLAY must name a local numeric display' >&2; exit 1; fi
rm -f "/tmp/.X${display_number}-lock" "/tmp/.X11-unix/X${display_number}" "$XDG_RUNTIME_DIR/pids"
Xvfb "$DISPLAY" -screen 0 "$AFINDER_SCREEN" -nolisten tcp &
pids+=("$!")
for ((i=0;i<100;i++)); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  kill -0 "${pids[0]}"; sleep 0.1
done
xdpyinfo -display "$DISPLAY" >/dev/null
openbox --sm-disable &
pids+=("$!")
vnc_auth=(-nopw)
if [[ -n "${AFINDER_VNC_PASSWORD_FILE:-}" ]]; then
  password=$(cat "$AFINDER_VNC_PASSWORD_FILE")
  if ((${#password}<6 || ${#password}>8)); then echo 'VNC password must be 6–8 characters' >&2; exit 1; fi
  x11vnc -storepasswd "$password" "$XDG_RUNTIME_DIR/vnc-password" >/dev/null
  unset password
  vnc_auth=(-rfbauth "$XDG_RUNTIME_DIR/vnc-password")
fi
# VNC is internal-only. The browser connects through the published websockify port.
x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -noxdamage "${vnc_auth[@]}" &
pids+=("$!")
websockify --web=/usr/share/novnc/ 6080 127.0.0.1:5900 &
pids+=("$!")
# Chromium's namespace sandbox is unavailable in ordinary Docker containers. This flag is
# confined to the non-root container launcher; native desktop builds retain their sandbox.
/opt/afinder/afinder --no-sandbox --disable-gpu "$@" &
pids+=("$!")
printf '%s\n' "${pids[@]}" > "$XDG_RUNTIME_DIR/pids"
set +e
wait -n "${pids[@]}"
code=$?
set -e
exit "$code"
