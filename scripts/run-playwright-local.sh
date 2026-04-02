#!/usr/bin/env bash
set -euo pipefail

PORT="${PLAYWRIGHT_PORT:-4173}"

if [[ -n "${PLAYWRIGHT_BASE_URL:-}" ]]; then
  echo "Running against $PLAYWRIGHT_BASE_URL"
  bun run test:pw
  exit 0
fi

echo "Running against local preview server on http://127.0.0.1:$PORT"
bun run build
PLAYWRIGHT_PORT="$PORT" bun run test:pw
