#!/bin/sh
set -eu

if [ -z "${SLATE_TEST_DATABASE_URL:-}" ]; then
  printf '%s\n' 'SLATE_TEST_DATABASE_URL is required for the CI server suite' >&2
  exit 1
fi

test_log="$(mktemp)"
test_stream="$test_log.pipe"
test_pid=""
mkfifo "$test_stream"

cleanup() {
  if [ -n "$test_pid" ]; then
    kill "$test_pid" 2>/dev/null || true
    wait "$test_pid" 2>/dev/null || true
  fi
  rm -f "$test_log" "$test_stream"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

go test -count=1 -timeout=5m -json ./server/... >"$test_stream" 2>&1 &
test_pid=$!
tee "$test_log" <"$test_stream"
if wait "$test_pid"; then
  test_status=0
else
  test_status=$?
fi
test_pid=""

if [ "$test_status" -ne 0 ]; then
  printf 'Server CI suite failed with status %s\n' "$test_status" >&2
  exit "$test_status"
fi

if grep -F '(cached)' "$test_log" >/dev/null; then
  printf '%s\n' 'CI reused cached Go test results' >&2
  exit 1
fi

if grep -E '"Action":"skip".*"Test":"' "$test_log" >/dev/null; then
  printf '%s\n' 'CI unexpectedly skipped one or more server tests:' >&2
  grep -E '"Action":"skip".*"Test":"' "$test_log" >&2
  exit 1
fi
