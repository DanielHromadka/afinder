#!/bin/bash
# Integration test against a built image; all files/profiles are disposable.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
image=${AFINDER_IMAGE:-afinder:0.9.0}
name="afinder-smoke-$$"
fixture=$(mktemp -d)
cleanup() { docker stop -t 20 "$name" >/dev/null 2>&1 || true; docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$fixture"; }
trap cleanup EXIT
mkdir "$fixture/work"
chmod 755 "$fixture"
chmod 777 "$fixture/work" # Disposable cross-platform mount, deliberately writable to UID 1000.
printf 'host fixture\n' > "$fixture/work/host.txt"
mounts=(--mount "type=bind,source=$fixture/work,target=/workspace")
if [[ -n "${AFINDER_LAYA_CACHE:-}" ]]; then mounts+=(--mount "type=bind,source=$AFINDER_LAYA_CACHE,target=/test-laya,readonly"); fi
docker run -d --name "$name" --shm-size=1g -p 127.0.0.1::6080 "${mounts[@]}" "$image" --remote-debugging-port=9222 >/dev/null
healthy=false
for ((i=0;i<60;i++)); do
  state=$(docker inspect --format '{{.State.Status}}/{{.State.Health.Status}}' "$name")
  if [[ "$state" == running/healthy ]]; then healthy=true; break; fi
  if [[ "$state" == exited/* || "$state" == dead/* ]]; then break; fi
  sleep 1
done
if [[ "$healthy" != true ]]; then docker logs "$name"; exit 1; fi
port=$(docker port "$name" 6080/tcp | cut -d: -f2)
curl --fail --silent --output /dev/null "http://127.0.0.1:$port/vnc.html"
python3 - "$port" <<'PYTHON'
import socket, sys, base64, os
port=int(sys.argv[1])
with socket.create_connection(('127.0.0.1',port),timeout=5) as sock:
    nonce=base64.b64encode(os.urandom(16)).decode()
    request=f'GET /websockify HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {nonce}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n\r\n'
    sock.sendall(request.encode())
    data=b''
    while b'\r\n\r\n' not in data: data+=sock.recv(4096)
    headers,frame=data.split(b'\r\n\r\n',1)
    assert b'101 Switching Protocols' in headers, headers
    while len(frame)<14: frame+=sock.recv(4096)
    assert b'RFB 003.' in frame, frame
print('PASS live noVNC WebSocket bridge and VNC handshake')
PYTHON
docker exec "$name" bash -c 'test "$(id -u)" = 1000 && grep -q "host fixture" /workspace/host.txt && printf "container write\n" > /workspace/container.txt'
grep -q 'container write' "$fixture/work/container.txt"
docker exec "$name" python3 -c 'import json; s=json.load(open("/home/afinder/.config/aFinder/settings.json")); assert s.get("fileAssistantEnabled",False) is False; assert s.get("activityEnabled",False) is False; assert s["lastPath"]=="/workspace"'
docker cp scripts/smoke-docker.cjs "$name:/tmp/smoke-docker.cjs" >/dev/null
docker exec -e ELECTRON_RUN_AS_NODE=1 -e AFINDER_LAYA_CACHE="${AFINDER_LAYA_CACHE:+/test-laya}" "$name" /opt/afinder/afinder /tmp/smoke-docker.cjs
if [[ -n "${AFINDER_LAYA_CACHE:-}" ]]; then docker cp "$name:/tmp/afinder-docker-preview.png" /tmp/afinder-docker-preview.png >/dev/null; fi
docker exec "$name" bash -c 'printf "persisted\n" > "$HOME/profile-smoke-marker"'
docker restart -t 20 "$name" >/dev/null
docker exec "$name" bash -c 'test "$(cat "$HOME/profile-smoke-marker")" = persisted'
for ((i=0;i<60;i++)); do
  if docker exec "$name" /usr/local/bin/afinder-healthcheck >/dev/null 2>&1; then
    echo 'PASS Docker: non-root desktop, noVNC endpoint, read/write mount, default-off AI, real Electron IPC/UI and profile persistence after restart'
    exit 0
  fi
  sleep 1
done
docker logs "$name"
exit 1
