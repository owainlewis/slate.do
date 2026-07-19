#!/bin/sh

set -eu

repository=${SLATE_GITHUB_REPOSITORY:-owainlewis/slate.do}
install_dir=${SLATE_INSTALL_DIR:-"$HOME/.local/bin"}
release=${SLATE_VERSION:-latest}

fail() {
  printf 'slate: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

archive="slate_${os}_${arch}.tar.gz"
if [ "$release" = "latest" ]; then
  download_url="https://github.com/$repository/releases/latest/download"
else
  download_url="https://github.com/$repository/releases/download/$release"
fi

tmp_dir=$(mktemp -d)
staged_binary=
cleanup() {
  rm -rf "$tmp_dir"
  [ -z "$staged_binary" ] || rm -f "$staged_binary"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

curl -fsSL "$download_url/$archive" -o "$tmp_dir/$archive"
curl -fsSL "$download_url/checksums.txt" -o "$tmp_dir/checksums.txt"

expected=$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1; exit }' "$tmp_dir/checksums.txt")
[ -n "$expected" ] || fail "checksum not found for $archive"

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp_dir/$archive" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp_dir/$archive" | awk '{print $1}')
else
  fail "sha256sum or shasum is required"
fi

[ "$actual" = "$expected" ] || fail "checksum verification failed"

tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"
[ -f "$tmp_dir/slate" ] || fail "release archive does not contain slate"

mkdir -p "$install_dir"
staged_binary="$install_dir/.slate.$$"
install -m 0755 "$tmp_dir/slate" "$staged_binary"
mv -f "$staged_binary" "$install_dir/slate"
staged_binary=

printf 'Installed slate to %s/slate\n' "$install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to your PATH to run slate.\n' "$install_dir" ;;
esac
