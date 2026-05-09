#!/usr/bin/env bash
# scripts/capture-screenshots.sh — self-contained: starts services, waits,
# takes screenshots via headless Chrome, kills everything. Designed to be
# run once, end-to-end.

set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/docs/assets"
mkdir -p "$OUT"

# --- start services -------------------------------------------------------
source "$HOME/miniconda3/etc/profile.d/conda.sh"
conda activate torch-gpu

echo "[1/5] launching idn-tts (local ML) ..."
(cd idn-tts && python -m uvicorn service:app --host 127.0.0.1 --port 21128 \
  >/tmp/screenshot-idn-tts.log 2>&1) &
IDN_PID=$!

echo "[1/5] launching dashboard ..."
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765 \
  >/tmp/screenshot-dash.log 2>&1 &
DASH_PID=$!

cleanup() {
  echo "[cleanup] killing $DASH_PID $IDN_PID"
  kill "$DASH_PID" "$IDN_PID" 2>/dev/null || true
  sleep 1
  kill -9 "$DASH_PID" "$IDN_PID" 2>/dev/null || true
}
trap cleanup EXIT

# --- wait until both /health answer ---------------------------------------
echo "[2/5] waiting for services ..."
for i in $(seq 1 45); do
  dash=$(curl -sf -m 1 http://127.0.0.1:8765/api/health >/dev/null 2>&1 && echo 1 || echo 0)
  idn=$(curl -sf -m 1 http://127.0.0.1:21128/health >/dev/null 2>&1 && echo 1 || echo 0)
  if [ "$dash" = "1" ] && [ "$idn" = "1" ]; then
    echo "  both up after ${i}s"
    break
  fi
  sleep 1
done

# --- populate demo content (TTS, STT, Vision, Embed, Search, Fetch) ------
echo "[3/5] populating demo content for screenshots ..."
cd "$ROOT"

# create a test image for Vision panel
python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
import os
img = Image.new("RGB", (640, 200), "white")
d = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
except: font = ImageFont.load_default()
d.text((20, 40), "Selamat datang di NineXore AI.", fill="black", font=font)
d.text((20, 100), "Hari ini cuaca cerah di Bali.", fill="black", font=font)
img.save("/tmp/vision-demo.png")
print("  vision image ready")
PY

# TTS sample (also feeds STT demo)
curl -s -X POST http://127.0.0.1:8765/api/tts/speak \
  -H 'Content-Type: application/json' \
  -d '{"model":"coqui/wibowo","input":"Halo, ini tes suara dari Nine Ex-or AI, konsol pengembang berbasis 9Router.","speed":1.2}' \
  -o /tmp/tts-demo.json
LAST_TTS=$(python3 -c "import json; print(json.load(open('/tmp/tts-demo.json'))['file'])")

# STT demo (use the audio we just generated)
curl -s -X POST http://127.0.0.1:8765/api/stt/transcribe \
  -F "file=@$ROOT/data/$LAST_TTS" -F 'model=local/whisper-large-v3' -F 'language=id' \
  >/tmp/stt-demo.json

# Vision demo
curl -s -X POST http://127.0.0.1:8765/api/vision/extract \
  -F "file=@/tmp/vision-demo.png" \
  -F "model=cx/gpt-5.4" \
  -F "prompt=Baca semua teks pada gambar dan tulis ulang persis apa adanya." \
  >/tmp/vision-result.json

# Embedding demo
curl -s -X POST http://127.0.0.1:8765/api/embeddings/embed \
  -H 'Content-Type: application/json' \
  -d '{"model":"nvidia/nv-embedqa-e5-v5","input":["Hari ini cerah.","Cuaca hari ini panas.","Saya membeli sepeda merah.","Kucing bermain di taman."]}' \
  >/tmp/embed-demo.json

# Create a chat session with one turn
CHAT=$(curl -s -X POST http://127.0.0.1:8765/api/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title":"Perkenalan WY NineXore","model":"kr/claude-haiku-4.5"}')
SID=$(python3 -c "import json; print(json.loads('''$CHAT''')['id'])")
curl -s -X POST http://127.0.0.1:8765/api/chat/complete \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"kr/claude-haiku-4.5\",\"messages\":[{\"role\":\"user\",\"content\":\"Apa itu 9Router dan bagaimana WY NineXore AI menggunakannya? Jelaskan dalam 3 kalimat singkat.\"}],\"session_id\":\"$SID\"}" \
  >/tmp/chat-demo.json

echo "  demo content done"

# --- capture screenshots via headless Chrome ------------------------------
echo "[4/5] capturing screenshots ..."

capture() {
  local view="$1"
  local outjpg="$2"
  local url="http://127.0.0.1:8765/#/$view"
  local tmp="${outjpg%.jpg}.png"

  google-chrome --headless=new --disable-gpu --no-sandbox \
    --hide-scrollbars \
    --window-size=1400,900 \
    --screenshot="$tmp" \
    --virtual-time-budget=4000 \
    "$url" >/dev/null 2>&1
  if [ -f "$tmp" ]; then
    convert "$tmp" -trim +repage -strip -quality 75 "$outjpg" 2>/dev/null
    rm -f "$tmp"
    echo "  ✓ $(basename "$outjpg")  ($(stat -c %s "$outjpg") bytes)"
  else
    echo "  ✗ $view failed"
  fi
}

capture home     "$OUT/home.jpg"
capture chat     "$OUT/chat.jpg"
capture image    "$OUT/image.jpg"
capture tts      "$OUT/tts.jpg"
capture stt      "$OUT/stt.jpg"
capture vision   "$OUT/vision.jpg"
capture embed    "$OUT/embed.jpg"
capture search   "$OUT/search.jpg"
capture fetch    "$OUT/fetch.jpg"
capture models   "$OUT/models.jpg"
capture history  "$OUT/history.jpg"
capture settings "$OUT/settings.jpg"
capture help     "$OUT/help.jpg"

echo "[5/5] done."
echo ""
ls -lh "$OUT" | tail -n +2
