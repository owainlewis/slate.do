#!/bin/sh
set -eu

commit_sha="${1:-}"
if [ -z "$commit_sha" ]; then
  printf '%s\n' 'usage: verify-github-ci.sh <commit-sha>' >&2
  exit 1
fi

api="https://api.github.com/repos/owainlewis/slate.do/commits/$commit_sha/check-runs?check_name=Required%20CI&filter=latest&per_page=10"
max_attempts="${VERIFY_GITHUB_CI_MAX_ATTEMPTS:-45}"
poll_seconds="${VERIFY_GITHUB_CI_POLL_SECONDS:-20}"
timeout_seconds="${VERIFY_GITHUB_CI_TIMEOUT_SECONDS:-900}"
deadline="$(( $(date +%s) + timeout_seconds ))"
attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  remaining="$((deadline - $(date +%s)))"
  if [ "$remaining" -le 0 ]; then
    break
  fi
  request_timeout=20
  if [ "$remaining" -lt "$request_timeout" ]; then
    request_timeout="$remaining"
  fi
  if response="$(curl --fail --silent --show-error --connect-timeout 10 --max-time "$request_timeout" -H 'Accept: application/vnd.github+json' "$api")"; then
    if result="$(printf '%s' "$response" | python3 -c '
import json, sys
runs = [
    run for run in json.load(sys.stdin).get("check_runs", [])
    if run.get("app", {}).get("slug") == "github-actions"
    and run.get("app", {}).get("id") == 15368
]
if not runs:
    print("missing")
elif any(run.get("status") != "completed" for run in runs):
    print("pending")
elif any(run.get("conclusion") != "success" for run in runs):
    conclusions = sorted({run.get("conclusion") or "unknown" for run in runs})
    print("failed:" + ",".join(conclusions))
else:
    print("success")
')"; then
      :
    else
      result="unavailable"
    fi
  else
    result="unavailable"
  fi
  case "$result" in
    success)
      printf 'Required CI passed for %s\n' "$commit_sha"
      exit 0
      ;;
    failed:*)
      printf 'Required CI failed for %s (%s)\n' "$commit_sha" "${result#failed:}" >&2
      exit 1
      ;;
    missing|pending)
      printf 'Waiting for Required CI on %s (%s)\n' "$commit_sha" "$result"
      ;;
    unavailable)
      printf 'Waiting for Required CI on %s (GitHub API unavailable)\n' "$commit_sha" >&2
      ;;
    *)
      printf 'Unexpected GitHub check response for %s: %s\n' "$commit_sha" "$result" >&2
      exit 1
      ;;
  esac
  attempt=$((attempt + 1))
  if [ "$attempt" -le "$max_attempts" ]; then
    remaining="$((deadline - $(date +%s)))"
    if [ "$remaining" -le 0 ]; then
      break
    fi
    sleep_seconds="$poll_seconds"
    if [ "$remaining" -lt "$sleep_seconds" ]; then
      sleep_seconds="$remaining"
    fi
    sleep "$sleep_seconds"
  fi
done

printf 'Timed out waiting for Required CI on %s\n' "$commit_sha" >&2
exit 1
