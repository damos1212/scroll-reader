#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
binary="$project_dir/release/linux-unpacked/scroll-reader"

if [[ ! -x "$binary" ]]; then
  echo "Scroll Reader has not been built yet. Run: npm run dist" >&2
  exit 1
fi

exec "$binary" "$@"
