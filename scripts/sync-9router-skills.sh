#!/usr/bin/env bash
# sync-9router-skills.sh — re-vendor the 9Router gateway skill cards from
# upstream into vendor/9router-skills/ and refresh UPSTREAM.yaml.
#
# Usage:
#   ./scripts/sync-9router-skills.sh                 # use ~/AI/9router-skills-source
#   ./scripts/sync-9router-skills.sh --pull          # git pull the clone first
#   NINEROUTER_SKILLS_REPO=/path/to/clone ./scripts/sync-9router-skills.sh
#   ./scripts/sync-9router-skills.sh --diff          # show what would change, no writes
#
# After running, review `git diff vendor/9router-skills/`, then commit:
#   git add vendor/9router-skills && git commit -m "chore: refresh 9router skills snapshot"
#
# Why vendor instead of cloning at install time? So a fresh clone of this
# repo bootstraps without depending on an external 9router-skills-source
# checkout. The committed snapshot is the source of truth; the upstream
# clone is only consulted when this script is run on demand.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NINEROUTER_SKILLS_REPO="${NINEROUTER_SKILLS_REPO:-${HOME}/AI/9router-skills-source}"
VENDOR_DIR="$PROJECT_ROOT/vendor/9router-skills"

DO_PULL=0
DIFF_ONLY=0
for a in "$@"; do
  case "$a" in
    --pull)  DO_PULL=1 ;;
    --diff)  DIFF_ONLY=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

if [[ ! -d "$NINEROUTER_SKILLS_REPO/.git" ]]; then
  cat <<EOF >&2
[sync-9router] no upstream clone at: $NINEROUTER_SKILLS_REPO

Clone it once, then re-run:

  git clone https://github.com/decolua/9router.git \\
      "$NINEROUTER_SKILLS_REPO"

Or override with NINEROUTER_SKILLS_REPO=/path/to/clone.
EOF
  exit 2
fi

if [[ ! -d "$NINEROUTER_SKILLS_REPO/skills" ]]; then
  echo "[sync-9router] missing skills/ inside $NINEROUTER_SKILLS_REPO" >&2
  exit 2
fi

if [[ "$DO_PULL" -eq 1 ]]; then
  echo "[sync-9router] git pull --ff-only in $NINEROUTER_SKILLS_REPO"
  ( cd "$NINEROUTER_SKILLS_REPO" && git pull --ff-only )
fi

UPSTREAM_SHA="$(cd "$NINEROUTER_SKILLS_REPO" && git rev-parse HEAD)"
UPSTREAM_REF="$(cd "$NINEROUTER_SKILLS_REPO" && git describe --all --always 2>/dev/null || echo "")"
UPSTREAM_DATE="$(cd "$NINEROUTER_SKILLS_REPO" && git log -1 --format=%cI HEAD)"

if [[ "$DIFF_ONLY" -eq 1 ]]; then
  STAGE="$(mktemp -d -t 9router-skills-stage.XXXXXX)"
  trap 'rm -rf "$STAGE"' EXIT
  cp -r "$NINEROUTER_SKILLS_REPO/skills/." "$STAGE/"
  echo "[sync-9router] diff against current vendor/ (excluding UPSTREAM.yaml):"
  diff -ruN \
    --exclude=UPSTREAM.yaml \
    "$VENDOR_DIR" "$STAGE" || true
  echo ""
  echo "[sync-9router] upstream commit: $UPSTREAM_SHA ($UPSTREAM_REF)"
  exit 0
fi

mkdir -p "$VENDOR_DIR"
# Wipe everything except UPSTREAM.yaml so removed upstream files are
# reflected in the snapshot.
find "$VENDOR_DIR" -mindepth 1 -maxdepth 1 ! -name UPSTREAM.yaml -exec rm -rf {} +

cp -r "$NINEROUTER_SKILLS_REPO/skills/." "$VENDOR_DIR/"

cat > "$VENDOR_DIR/UPSTREAM.yaml" <<EOF
# Snapshot provenance for the 9Router skill cards vendored into this repo.
#
# These markdown skill cards (\`9router*\`) describe the OpenAI-compatible
# endpoints exposed by the 9Router gateway (chat / TTS / STT / image /
# embeddings / web-search / web-fetch). They are CONTENT, not code: AI
# coding agents read them to pick the right provider IDs and request shapes.
#
# Re-vendored by: scripts/sync-9router-skills.sh
upstream:
  repo: https://github.com/decolua/9router
  branch: master
  commit: ${UPSTREAM_SHA}
  ref: ${UPSTREAM_REF}
  commit_date: ${UPSTREAM_DATE}
  vendored_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  vendored_by: scripts/sync-9router-skills.sh
EOF

echo "[sync-9router] wrote $VENDOR_DIR (upstream $UPSTREAM_SHA, $UPSTREAM_REF)"
echo "[sync-9router] review with: git diff -- vendor/9router-skills"
echo "[sync-9router] then commit:  git add vendor/9router-skills && git commit -m 'chore: refresh 9router skills snapshot'"
