# Setup guide — from zero

A step-by-step walkthrough covering everything: conda, 9Router, provider keys, the local ML service, first-run verification.

Target: Linux or macOS with a modern shell. WSL works fine.

---

## 0. Prerequisites

| Need | Why | Install |
|---|---|---|
| **Miniconda** or Anaconda | manages Python envs | [docs.conda.io/miniconda](https://docs.conda.io/en/latest/miniconda.html) |
| **git** | clone this repo | your package manager |
| **curl** + **ffmpeg** | audio decoding in the local ML service (librosa fallback) | `sudo apt install curl ffmpeg` |
| **NVIDIA GPU + CUDA 12.x driver** | (optional) Coqui TTS + Whisper run far faster on GPU | `nvidia-smi` should show something |
| **A running 9Router** | the gateway this app talks to | see [9Router quick start](https://github.com/decolua/9router#readme) |

The dashboard itself is tiny. The weight is in PyTorch + CUDA, which you likely already have.

---

## 1. Get 9Router running

1. Clone and start 9Router per its README. Default URL: `http://localhost:20128`.
2. Verify:
   ```bash
   curl http://localhost:20128/api/health
   # → {"ok":true}
   ```
3. Open the 9Router dashboard and add at least one provider (see next section).
4. Optional but recommended: create an API key under `Dashboard → Keys`. Copy it for step 3 below.

### Providers to configure in 9Router

Everything the dashboard consumes is a 9Router provider. You don't need all of them; start with the ones you'll use.

| Provider | Use | Credentials needed |
|---|---|---|
| **Codex (OpenAI Plus)** | chat, code, image, vision — `cx/*` models | login with your ChatGPT Plus / Pro account via 9Router's Codex wizard |
| **NVIDIA NIM** | embeddings (`nvidia/nv-embedqa-e5-v5`), TTS | API key from [build.nvidia.com](https://build.nvidia.com/) |
| **DeepSeek** | general chat (`ds/*`) | API key from [deepseek.com](https://platform.deepseek.com/) |
| **Kolosal / Claude / K2 proxies** | `kr/*` models including Claude | provider-specific |
| **Tavily / Exa / Brave** | web search | each has a free tier + API key |
| **Firecrawl / Jina Reader** | URL → markdown | free tiers available |

Each provider has its own setup flow inside 9Router. Once added, its models appear under `/v1/models/*` and the dashboard picks them up automatically.

---

## 2. Clone this project

```bash
git clone https://github.com/Wayan123/WY-NineXore-AI.git
cd WY-NineXore-AI
```

You should see:
```
backend/   frontend/   idn-tts/   docs/   tests/
.env.example  README.md  run.sh  requirements.txt
```

---

## 3. Dashboard backend (`info-ai` env)

### Create the env

```bash
conda create -n info-ai python=3.10 -y
conda activate info-ai
pip install -r requirements.txt
```

This installs FastAPI, uvicorn, httpx, pydantic, pydantic-settings, and pytest.

### Configure

```bash
cp .env.example .env
$EDITOR .env
```

The only two lines that almost always need changing are:

```dotenv
NINEROUTER_URL=http://localhost:20128       # where 9Router listens
NINEROUTER_KEY=sk-xxxxxxxxxxxxxxxxxxxxxx    # from 9Router → Dashboard → Keys
```

Everything else has working defaults. See the full list in [`.env.example`](../.env.example).

### Run

```bash
./run.sh
```

You should see:

```
✓ conda env: info-ai (Python 3.10.x)
  ╭──────────────────────────────────────────────╮
  │  9Router Dashboard                           │
  │  http://127.0.0.1:8765                       │
  │  upstream: http://localhost:20128            │
  ╰──────────────────────────────────────────────╯
INFO:     Uvicorn running on http://127.0.0.1:8765
```

Open `http://127.0.0.1:8765` in a browser. The sidebar footer should say **upstream ready**.

### Pick your defaults (optional)

Browse **Models** in the UI and see what your 9Router instance has. Copy the IDs you use most into `.env`:

```dotenv
DEFAULT_CHAT_MODEL=ds/deepseek-chat
DEFAULT_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
```

Restart `./run.sh` to pick up changes.

---

## 4. Local ML service (`torch-gpu` env) — optional

Skip this section if you don't need Bahasa Indonesia TTS or offline Whisper. The dashboard works without it; you'll just miss the `coqui/*` voices and `local/whisper-large-v3`.

### Create the env (if you don't have one)

Requires a working NVIDIA driver with CUDA 12.x. Verify with `nvidia-smi`.

```bash
conda create -n torch-gpu python=3.10 -y
conda activate torch-gpu

# PyTorch matching your CUDA. Check https://pytorch.org/get-started/locally/ for the right index URL.
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
```

Then install the service deps:

```bash
cd idn-tts
pip install -r requirements.txt
```

Packages that get pulled in:
- `coqui-tts>=0.27` — VITS inference
- `g2p-id==0.0.4` — Wikidepia's grapheme→phoneme (matches the model's training-time preprocessor)
- `transformers>=4.40` — Whisper loader
- `accelerate`, `soundfile`, `librosa` — Whisper audio pipeline

### Fetch the Indonesian TTS weights

```bash
./download.sh
```

Downloads ~330 MB from [Wikidepia/indonesian-tts v1.2 release](https://github.com/Wikidepia/indonesian-tts/releases/tag/v1.2) into `idn-tts/models/`:

- `checkpoint_1260000-inference.pth` (model weights)
- `config.json` (model config)
- `speakers.pth` (speaker embedding table, 83 voices)

### Cache Whisper large-v3 (optional — will auto-download if missing)

If the model isn't in your HuggingFace cache, it'll download ~2.9 GB on the first transcribe request. To prime it now:

```bash
python - <<'PY'
from transformers import AutoProcessor, AutoModelForSpeechSeq2Seq
mid = "openai/whisper-large-v3"
AutoProcessor.from_pretrained(mid)
AutoModelForSpeechSeq2Seq.from_pretrained(mid)
print("whisper cached")
PY
```

### Run

```bash
./run.sh
# or: CONDA_ENV=my-torch-env ./run.sh
```

You should see:

```
conda env: torch-gpu (Python 3.10.x)

  local-ml service listening on http://127.0.0.1:21128
  TTS  endpoints: /synthesize  /v1/audio/speech
  STT  endpoints: /whisper/transcribe  /v1/audio/transcriptions
  info: /health  /speakers

INFO:     ready in 1.6s · device=cuda:NVIDIA GeForce RTX 4060 … · sr=22050 · 83 speaker(s)
```

Verify:

```bash
curl http://127.0.0.1:21128/health | jq .
```

Should show `loaded: true`, the CUDA device name, `n_speakers: 83`, and a `whisper` block with `enabled: true`.

### Reload the dashboard

Refresh `http://127.0.0.1:8765` — the sidebar footer should now say `idn-tts · 83 voices`.
The **Speak** panel will show a grouped dropdown with `coqui/wibowo` (default), `coqui/ardi`, `coqui/gadis`, then upstream voices, then 80 regional Coqui voices.
The **Transcribe** panel will show `local/whisper-large-v3` at the top with a "loads on first use" hint.

---

## 5. First-run verification checklist

Everything below should succeed after a fresh install.

```bash
# 1. dashboard answers
curl -sf http://127.0.0.1:8765/api/health
# → {"ok":true,"service":"9router-dashboard"}

# 2. upstream reachable
curl -s http://127.0.0.1:8765/api/upstream | jq .
# → {"reachable":true,"upstream":{"ok":true}}

# 3. idn-tts status (only if you started it)
curl -s http://127.0.0.1:8765/api/idn-tts/status | jq '.reachable, .n_speakers, .whisper.enabled'
# → true / 83 / true

# 4. list TTS models (should include coqui/* when local service is up)
curl -s 'http://127.0.0.1:8765/api/models?kind=tts' | jq '.data | length'

# 5. smoke test Coqui TTS
curl -X POST http://127.0.0.1:8765/api/tts/speak \
  -H 'Content-Type: application/json' \
  -d '{"model":"coqui/wibowo","input":"Halo, ini tes.","speed":1.2}' | jq '.url'

# 6. smoke test local Whisper (feed the file we just created)
#    replace FILE with the path from step 5's .url
FILE=data/outputs/$(curl -s -X POST http://127.0.0.1:8765/api/tts/speak \
  -H 'Content-Type: application/json' \
  -d '{"model":"coqui/wibowo","input":"halo dunia"}' | jq -r '.file' | cut -d/ -f2)
curl -s -X POST http://127.0.0.1:8765/api/stt/transcribe \
  -F "file=@$FILE" -F 'model=local/whisper-large-v3' -F 'language=id' \
  | jq '.result.text'
# → "halo dunia"

# 7. pytest (offline, uses fake upstream)
conda activate info-ai
pytest tests/ -q
# → 26 passed
```

---

## 6. Running everything with systemd (optional)

For machines where you want the services up at login, two simple systemd user units are enough.

`~/.config/systemd/user/wy-nine.service`:

```ini
[Unit]
Description=WY NineXore AI — dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/AI/WY-NineXore-AI
ExecStart=/bin/bash -lc 'source ~/miniconda3/etc/profile.d/conda.sh && conda activate info-ai && exec python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765'
Restart=on-failure

[Install]
WantedBy=default.target
```

`~/.config/systemd/user/wy-nine-idn-tts.service`:

```ini
[Unit]
Description=WY NineXore AI — local ML (Coqui + Whisper)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/AI/WY-NineXore-AI/idn-tts
ExecStart=/bin/bash -lc 'source ~/miniconda3/etc/profile.d/conda.sh && conda activate torch-gpu && exec python -m uvicorn service:app --host 127.0.0.1 --port 21128'
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable:

```bash
systemctl --user daemon-reload
systemctl --user enable --now wy-nine.service
systemctl --user enable --now wy-nine-idn-tts.service
systemctl --user status wy-nine
```

`loginctl enable-linger $USER` keeps the units alive after you log out.

---

## 7. Troubleshooting

**"upstream offline" in the sidebar**
Your 9Router isn't reachable. `curl http://localhost:20128/api/health` should return `{"ok":true}`. If you changed the URL, update `NINEROUTER_URL` in `.env`.

**401 on every request**
9Router has `requireApiKey=true`. Copy a key from `Dashboard → Keys` into `NINEROUTER_KEY=` in `.env` and restart `./run.sh`.

**TTS panel shows no `coqui/*` voices**
The local ML service isn't reachable. Check:
1. `curl http://127.0.0.1:21128/health` works
2. `IDN_TTS_ENABLED=true` in `.env`
3. Click **↻ refresh voices** at the top of the Speak panel.

**First transcribe is slow**
Whisper lazy-loads. Expect 10–15 s on a mid-range GPU. Later calls are <1 s.

**`libtorchaudio.so: undefined symbol`**
Your `torchaudio` version doesn't match `torch`. Fix:
```bash
pip install --upgrade "torchaudio==$(python -c 'import torch; print(torch.__version__.split("+")[0])').*" \
  --index-url https://download.pytorch.org/whl/cu128
```
(replace `cu128` with your CUDA build, e.g. `cu121`, `cu124`)

**Image generation: "Codex did not return an image. Plus/Pro required"**
9Router's Codex provider needs an active ChatGPT Plus or Pro login. Either log in again via 9Router's Codex wizard, or switch to a different image provider (Gemini, FLUX, Stability, Recraft) after adding that provider's key in 9Router.

**"file too large" on Vision upload**
The cap is 12 MB on raw bytes (~16 MB after base64). Resize the image first. The cap exists so the final JSON body stays under typical upstream-provider request limits.

---

## 8. Upgrading

```bash
git pull --ff-only
conda activate info-ai && pip install -r requirements.txt
# if you use the local ML service:
conda activate torch-gpu && pip install -r idn-tts/requirements.txt
```

Model weights don't move between minor versions; you don't need to re-run `./download.sh`.

---

## 9. Uninstall / clean

```bash
# stop processes
systemctl --user disable --now wy-nine wy-nine-idn-tts   # if installed via systemd
pkill -f 'uvicorn backend.main:app' ; pkill -f 'uvicorn service:app'

# remove repo + data
rm -rf ~/AI/WY-NineXore-AI

# (optional) drop conda envs
conda env remove -n info-ai
conda env remove -n torch-gpu
```
