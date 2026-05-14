#!/usr/bin/env bash
# install-deps.sh — install Python dependencies for WY NineXore AI.
#
# This wraps the two-step install pattern documented in requirements.txt:
#
#   1. install everything in requirements.txt with normal pip resolution
#   2. install supertonic with --no-deps so its stale `numpy<2.0` pin
#      doesn't blow up the resolver. Its real runtime deps (numpy,
#      soundfile, onnxruntime, huggingface-hub) are pinned explicitly
#      in requirements.txt above.
#
# Usage (inside the torch-gpu conda env):
#   conda activate torch-gpu
#   bash scripts/install-deps.sh
#
# Re-run any time you pull. Idempotent — pip skips packages already at
# the requested version.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQ="$PROJECT_ROOT/requirements.txt"

# A best-effort env check. We don't insist on torch-gpu specifically because
# the user can pick any conda env; we just refuse to run outside one.
if [[ -z "${CONDA_PREFIX:-}" ]]; then
  echo "[install-deps] WARN: no CONDA_PREFIX detected. Activate the env first:"
  echo "    conda activate torch-gpu"
  echo "[install-deps] continuing anyway in 3 s…"
  sleep 3
fi

echo "[install-deps] step 1/2: pip install -r requirements.txt"
pip install -r "$REQ"

echo
echo "[install-deps] step 2/2: pip install --no-deps 'supertonic>=1.2,<2'"
echo "  (skipping supertonic's outdated numpy<2.0 pin; deps already covered above)"
pip install --no-deps 'supertonic>=1.2,<2'

echo
echo "[install-deps] verifying imports..."
python - <<'PY'
import importlib, sys
ok, fail = [], []
for name in ("fastapi", "uvicorn", "httpx", "pydantic",
             "numpy", "scipy", "soundfile", "librosa",
             "transformers", "onnxruntime", "huggingface_hub",
             "TTS", "g2p_id", "supertonic"):
    try:
        importlib.import_module(name); ok.append(name)
    except Exception as e:
        fail.append(f"{name}: {e}")
print("  ok:", ", ".join(ok))
if fail:
    print("  FAIL:")
    for f in fail: print("   -", f)
    sys.exit(1)
PY

echo
echo "[install-deps] done. Models will auto-download on first use:"
echo "  - Coqui Indonesian VITS:  ~260 MB on first /api/tts/speak with coqui/*"
echo "  - Whisper variants:       150 MB / 1.5 GB / 2.9 GB on first STT"
echo "  - Supertonic 3:           260 MB on first /api/tts/speak with supertonic/*"
