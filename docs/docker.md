# Deploy aFinder with Docker

This image runs the actual Linux Electron application on an Xvfb/Openbox desktop. noVNC provides browser access to that desktop. It is a single-user deployment, not a multi-user web rewrite; containers see their own Linux filesystem plus explicitly mounted folders, not native macOS disks or applications.

## Run locally

```sh
mkdir -p workspace
docker compose up -d --build
```

Open <http://localhost:6080/vnc.html?autoconnect=true&resize=scale>. The Compose file binds the port to localhost. `workspace/` is mounted as `/workspace`; the `afinder-profile` named volume preserves settings, history, automations, saved tags and downloaded models across container replacements. Both local AI features remain off by default. Model downloads still require an explicit action in Settings.

Use an existing folder instead:

```sh
AFINDER_WORKSPACE=/absolute/path/to/files docker compose up -d
```

Mounts are writable. For browsing only, add `read_only: true` to the `/workspace` bind mount in `compose.yaml`. On Linux, files must be accessible to container UID/GID 1000; choose appropriate host permissions rather than running the desktop as root. For a different port or desktop size, set `AFINDER_PORT=6081` or `AFINDER_SCREEN=1920x1080x24`.

```sh
docker compose ps
docker compose logs --tail=80
docker compose down
```

`down` keeps the profile volume. Do not add `--volumes` unless you intend to delete that profile. Container shutdown stops Electron and its desktop processes; Docker restarts the service if it fails. Health checks verify the desktop processes and the HTTP endpoint.

## Built artifacts

The local 0.9.0 build produces `dist/aFinder-arm64.dmg` and `dist/aFinder-0.9.0-linux-arm64-docker.tar.gz`, with checksums in `dist/aFinder-0.9.0-SHA256SUMS`. The exported image can be imported directly:

```sh
docker load --input dist/aFinder-0.9.0-linux-arm64-docker.tar.gz
```

The exported image and integration tests are for Linux ARM64 on this Apple Silicon Mac. AMD64 has a build path in the Dockerfile; it has not been runtime-tested here.

## Build and transport the image

```sh
docker build -t afinder:0.9.0 -t afinder:latest .
docker save afinder:0.9.0 | gzip > afinder-0.9.0-image.tar.gz
# On the destination host:
gunzip -c afinder-0.9.0-image.tar.gz | docker load
```

The Dockerfile selects the matching native Electron build for `linux/arm64` or `linux/amd64`. Build on the target architecture, or build a registry manifest with Buildx after substituting your own registry:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t YOUR_REGISTRY/afinder:0.9.0 --push .
```

Publishing is separate from the local build; this repository does not contain registry credentials. To deploy a pushed image, change `image:` in Compose and use `docker compose up -d --no-build`.

## Access and isolation

The default endpoint has no login and is bound to `127.0.0.1`. For remote use, keep that binding and put an authenticated HTTPS reverse proxy or an SSH tunnel in front of port 6080; the proxy must support WebSocket upgrades. Do not expose this file-management desktop directly to the public internet.

Optional VNC authentication: mount a secret file readable by UID 1000 and set `AFINDER_VNC_PASSWORD_FILE=/run/secrets/vnc_password`. Legacy VNC authentication supports only 6–8 characters; use authenticated HTTPS for real remote access. The raw VNC server listens on container loopback only and port 5900 is not published.

The image runs as a non-root user. Chromium's `--no-sandbox` is confined to the Docker launcher because ordinary containers cannot use its namespace sandbox; native desktop builds retain their existing sandbox. The container boundary and carefully chosen mounts provide deployment isolation. No Docker socket or host display socket is mounted. The MCP server remains disabled by default and is not published.

The runtime contains no Ollama or cloud agent CLI. Native application recommendations refer to installed Linux applications, not host applications. Audio and macOS integrations are not carried through noVNC. Local models use CPU and persist in the profile volume; allow additional memory and disk space before enabling them. Automatic desktop updates are disabled on a fresh container profile; rebuild and replace the image to update a Docker deployment.

## Verify a built image

```sh
bash scripts/smoke-docker.sh
# Also exercise the real offline decision model (verified model directory from Settings download):
AFINDER_LAYA_CACHE=/absolute/path/to/model bash scripts/smoke-docker.sh
```

The smoke test uses a disposable container, profile, random localhost port and temporary read/write folder. It checks HTTP/desktop health, non-root execution, actual host mount writes, default-off AI, real Electron UI/IPC activity recording, and restart persistence. The optional model test additionally exercises all eight assistant tasks and a confirmed collision-preserving move with the native Linux ONNX runtime. It does not modify personal application settings or source folders.
