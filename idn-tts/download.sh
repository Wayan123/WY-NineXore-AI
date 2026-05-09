#!/usr/bin/env bash
# Download the Wikidepia/indonesian-tts v1.2 release assets into ./models/.
# Idempotent: skips files that already exist with a non-zero size.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p models

BASE="https://github.com/Wikidepia/indonesian-tts/releases/download/v1.2"

FILES=(
  "checkpoint_1260000-inference.pth"
  "config.json"
  "speakers.pth"
)

for f in "${FILES[@]}"; do
  dst="models/$f"
  if [[ -s "$dst" ]]; then
    echo "have $f ($(du -h "$dst" | cut -f1))"
    continue
  fi
  echo "downloading $f ..."
  # -L follow redirects, --fail on HTTP errors, resume with -C -
  curl -L --fail -C - -o "$dst" "$BASE/$f" || {
    echo "failed to fetch $f"
    rm -f "$dst"
    exit 1
  }
done

echo ""
echo "all files present:"
ls -lh models/
