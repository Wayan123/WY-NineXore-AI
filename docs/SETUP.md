# Setup guide — from zero

A step-by-step walkthrough covering everything: conda, 9Router, provider keys, the local ML service, first-run verification.

Target: Linux or macOS with a modern shell. WSL works fine.

> **TL;DR** — one conda env (`torch-gpu`), one `./run.sh`. The script spawns
> both the dashboard and the local ML service and cleans up on Ctrl-C.

---

## 0. Prerequisites

| Need | Why | Install |
|---|---|---|
| **Miniconda** or Anaconda | manages the single Python env | [docs.conda.io/miniconda](https://docs.conda.io/en/latest/miniconda.html) |
| **git** | clone this repo | your package manager |
| **curl** + **ffmpeg** | audio decoding for local Whisper (librosa fallback) | `sudo apt install curl ffmpeg` |
| **NVIDIA GPU + CUDA 12.x driver** | Coqui TTS + Whisper run far faster on GPU (CPU works, much slower) | `nvidia-smi` should list a GPU |
| **A running 9Router** | gateway for all external providers | see [9Router quick start](https://github.com/decolua/9router#readme) |

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

Everything the dashboard consumes is a 9Router provider. You don’t need all of them; start with the ones you’ll use.

| Provider | Use | Credentials needed |
|---|---|---|
| **Codex (OpenAI Plus)** | chat, code, image, vision — `cx/*` models | login with your ChatGPT Plus / Pro account via 9Router’s Codex wizard |
| **NVIDIA NIM** | embeddings (`nvidia/nv-embedqa-e5-v5`), TTS | API key from [build.nvidia.com](https://build.nvidia.com/) |
| **DeepSeek** | general chat (`ds/*`) | API key from [deepseek.com](https://platform.deepseek.com/) |
| **Kolosal / Claude / K2 proxies** | `kr/*` models including Claude | provider-specific |
| **Tavily / Exa / Brave** | web search | each has a free tier + API key |
| **Firecrawl / Jina Reader** | URL → markdown | free tiers available |

Once added, the models appear under `/v1/models/*` and the dashboard picks them up automatically.

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

## 3. One conda env (`torch-gpu`)

A single env hosts both the dashboard and the local ML service. If you already have a `torch-gpu` env with PyTorch installed, skip the first two commands.

```bash
# create the env (one-time, first install only)
conda create -n torch-gpu python=3.10 -y
conda activate torch-gpu

# install PyTorch + torchaudio matching your CUDA build
# check https://pytorch.org/get-started/locally/ for the right index URL
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128

# install the rest (covers both services)
pip install -r requirements.txt
```

What that pulls in:
- **Dashboard**: fastapi, uvicorn, httpx, pydantic-settings
- **Local ML**: coqui-tts, g2p-id, transformers, accelerate, soundfile, librosa
- **Dev**: pytest, pytest-asyncio

Using a different env name (e.g. you already have one called `ml`)? Set `CONDA_ENV` when starting:

```bash
CONDA_ENV=ml ./run.sh
```

### Verify the env

```bash
python - <<'PY'
import torch, fastapi, TTS
print("torch:", torch.__version__, "cuda:", torch.cuda.is_available())
print("fastapi:", fastapi.__version__)
print("coqui-tts:", TTS.__version__)
PY
```

You should see CUDA `True`. If `False`, torch is CPU-only — the service still works, just slower.

---

## 4. Configure (`.env`)

```bash
cp .env.example .env
$EDITOR .env
```

The only two lines that almost always need changing:

```dotenv
NINEROUTER_URL=http://localhost:20128       # where 9Router listens
NINEROUTER_KEY=sk-xxxxxxxxxxxxxxxxxxxxxx    # from 9Router → Dashboard → Keys
```

Set `IDN_TTS_ENABLED=false` if you want to skip the local ML service entirely (dashboard will only use upstream TTS/STT).

Everything else has working defaults — see [`.env.example`](../.env.example) for the full list.

---

## 5. Run — one command

```bash
./run.sh
```

The script:
1. activates `torch-gpu` (or your `CONDA_ENV` override)
2. loads `.env`
3. installs missing Python deps on first run
4. probes your 9Router (warns if offline, still starts the dashboard)
5. downloads ~330 MB of Coqui Indonesian TTS weights on first run (idempotent)
6. starts the **local ML service** in the background on `:21128` and waits up to 30 s for `/health`
7. starts the **dashboard** on `:8765` in the foreground
8. **Ctrl-C** cleans up both processes via an EXIT trap

You should see:

```
✓ conda env: torch-gpu (Python 3.10.x)
→ starting local ML service (idn-tts) on 127.0.0.1:21128…
   waiting for idn-tts to come up… … ready (16s).

  ╭───────────────────────────────────────────────────────╮
  │  WY NineXore AI                                       │
  │  dashboard:  http://127.0.0.1:8765                    │
  │  local ML:   http://127.0.0.1:21128 (idn-tts)         │
  │  upstream:   http://localhost:20128                   │
  │                                                       │
  │  Ctrl-C stops everything.                             │
  ╰───────────────────────────────────────────────────────╯

INFO:     Uvicorn running on http://127.0.0.1:8765 (Press CTRL+C to quit)
```

Open http://127.0.0.1:8765. The sidebar footer should say `upstream ready` and, after ~10-15 s, `idn-tts · 83 voices`.

### Running only the local ML service

You may want to run just the local ML service on a different host (e.g. a box with a big GPU, with the dashboard on a laptop):

```bash
cd idn-tts
./run.sh      # listens on 127.0.0.1:21128 by default
# or bind it so remote dashboards can reach it:
IDN_TTS_HOST=0.0.0.0 ./run.sh
```

Then point the dashboard at it via `IDN_TTS_URL=http://remote-host:21128` in `.env`.

---

## 6. First-run verification checklist

Everything below should succeed after a fresh install.

```bash
# 1. dashboard answers
curl -sf http://127.0.0.1:8765/api/health
# → {"ok":true,"service":"9router-dashboard"}

# 2. upstream reachable
curl -s http://127.0.0.1:8765/api/upstream | jq .reachable
# → true

# 3. idn-tts status (only if IDN_TTS_ENABLED=true)
curl -s http://127.0.0.1:8765/api/idn-tts/status | jq '.reachable, .n_speakers, .whisper.enabled'
# → true / 83 / true

# 4. list TTS models (should include coqui/* when local service is up)
curl -s 'http://127.0.0.1:8765/api/models?kind=tts' | jq '.data | length'

# 5. smoke test Coqui TTS
curl -X POST http://127.0.0.1:8765/api/tts/speak \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"coqui/wibowo","input":"Halo, ini tes.","speed":1.2}' | jq '.url'

# 6. smoke test local Whisper (feed the TTS we just generated)
FILE=data/outputs/$(curl -s -X POST http://127.0.0.1:8765/api/tts/speak \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"coqui/wibowo","input":"halo dunia"}' | jq -r '.file' | cut -d/ -f2)
curl -s -X POST http://127.0.0.1:8765/api/stt/transcribe \\
  -F "file=@$FILE" -F 'model=local/whisper-large-v3' -F 'language=id' \\
  | jq '.result.text'

# 7. pytest (offline, uses fake upstream)
pytest tests/ -q
# → 26 passed
```

---

## 7. Running everything with systemd (optional)

For machines where you want the services up at login, one systemd user unit is enough — `run.sh` already handles both processes.

`~/.config/systemd/user/wy-nine.service`:

```ini
[Unit]
Description=WY NineXore AI
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/AI/WY-NineXore-AI
ExecStart=/bin/bash -lc './run.sh'
KillMode=mixed
KillSignal=SIGINT
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable:

```bash
systemctl --user daemon-reload
systemctl --user enable --now wy-nine.service
systemctl --user status wy-nine
```

`loginctl enable-linger $USER` keeps the service alive after logout.

`KillSignal=SIGINT` is important: it routes `systemctl stop` through the EXIT trap in `run.sh`, which tears down both uvicorn children cleanly.

---

## 8. Troubleshooting

**"upstream offline" in the sidebar**
Your 9Router isn’t reachable. `curl http://localhost:20128/api/health` should return `{"ok":true}`. If you changed the URL, update `NINEROUTER_URL` in `.env`.

**401 on every request**
9Router has `requireApiKey=true`. Copy a key from `Dashboard → Keys` into `NINEROUTER_KEY=` in `.env` and restart `./run.sh`.

**TTS panel shows no `coqui/*` voices**
The local ML service didn’t come up. Look at `/tmp/wy-nine-idn-tts.log` for the reason. Common causes:
1. GPU OOM — disable Whisper with `WHISPER_ENABLED=false` so only Coqui runs.
2. Model files missing — run `cd idn-tts && bash download.sh`.
3. torchaudio / torch version mismatch — reinstall (see below).

**First transcribe is slow**
Whisper lazy-loads. Expect 10–15 s on a mid-range GPU. Later calls are <1 s.

**`libtorchaudio.so: undefined symbol`**
`torchaudio` doesn’t match `torch`. Fix:
```bash
pip install --upgrade "torchaudio==$(python -c 'import torch; print(torch.__version__.split(\"+\")[0])').*" \\
  --index-url https://download.pytorch.org/whl/cu128
```
(replace `cu128` with your CUDA build, e.g. `cu121`, `cu124`)

**Image generation: "Codex did not return an image. Plus/Pro required"**
9Router’s Codex provider needs an active ChatGPT Plus/Pro login. Re-login via 9Router’s Codex wizard, or switch to Gemini/FLUX/Stability/Recraft after adding that provider’s key.

**"file too large" on Vision upload**
Cap is 12 MB raw (~16 MB after base64). Resize the image first. The cap keeps the final JSON body under typical upstream-provider request limits.

---

## 9. Upgrading

```bash
git pull --ff-only
conda activate torch-gpu
pip install -r requirements.txt
```

Model weights don’t move between minor versions; you don’t need to re-run `download.sh`.

---

## 10. Uninstall / clean

```bash
# stop
systemctl --user disable --now wy-nine        # if installed via systemd
pkill -f 'uvicorn backend.main:app' ; pkill -f 'uvicorn service:app'

# remove repo + data
rm -rf ~/AI/WY-NineXore-AI

# (optional) drop the conda env
conda env remove -n torch-gpu
```
