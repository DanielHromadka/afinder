#!/bin/bash
set -euo pipefail
while read -r pid; do kill -0 "$pid"; done < /tmp/afinder-runtime/pids
curl --fail --silent --output /dev/null http://127.0.0.1:6080/vnc.html
