#!/bin/sh
set -eu

if [ -z "${SLATE_TEST_DATABASE_URL:-}" ]; then
  printf '%s\n' 'SLATE_TEST_DATABASE_URL is required for the CI server suite' >&2
  exit 1
fi

test_log="$(mktemp)"
trap 'rm -f "$test_log"' EXIT INT TERM

if ! go test -count=1 -json ./server/... >"$test_log"; then
  cat "$test_log"
  exit 1
fi

if grep -F '(cached)' "$test_log" >/dev/null; then
  printf '%s\n' 'CI reused cached Go test results' >&2
  exit 1
fi
cat "$test_log"

if grep -E '"Action":"skip".*"Test":"' "$test_log" >/dev/null; then
  printf '%s\n' 'CI unexpectedly skipped one or more server tests:' >&2
  grep -E '"Action":"skip".*"Test":"' "$test_log" >&2
  exit 1
fi
