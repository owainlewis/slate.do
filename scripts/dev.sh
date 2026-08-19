#!/usr/bin/env sh

# Local development uses Vite for frontend hot reload and the Go service only
# for API requests. Production continues to serve the compiled embedded assets.
set -eu

dev_database_url="${DATABASE_URL:-postgres://localhost/slate_dev?sslmode=disable}"
api_port="${SLATE_API_PORT:-8080}"

DATABASE_URL="$dev_database_url" PORT="$api_port" COOKIE_SECURE=false go run ./server/cmd/slate serve &
api_pid=$!

cleanup() {
  kill "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

SLATE_API_URL="http://127.0.0.1:$api_port" npm run dev:web
