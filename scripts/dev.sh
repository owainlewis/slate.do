#!/usr/bin/env sh

# Local development uses Vite for frontend hot reload and the Go service only
# for API requests. Production continues to serve the compiled embedded assets.
set -eu

dev_database_url="${DATABASE_URL:-postgres://localhost/slate_dev?sslmode=disable}"
api_port="${SLATE_API_PORT:-8080}"
web_port="${SLATE_WEB_PORT:-8081}"

if [ "$api_port" = "$web_port" ]; then
  echo "SLATE_API_PORT and SLATE_WEB_PORT must use different ports" >&2
  exit 1
fi

DATABASE_URL="$dev_database_url" PORT="$api_port" COOKIE_SECURE=false go run ./server/cmd/slate serve &
api_pid=$!

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  kill "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

attempt=0
until curl -fsS "http://127.0.0.1:$api_port/api/health" >/dev/null 2>&1; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    if wait "$api_pid"; then api_status=0; else api_status=$?; fi
    echo "Slate API exited before it became ready" >&2
    exit "$api_status"
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Slate API did not become ready on port $api_port" >&2
    exit 1
  fi
  sleep 1
done

SLATE_API_URL="http://127.0.0.1:$api_port" SLATE_WEB_PORT="$web_port" npm run dev:web
