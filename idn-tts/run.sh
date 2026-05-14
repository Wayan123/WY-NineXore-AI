#!/usr/bin/env bash
# idn-tts/run.sh — start ONLY the local ML service (Coqui VITS + Whisper).
#
# You normally don't need this: the root `./run.sh` already spawns the
# local ML service alongside the dashboard. Use this script when you want
# to restart / debug the ML service in isolation, or to run it on a
# different host than the dashboard.

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
  echo "conda not found." >&2; exit 1
fi
# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"

ENV_NAME="${CONDA_ENV:-torch-gpu}"
if ! conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  echo "conda env '$ENV_NAME' not found. override with CONDA_ENV=xxx" >&2
  exit 1
fi
conda activate "$ENV_NAME"
echo "conda env: $ENV_NAME ($(python --version 2>&1))"

# --- 2. Ensure model files exist ---------------------------------------------
if [[ ! -s "models/checkpoint_1260000-inference.pth" ]]; then
  echo "model files missing. fetching..."
  bash download.sh
fi

# --- 3. Deps (should already be satisfied by root requirements.txt) ----------
if ! python -c "import TTS, g2p_id, transformers, fastapi, uvicorn, supertonic" 2>/dev/null; then
  echo "deps missing. running scripts/install-deps.sh ..."
  bash "$(dirname "$0")/../scripts/install-deps.sh"
  echo
fi

# --- 4. Run -------------------------------------------------------------------
HOST="${IDN_TTS_HOST:-127.0.0.1}"
PORT="${IDN_TTS_PORT:-21128}"

echo ""
echo "  idn-tts service listening on http://$HOST:$PORT"
echo "  TTS  endpoints: /synthesize  /v1/audio/speech"
echo "  STT  endpoints: /whisper/transcribe  /v1/audio/transcriptions"
echo "  info: /health  /speakers"
echo ""

exec python -m uvicorn service:app --host "$HOST" --port "$PORT"
