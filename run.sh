#!/usr/bin/env bash
# run.sh — start WY NineXore AI.
#
# One command, one conda env. Activates `torch-gpu` by default, boots the
# optional local ML service (idn-tts: Coqui Bahasa TTS + Whisper) in the
# background, then runs the dashboard in the foreground. Ctrl-C stops both.
#
# Override the env with CONDA_ENV=my-env ./run.sh.
# Disable the local ML service entirely by setting IDN_TTS_ENABLED=false
# in .env (the dashboard will fall back to 9Router upstream voices/STT).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# 1. Activate conda env
# ---------------------------------------------------------------------------
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

ENV_NAME="${CONDA_ENV:-torch-gpu}"
if ! conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  echo "✗ conda env '$ENV_NAME' not found."
  echo "  create one with:  conda create -n $ENV_NAME python=3.10 -y"
  echo "  or override with: CONDA_ENV=my-env ./run.sh"
  exit 1
fi
conda activate "$ENV_NAME"
echo "✓ conda env: $ENV_NAME ($(python --version 2>&1))"

# ---------------------------------------------------------------------------
# 2. Load .env (.env.example is copied on first run)
# ---------------------------------------------------------------------------
if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  cp .env.example .env
  echo "✓ created .env from .env.example — edit it if needed."
fi
# shellcheck disable=SC1091
set -a; [[ -f .env ]] && source .env; set +a

# ---------------------------------------------------------------------------
# 3. Install / check Python deps (idempotent, quick when already satisfied)
# ---------------------------------------------------------------------------
if ! python -c "import fastapi, uvicorn, httpx, pydantic_settings" 2>/dev/null; then
  echo "→ installing dashboard deps…"
  pip install -q -r requirements.txt
fi

# ---------------------------------------------------------------------------
# 4. Probe 9Router upstream (non-fatal warning)
# ---------------------------------------------------------------------------
NR_URL="${NINEROUTER_URL:-http://localhost:20128}"
if ! curl -sf -m 3 "$NR_URL/api/health" >/dev/null; then
  echo "⚠  9Router at $NR_URL is not responding."
  echo "   the dashboard will still start; fix the upstream to actually use it."
fi

# ---------------------------------------------------------------------------
# 5. Ensure data dirs + output folders
# ---------------------------------------------------------------------------
mkdir -p "${DATA_DIR:-./data}/outputs"

# ---------------------------------------------------------------------------
# 6. Prepare local ML service (idn-tts)
# ---------------------------------------------------------------------------
IDN_TTS_ENABLED_LC="$(echo "${IDN_TTS_ENABLED:-true}" | tr '[:upper:]' '[:lower:]')"
IDN_TTS_PID=""
IDN_TTS_HOST_="${IDN_TTS_HOST:-127.0.0.1}"
IDN_TTS_PORT_="${IDN_TTS_PORT:-21128}"

# Tear down every child we spawned. Called both on EXIT and from signal
# handlers. The EXIT path must not call exit(); the signal path does call
# exit() so bash actually stops after the trap runs (otherwise bash would
# resume at the interrupted statement and keep going).
_kill_child() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4; do
      sleep 0.5
      kill -0 "$pid" 2>/dev/null || break
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}
cleanup() {
  trap '' INT TERM
  echo ""
  echo "→ shutting down…"
  _kill_child "${DASH_PID:-}"
  _kill_child "${IDN_TTS_PID:-}"
}
on_signal() { cleanup; exit 130; }
trap on_signal INT TERM
trap cleanup EXIT

if [[ "$IDN_TTS_ENABLED_LC" == "true" || "$IDN_TTS_ENABLED_LC" == "1" || "$IDN_TTS_ENABLED_LC" == "yes" ]]; then
  # Fetch Coqui TTS weights on first run (330 MB). Idempotent — skips if
  # already present.
  if [[ ! -s "idn-tts/models/checkpoint_1260000-inference.pth" ]]; then
    echo "→ fetching Coqui Indonesian TTS weights (~330 MB, first run only)…"
    ( cd idn-tts && bash download.sh ) || {
      echo "⚠  download failed — the dashboard will still start without local TTS."
    }
  fi

  if [[ -s "idn-tts/models/checkpoint_1260000-inference.pth" ]]; then
    # Pre-flight: if :PORT is already held by something, don't spawn a second
    # uvicorn that will silently bind-fail and leave a stale PID behind.
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE ":${IDN_TTS_PORT_}$"; then
      echo "⚠  idn-tts port $IDN_TTS_PORT_ already in use — assuming an existing"
      echo "   service is running. Not spawning a new one. Ctrl-C here will"
      echo "   NOT stop that other service."
      IDN_TTS_ADOPTED=1
    else
      echo "→ starting local ML service (idn-tts) on $IDN_TTS_HOST_:$IDN_TTS_PORT_…"
      (
        cd idn-tts
        exec python -m uvicorn service:app --host "$IDN_TTS_HOST_" --port "$IDN_TTS_PORT_"
      ) > /tmp/wy-nine-idn-tts.log 2>&1 &
      IDN_TTS_PID=$!

      # Wait up to 30 s for the service to answer /health. Check the child
      # is still alive *before* each curl, so a synchronous bind-failure
      # (or other crash) doesn't leave us polling forever.
      printf "   waiting for idn-tts to come up"
      for i in $(seq 1 30); do
        if ! kill -0 "$IDN_TTS_PID" 2>/dev/null; then
          echo ""
          echo "✗ idn-tts crashed during startup. log tail:"
          tail -20 /tmp/wy-nine-idn-tts.log
          IDN_TTS_PID=""
          break
        fi
        if curl -sf -m 1 "http://$IDN_TTS_HOST_:$IDN_TTS_PORT_/health" >/dev/null 2>&1; then
          echo " … ready (${i}s)."
          break
        fi
        printf "."
        sleep 1
      done
      if [[ -n "$IDN_TTS_PID" ]] && ! curl -sf -m 1 "http://$IDN_TTS_HOST_:$IDN_TTS_PORT_/health" >/dev/null 2>&1; then
        echo ""
        echo "⚠  idn-tts didn't answer within 30 s — the dashboard will start anyway."
        echo "   log: tail -f /tmp/wy-nine-idn-tts.log"
      fi
    fi
  fi
else
  echo "ℹ  local ML service disabled (IDN_TTS_ENABLED=$IDN_TTS_ENABLED)"
fi

# ---------------------------------------------------------------------------
# 7. Run the dashboard (foreground)
# ---------------------------------------------------------------------------
HOST="${APP_HOST:-127.0.0.1}"
PORT="${APP_PORT:-8765}"

echo ""
echo "  ╭──────────────────────────────────────────────────────╮"
echo "  │  WY NineXore AI                                       │"
echo "  │  dashboard:  http://$HOST:$PORT                      │"
if [[ -n "$IDN_TTS_PID" ]]; then
  echo "  │  local ML:   http://$IDN_TTS_HOST_:$IDN_TTS_PORT_ (idn-tts)         │"
fi
echo "  │  upstream:   $NR_URL                 │"
echo "  │                                                       │"
echo "  │  Ctrl-C stops everything.                             │"
echo "  ╰──────────────────────────────────────────────────────╯"
echo ""

# Run dashboard as a child so our EXIT trap keeps firing. ``wait`` lets bash
# handle SIGINT cleanly even when the child is holding the terminal.
python -m uvicorn backend.main:app --host "$HOST" --port "$PORT" &
DASH_PID=$!

# Wait for the dashboard. If it exits (e.g. port conflict), bash returns here
# and the EXIT trap tears down idn-tts. Preserve the real exit code so
# systemd Restart=on-failure actually fires on a crash.
set +e
wait "$DASH_PID"
rc=$?
set -e
exit "$rc"
