#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

sh "$repo_root/scripts/build-cli-release.sh" v0.0.0 "$tmp_dir"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp_dir" && sha256sum *.tar.gz > checksums.txt)
else
  (cd "$tmp_dir" && shasum -a 256 *.tar.gz > checksums.txt)
fi
sh "$repo_root/scripts/verify-cli-release.sh" v0.0.0 "$tmp_dir"

awk '$2 != "slate_linux_arm64.tar.gz"' "$tmp_dir/checksums.txt" > "$tmp_dir/incomplete-checksums.txt"
mv "$tmp_dir/incomplete-checksums.txt" "$tmp_dir/checksums.txt"
if sh "$repo_root/scripts/verify-cli-release.sh" v0.0.0 "$tmp_dir"; then
  printf 'release verification accepted an incomplete checksum manifest\n' >&2
  exit 1
fi
