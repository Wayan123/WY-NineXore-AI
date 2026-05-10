#!/usr/bin/env bash
# scripts/make-samples.sh — generate small audio/image samples for the
# docs/samples/ directory. These are real Coqui VITS outputs at speed 1.2.

set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/docs/samples"
mkdir -p "$OUT"

source "$HOME/miniconda3/etc/profile.d/conda.sh"
conda activate torch-gpu

echo "[1/3] launching idn-tts ..."
(cd idn-tts && python -m uvicorn service:app --host 127.0.0.1 --port 21128 \
  >/tmp/samples-idn-tts.log 2>&1) &
IDN_PID=$!
trap 'kill $IDN_PID 2>/dev/null; sleep 1; kill -9 $IDN_PID 2>/dev/null; true' EXIT

echo "[2/3] waiting for idn-tts ..."
for i in $(seq 1 30); do
  if curl -sf -m 1 http://127.0.0.1:21128/health >/dev/null 2>&1; then
    echo "  up after ${i}s"; break
  fi
  sleep 1
done

echo "[3/3] synthesising 3 voice samples ..."
PHRASE="Halo, nama saya %s. Selamat datang di WY NineXore AI, konsol pengembang berbasis 9Router."
for voice in wibowo ardi gadis; do
  text=$(printf "$PHRASE" "$(tr '[:lower:]' '[:upper:]' <<< ${voice:0:1})${voice:1}")
  curl -s -X POST http://127.0.0.1:21128/synthesize \
    -H 'Content-Type: application/json' \
    -d "{\"text\":$(printf '%s' "$text" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))'),\"speaker\":\"$voice\",\"speed\":1.2}" \
    -o "$OUT/tts-$voice.wav"
  # Compress to MP3 so the repo only carries ~100 KB per sample. GitHub
  # doesn't embed <audio>; it opens MP3 links in a new tab with the
  # browser's native player, which plays fine.
  ffmpeg -loglevel error -y -i "$OUT/tts-$voice.wav" -codec:a libmp3lame -b:a 96k "$OUT/tts-$voice.mp3"
  rm -f "$OUT/tts-$voice.wav"
  echo "  ✓ $OUT/tts-$voice.mp3  ($(stat -c %s "$OUT/tts-$voice.mp3") bytes)"
done

# Also copy the Vision OCR sample image that gets used in the screenshots.
python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (640, 200), "white")
d = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
except: font = ImageFont.load_default()
d.text((20, 40), "Selamat datang di NineXore AI.", fill="black", font=font)
d.text((20, 100), "Hari ini cuaca cerah di Bali.", fill="black", font=font)
img.save("docs/samples/vision-input.png", optimize=True)
print("  ✓ docs/samples/vision-input.png")
PY

echo ""
ls -lh "$OUT"
