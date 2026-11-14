#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${PORT:-3000}"

for cmd in node npm cloudflared; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd"
    echo "Install Node.js/npm and cloudflared, then run this script again."
    exit 1
  fi
done

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo "Starting Node server on port ${PORT}..."
PORT="$PORT" npm start &
NODE_PID=$!

cleanup() {
  echo
  echo "Stopping Chat Call App..."
  kill "$NODE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Cloudflare Quick Tunnel. Copy the https://*.trycloudflare.com URL shown below."
cloudflared tunnel --url "http://127.0.0.1:${PORT}"
