#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
  printf '%s\n' 'usage: validate-capacity.sh MAX_INSTANCES DB_MAX_CONNECTIONS DB_ALLOWANCE DB_RESERVE REQUEST_TIMEOUT_SECONDS' >&2
  exit 2
fi

max_instances="$1"
db_max_connections="$2"
db_allowance="$3"
db_reserve="$4"
request_timeout_seconds="$5"

for value in "$max_instances" "$db_max_connections" "$db_allowance" "$db_reserve" "$request_timeout_seconds"; do
  case "$value" in
    ''|*[!0-9]*|0)
      printf '%s\n' 'capacity values must be positive integers' >&2
      exit 2
      ;;
  esac
done

if ! awk -v maximum="$db_allowance" -v reserve="$db_reserve" 'BEGIN { exit !(reserve < maximum) }'; then
  printf '%s\n' 'DB reserve must be below the DB connection allowance' >&2
  exit 2
fi
if ! awk -v instances="$max_instances" -v pool="$db_max_connections" -v maximum="$db_allowance" -v reserve="$db_reserve" 'BEGIN { exit !(instances * pool <= maximum - reserve) }'; then
  printf '%s\n' 'unsafe database capacity: instances x pool exceeds the allowance after reserve' >&2
  exit 2
fi

printf 'Capacity preflight passed: normal=%s, distributed-cap=%s, request-timeout=%ss, Cloud-Run-timeout=%ss\n' \
  "$((max_instances * db_max_connections))" "$((db_allowance - db_reserve))" \
  "$request_timeout_seconds" "$((request_timeout_seconds + 5))"
