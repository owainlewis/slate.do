#!/bin/sh

set -eu

if [ "$#" -ne 2 ]; then
  printf 'usage: %s <version> <output-directory>\n' "$0" >&2
  exit 1
fi

version=$1
output_dir=$2
repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
  printf 'version must look like v1.2.3\n' >&2
  exit 1
}

mkdir -p "$output_dir"
output_dir=$(CDPATH= cd -- "$output_dir" && pwd)
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
trap 'exit 1' HUP INT TERM

for target in darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do
  os=${target%/*}
  arch=${target#*/}
  archive="slate_${os}_${arch}.tar.gz"

  (
    cd "$repo_root/cli"
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build \
      -trimpath \
      -ldflags "-s -w -X main.version=$version" \
      -o "$build_dir/slate" \
      ./cmd/slate
  )
  tar -C "$build_dir" -czf "$output_dir/$archive" slate
done
