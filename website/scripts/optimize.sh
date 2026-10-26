#!/bin/sh
# Turns the raw screenshots (img/raw/*.png, 2560 px wide) into the WebP files the page loads.
# Needs cwebp (brew install webp). Large images get a 1280 px variant for srcset.
set -eu
cd "$(dirname "$0")/../img"
for src in raw/*.png; do
  name=$(basename "$src" .png)
  cwebp -quiet -q 80 -resize 2400 0 "$src" -o "$name.webp"
  cwebp -quiet -q 78 -resize 1280 0 "$src" -o "$name-1280.webp"
done
sips -Z 256 ../../build/icon.png --out icon.png >/dev/null
sips -Z 64 ../../build/icon.png --out favicon.png >/dev/null
ls -l *.webp | awk '{ total += $5 } END { printf "%d files, %.1f MB\n", NR, total / 1048576 }'
