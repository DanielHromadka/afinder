# syntax=docker/dockerfile:1
FROM node:24-bookworm AS build
ARG TARGETARCH
# Clang accepts the visibility/deprecation attributes in current Electron/V8 headers.
RUN apt-get update && apt-get install -y --no-install-recommends clang-19 && rm -rf /var/lib/apt/lists/*
ENV CC=clang-19 CXX=clang++-19 ONNXRUNTIME_NODE_INSTALL=skip
WORKDIR /build
COPY package.json package-lock.json .npmrc ./
# The empty stand-in for ssh2's optional cpu-features (package.json overrides), which npm ci installs from here.
COPY scripts/no-cpu-features ./scripts/no-cpu-features
RUN --mount=type=cache,target=/root/.npm npm ci
COPY electron-builder.yml electron.vite.config.ts tsconfig*.json ./
COPY src ./src
COPY build ./build
COPY scripts/after-pack.cjs scripts/build-input.cjs ./scripts/
# The remote desktop input helper (Rust, enigo with X11); after-pack.cjs packs it. Debian's cargo is too old for it.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
COPY native/afinder-input/Cargo.toml native/afinder-input/Cargo.lock ./native/afinder-input/
COPY native/afinder-input/src ./native/afinder-input/src
RUN PATH="/root/.cargo/bin:$PATH" npm run build:input -- --host
RUN npm run build
RUN case "$TARGETARCH" in arm64) arch=arm64 ;; amd64) arch=x64 ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac \
    && npx electron-builder --linux dir --"$arch" --publish never --config.directories.output=/build/release \
    && appdir="$(find /build/release -mindepth 1 -maxdepth 1 -type d -name '*unpacked' -print -quit)" \
    && test -n "$appdir" && mv "$appdir" /build/application

# Ubuntu LTS, the most common Linux desktop. Its image already has a user with uid 1000, replaced below.
FROM ubuntu:26.04 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tini dbus-x11 openbox xvfb x11-utils x11vnc novnc websockify \
    libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libdrm2 libxkbcommon0 \
    libxshmfence1 libsecret-1-0 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && userdel --remove ubuntu \
    && useradd --uid 1000 --create-home --shell /bin/bash afinder \
    && mkdir -p /workspace && chown afinder:afinder /workspace
COPY --from=build /build/application /opt/afinder
COPY --chmod=755 docker/start.sh /usr/local/bin/afinder-start
COPY --chmod=755 docker/healthcheck.sh /usr/local/bin/afinder-healthcheck
ENV HOME=/home/afinder DISPLAY=:99 XDG_CONFIG_HOME=/home/afinder/.config \
    AFINDER_SCREEN=1440x900x24
LABEL org.opencontainers.image.title="aFinder" org.opencontainers.image.version="0.9.0"
USER afinder
WORKDIR /workspace
EXPOSE 6080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["/usr/local/bin/afinder-healthcheck"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/bin/dbus-run-session", "--", "/usr/local/bin/afinder-start"]
