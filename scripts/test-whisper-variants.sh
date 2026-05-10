#!/usr/bin/env bash
# scripts/test-whisper-variants.sh — self-contained live smoke test for the
# multi-variant whisper feature. Starts idn-tts, probes /whisper/variants,
# kicks off a load of tiny, and tears down.

set -eu
cd "$(dirname "${BASH_SOURCE[0]}")/.."

source "$HOME/miniconda3/etc/profile.d/conda.sh"
conda activate torch-gpu

echo "[1] launching idn-tts ..."
(cd idn-tts && python -m uvicorn service:app --host 127.0.0.1 --port 21128 \
  >/tmp/whisper-smoke.log 2>&1) &
IDN_PID=$!
trap 'kill $IDN_PID 2>/dev/null; sleep 1; kill -9 $IDN_PID 2>/dev/null; true' EXIT

echo "[2] waiting for service ..."
for i in $(seq 1 30); do
  if curl -sf -m 1 http://127.0.0.1:21128/health >/dev/null 2>&1; then
    echo "  up after ${i}s"; break
  fi
  sleep 1
done

echo ""
echo "[3] /whisper/variants (before any load) ==="
curl -s http://127.0.0.1:21128/whisper/variants | python3 -m json.tool

echo ""
echo "[4] /health whisper subsection ==="
curl -s http://127.0.0.1:21128/health | python3 -c "
import json, sys
d = json.load(sys.stdin)
w = d.get('whisper', {})
print(f'  enabled={w[\"enabled\"]}, default_variant={w.get(\"default_variant\")}')
print(f'  loaded={w[\"loaded\"]}, loading={w[\"loading\"]}')
for name, v in (w.get('variants') or {}).items():
    print(f'    {name:10s} model={v[\"model\"]:30s} loaded={v[\"loaded\"]} loading={v[\"loading\"]} err={v.get(\"error\")}')
"

echo ""
echo "[5] trigger load of 'tiny' variant (~150 MB, fastest to test) ==="
curl -s -X POST http://127.0.0.1:21128/whisper/load -F 'variant=tiny' | python3 -m json.tool

echo ""
echo "[6] poll /whisper/variants every 5 s for up to 60 s ==="
for i in $(seq 1 12); do
  sleep 5
  status=$(curl -s http://127.0.0.1:21128/whisper/variants | python3 -c "
import json, sys
d = json.load(sys.stdin)
v = d.get('variants',{}).get('tiny',{})
print(f\"loaded={v.get('loaded')}, loading={v.get('loading')}, error={v.get('error')}\")
")
  echo "  t=${i}0s: $status"
  if echo "$status" | grep -q 'loaded=True'; then
    echo ""
    echo "  ✓ tiny loaded"
    break
  fi
done

echo ""
echo "[7] transcribe with tiny variant (need an audio sample) ==="
if [ -f docs/samples/tts-wibowo.mp3 ]; then
  curl -s -X POST http://127.0.0.1:21128/whisper/transcribe \
    -F 'file=@docs/samples/tts-wibowo.mp3' \
    -F 'variant=tiny' \
    -F 'language=id' | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  variant: {d.get(\"variant\")}')
print(f'  model:   {d.get(\"model\")}')
print(f'  text:    {d.get(\"text\")}')
print(f'  duration: {d.get(\"duration\")} s')
"
fi
