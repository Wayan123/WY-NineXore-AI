#!/usr/bin/env bash
# install-skills.sh — install the WY NineXore AI skill profile from the
# my-grand-project-skills upstream pack into .agents/skills/.
#
# Usage:
#   ./scripts/install-skills.sh              # smart-sync (keeps customisations)
#   ./scripts/install-skills.sh --force      # overwrite diverged local copies (a backup is taken)
#   ./scripts/install-skills.sh --dry-run    # preview decisions, no writes
#   ./scripts/install-skills.sh --verbose    # also log SKIP-IDENTICAL decisions
#
# Env overrides:
#   GRAND_SKILLS_REPO  path to the cloned my-grand-project-skills repo
#                      (default: $HOME/AI/my-grand-project-skills)
#
# See SKILLS.md for the full list of skills installed by the
# wy-nine-xore-local-tool profile and the rationale behind each pick.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAND_SKILLS_REPO="${GRAND_SKILLS_REPO:-$HOME/AI/my-grand-project-skills}"
PROFILE="wy-nine-xore-local-tool"
DEST="$PROJECT_ROOT/.agents/skills"

if [[ ! -d "$GRAND_SKILLS_REPO" ]]; then
  cat <<EOF >&2
[install-skills] Skill pack not found at: $GRAND_SKILLS_REPO

Clone it first, then re-run:

  git clone https://github.com/Wayan123/my-grand-project-skills.git \\
      "$GRAND_SKILLS_REPO"

Or set GRAND_SKILLS_REPO=/path/to/your/clone before running this script.
EOF
  exit 2
fi

PROFILE_FILE="$GRAND_SKILLS_REPO/profiles/$PROFILE/skills.list"

# Self-heal: if the upstream clone does not yet have our custom profile,
# write it. This keeps the install reproducible on a fresh clone.
if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "[install-skills] writing custom profile $PROFILE -> $PROFILE_FILE"
  mkdir -p "$(dirname "$PROFILE_FILE")"
  cat > "$PROFILE_FILE" <<'PROFILE'
# WY NineXore AI custom profile.
#
# Project shape: open-source local developer console for the 9Router AI
# gateway. FastAPI backend + vanilla-JS frontend (no React, no Node build).
# Runs on 127.0.0.1 only — no public web exposure, no SaaS infra,
# no multi-tenant, no DB beyond SQLite for local history.
#
# Goal of this profile: make the day-to-day dev loop stronger
# (planning / TDD / debugging), keep OSS hygiene tight (secret scanning,
# PRs, releases, contributor docs), and lift frontend / design / API
# quality without dragging in SaaS lifecycle skills that don't apply.

# --- core (always) -------------------------------------------------
portable-project-adapter
superpowers-suite
skill-evolution-engine
adaptive-master-architect

# --- OSS hygiene + delivery ---------------------------------------
github-delivery
secure-commit-guard
release-management
open-source-launch
security-validation
devops-cicd-pipeline

# --- frontend + design --------------------------------------------
build-web-apps-suite
awesome-design-md
gpt-taste

# --- backend / API quality ----------------------------------------
api-contract-design
observability-stack
PROFILE
fi

mkdir -p "$DEST"

echo "[install-skills] profile:    $PROFILE"
echo "[install-skills] source:     $GRAND_SKILLS_REPO"
echo "[install-skills] dest:       $DEST"
echo

# Forward all flags (--dry-run / --force / --verbose / --no-deps / --no-conflicts)
# to the upstream bootstrap script.
exec bash "$GRAND_SKILLS_REPO/scripts/bootstrap.sh" \
  --project-root "$PROJECT_ROOT" \
  --dest "$DEST" \
  --profile "$PROFILE" \
  "$@"
