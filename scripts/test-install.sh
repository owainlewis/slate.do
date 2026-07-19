#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

fixture_dir="$tmp_dir/fixtures"
bin_dir="$tmp_dir/bin"
install_dir="$tmp_dir/install"
mkdir -p "$fixture_dir" "$bin_dir"

printf '#!/bin/sh\nprintf "fixture slate\\n"\n' > "$tmp_dir/slate"
chmod +x "$tmp_dir/slate"
tar -C "$tmp_dir" -czf "$fixture_dir/slate_linux_amd64.tar.gz" slate
(
  cd "$fixture_dir"
  sha256sum slate_linux_amd64.tar.gz > checksums.txt
)

cat > "$bin_dir/uname" <<'EOF'
#!/bin/sh
case "$1" in
  -s) printf 'Linux\n' ;;
  -m) printf 'x86_64\n' ;;
  *) exit 1 ;;
esac
EOF

cat > "$bin_dir/curl" <<EOF
#!/bin/sh
url=\$2
output=\$4
cp "$fixture_dir/\${url##*/}" "\$output"
EOF
chmod +x "$bin_dir/uname" "$bin_dir/curl"

PATH="$bin_dir:$PATH" \
SLATE_INSTALL_DIR="$install_dir" \
SLATE_VERSION=v1.0.0 \
sh "$repo_root/install.sh"

output=$("$install_dir/slate")
[ "$output" = "fixture slate" ] || {
  printf 'installed binary returned %s\n' "$output" >&2
  exit 1
}

printf '#!/bin/sh\nprintf "upgraded slate\\n"\n' > "$tmp_dir/slate"
chmod +x "$tmp_dir/slate"
tar -C "$tmp_dir" -czf "$fixture_dir/slate_linux_amd64.tar.gz" slate
(
  cd "$fixture_dir"
  sha256sum slate_linux_amd64.tar.gz > checksums.txt
)

PATH="$bin_dir:$PATH" \
SLATE_INSTALL_DIR="$install_dir" \
SLATE_VERSION=v1.0.1 \
sh "$repo_root/install.sh"

output=$("$install_dir/slate")
[ "$output" = "upgraded slate" ] || {
  printf 'upgraded binary returned %s\n' "$output" >&2
  exit 1
}

printf '%064d  slate_linux_amd64.tar.gz\n' 0 > "$fixture_dir/checksums.txt"
if PATH="$bin_dir:$PATH" \
  SLATE_INSTALL_DIR="$install_dir" \
  SLATE_VERSION=v1.0.2 \
  sh "$repo_root/install.sh"; then
  printf 'installer accepted an invalid checksum\n' >&2
  exit 1
fi

output=$("$install_dir/slate")
[ "$output" = "upgraded slate" ] || {
  printf 'failed upgrade replaced the existing binary\n' >&2
  exit 1
}
