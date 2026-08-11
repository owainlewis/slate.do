#!/bin/sh

set -eu

if [ "$#" -ne 2 ]; then
  printf 'usage: %s <version> <release-directory>\n' "$0" >&2
  exit 1
fi

version=$1
release_dir=$2

printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
  printf 'version must look like v1.2.3\n' >&2
  exit 1
}

release_dir=$(CDPATH= cd -- "$release_dir" && pwd)
expected_archives='slate_darwin_amd64.tar.gz slate_darwin_arm64.tar.gz slate_linux_amd64.tar.gz slate_linux_arm64.tar.gz'

for archive in $expected_archives; do
  [ -f "$release_dir/$archive" ] || {
    printf 'missing release archive: %s\n' "$archive" >&2
    exit 1
  }
  entries=$(tar -tzf "$release_dir/$archive")
  [ "$entries" = "slate" ] || {
    printf '%s must contain only the slate binary\n' "$archive" >&2
    exit 1
  }
done

[ -f "$release_dir/checksums.txt" ] || {
  printf 'missing checksums.txt\n' >&2
  exit 1
}

for archive in $expected_archives; do
  expected=$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1; exit }' "$release_dir/checksums.txt")
  [ -n "$expected" ] || {
    printf 'checksum not found for %s\n' "$archive" >&2
    exit 1
  }
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$release_dir/$archive" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$release_dir/$archive" | awk '{print $1}')
  else
    printf 'sha256sum or shasum is required\n' >&2
    exit 1
  fi
  [ "$actual" = "$expected" ] || {
    printf 'checksum verification failed for %s\n' "$archive" >&2
    exit 1
  }
done

case "$(uname -s)/$(uname -m)" in
  Darwin/x86_64) host_archive=slate_darwin_amd64.tar.gz ;;
  Darwin/arm64) host_archive=slate_darwin_arm64.tar.gz ;;
  Linux/x86_64|Linux/amd64) host_archive=slate_linux_amd64.tar.gz ;;
  Linux/arm64|Linux/aarch64) host_archive=slate_linux_arm64.tar.gz ;;
  *) host_archive= ;;
esac

if [ -n "$host_archive" ]; then
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
  tar -xzf "$release_dir/$host_archive" -C "$tmp_dir"
  output=$("$tmp_dir/slate" version)
  [ "$output" = "{\"version\":\"$version\"}" ] || {
    printf 'slate version returned %s, want %s\n' "$output" "$version" >&2
    exit 1
  }
fi
