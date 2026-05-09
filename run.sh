#!/usr/bin/env bash
# run.sh — start the 9Router dashboard inside the `info-ai` conda env.
# Behaviour: gentle. Prints what it's doing. Quits early if something is off.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- 1. Activate conda env ----------------------------------------------------
CONDA_BASE=""
for cand in "$HOME/miniconda3" "$HOME/anaconda3" "/opt/conda"; do
  if [[ -f "$cand/etc/profile.d/conda.sh" ]]; then
    CONDA_BASE="$cand"; break
  fi
done

if [[ -z "$CONDA_BASE" ]]; then
  echo "✗ conda not found. Install miniconda or set CONDA_BASE."
  exit 1
fi

# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"

ENV_NAME="${CONDA_ENV:-info-ai}"
if ! conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  echo "✗ conda env '$ENV_NAME' not found."
  echo "  create it:  conda create -n $ENV_NAME python=3.10 -y"
  exit 1
fi

conda activate "$ENV_NAME"
echo "✓ conda env: $ENV_NAME ($(python --version 2>&1))"

# --- 2. Load .env -------------------------------------------------------------
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "✓ created .env from .env.example — edit it if needed."
  fi
fi

# shellcheck disable=SC1091
set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
set +a

HOST="${APP_HOST:-127.0.0.1}"
PORT="${APP_PORT:-8765}"
NR_URL="${NINEROUTER_URL:-http://localhost:20128}"

# --- 3. Install deps (idempotent, fast when already satisfied) ----------------
if ! python -c "import fastapi, uvicorn, httpx, pydantic_settings" 2>/dev/null; then
  echo "→ installing Python deps…"
  pip install -q -r requirements.txt
fi

# --- 4. Probe 9Router ---------------------------------------------------------
if ! curl -sf -m 3 "$NR_URL/api/health" >/dev/null; then
  echo "⚠  9Router at $NR_URL is not responding."
  echo "   start it first, or set NINEROUTER_URL in .env to the right address."
fi

# --- 5. Ensure data dirs ------------------------------------------------------
mkdir -p "${DATA_DIR:-./data}/outputs"

# --- 6. Run -------------------------------------------------------------------
echo ""
echo "  ╭──────────────────────────────────────────────╮"
echo "  │  9Router Dashboard                           │"
echo "  │  http://$HOST:$PORT                          │"
echo "  │  upstream: $NR_URL                           │"
echo "  ╰──────────────────────────────────────────────╯"
echo ""

exec uvicorn backend.main:app --host "$HOST" --port "$PORT" --reload
