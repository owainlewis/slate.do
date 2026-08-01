#!/bin/sh
set -eu

target_url="${1:-}"
requests="${REQUESTS:-64}"
concurrency="${CONCURRENCY:-16}"
p95_limit_seconds="${P95_LIMIT_SECONDS:-1}"

case "$target_url" in
  https://*|http://localhost:*|http://127.0.0.1:*) ;;
  *)
    printf '%s\n' 'usage: scripts/check-capacity.sh https://staging.example.com/api/health' >&2
    exit 2
    ;;
esac
case "$requests:$concurrency" in
  *[!0-9:]*|0:*|*:0)
    printf '%s\n' 'REQUESTS and CONCURRENCY must be positive integers' >&2
    exit 2
    ;;
esac

results_dir="$(mktemp -d)"
trap 'rm -rf "$results_dir"' EXIT INT TERM

seq "$requests" | xargs -P "$concurrency" -n 1 sh -c '
  curl --fail --silent --show-error --max-time 10 \
    --output "$2/body.$3" --write-out "%{time_total}" "$1" >"$2/time.$3" || exit 1
  grep -F '\''"database":"ok"'\'' "$2/body.$3" >/dev/null || exit 1
' capacity-check "$target_url" "$results_dir"

p95_position="$(((requests * 95 + 99) / 100))"
p95_seconds="$(sort -n "$results_dir"/time.* | sed -n "${p95_position}p")"
if ! awk -v observed="$p95_seconds" -v limit="$p95_limit_seconds" 'BEGIN { exit !(observed <= limit) }'; then
  printf 'Capacity check failed: p95 %ss exceeds %ss\n' "$p95_seconds" "$p95_limit_seconds" >&2
  exit 1
fi

printf 'Capacity check passed: %s requests at concurrency %s, p95=%ss, target=%s\n' "$requests" "$concurrency" "$p95_seconds" "$target_url"
