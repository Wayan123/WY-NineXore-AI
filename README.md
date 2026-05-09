# WY NineXore AI

A dark-canvas developer console for the [9Router](https://github.com/decolua/9router) AI gateway, plus a small local CUDA service that adds Bahasa Indonesia TTS and offline Whisper transcription.

One window covers every 9Router capability — chat, image generation, text-to-speech, speech-to-text, embeddings, web search, URL fetching — and an image-to-text (Vision / OCR) panel that extracts text from images via multimodal chat.

Built in Python (FastAPI) + vanilla ES-module JS. No build tool.

![panels](https://img.shields.io/badge/panels-11-8b90f0?style=flat-square)
![tests](https://img.shields.io/badge/pytest-26%2F26-34d399?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-c7cbd1?style=flat-square)

---

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser (http://127.0.0.1:8765)               │
│                    Nine · Workbench UI                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
           ┌───────────────────┴──────────────────┐
           ▼                                       ▼
┌──────────────────────┐              ┌────────────────────────┐
│  Dashboard backend   │              │  Local ML service      │
│  (FastAPI)           │              │  (FastAPI + CUDA)      │
│  :8765               │              │  :21128                │
│                      │              │                        │
│  conda: info-ai      │              │  conda: torch-gpu      │
└────────────┬─────────┘              └───────────┬────────────┘
             │                                    │
             │                             ┌──────┴──────┐
             │                             ▼             ▼
             │                        Coqui VITS    Whisper
             │                        (Indonesian   large-v3
             │                         TTS,         (STT,
             │                         83 voices)    HF cache)
             ▼
┌──────────────────────────────────────┐
│     9Router gateway (:20128)         │
│     OpenAI-compatible REST           │
└──────┬──────────┬────────────┬───────┘
       │          │            │
       ▼          ▼            ▼
   ┌──────┐  ┌────────┐  ┌───────────┐
   │ cx/* │  │nvidia/*│  │ds/*, kr/* │
   │ Codex│  │  NIM   │  │ DeepSeek, │
   │(OpenAI│  │embed/  │  │ Claude    │
   │ Plus) │  │ TTS    │  │  proxies  │
   └──────┘  └────────┘  └───────────┘
```

This project ships **two services** and **one HTML/JS frontend**:

| Component | Port | Runtime | Role |
|---|---|---|---|
| Dashboard backend | `8765` | conda `info-ai` (Python 3.10) | proxies to 9Router + persists history + serves UI |
| Local ML service | `21128` | conda `torch-gpu` (Python 3.10 + CUDA) | Coqui Indonesian TTS + local Whisper STT |
| 9Router | `20128` | external (you run it separately) | OpenAI-compatible gateway to every provider |
| Browser UI | — | static ES modules | the console |

The dashboard does not embed any provider keys of its own. Every external call goes through 9Router, which holds the provider credentials. Local models run entirely on your machine.

---

## Providers used (configured inside 9Router)

This project is designed around three tiers of providers, all accessed through 9Router:

### 1. Codex — OpenAI Plus subscription (`cx/*`)
Codex is a proxy that exposes an OpenAI Plus account as an OpenAI-compatible API. We use it for:

| Model | Panel | Notes |
|---|---|---|
| `cx/gpt-5.4`, `cx/gpt-5.5` | **Chat**, **Vision / OCR** | multimodal, good with Indonesian text in images |
| `cx/gpt-5.2-codex`, `cx/gpt-5.3-codex-*` | **Chat** | code-focused variants |
| `cx/gpt-5.2-image`, `cx/gpt-5.3-image`, `cx/gpt-5.4-image` | **Image** | DALL-E equivalents (Plus/Pro subscription required) |

Authenticate once in 9Router with your ChatGPT Plus session. All further calls from this dashboard use that session transparently.

### 2. NVIDIA NIM (`nvidia/*`)
NVIDIA's hosted inference for embeddings and TTS.

| Model | Panel | Notes |
|---|---|---|
| `nvidia/nv-embedqa-e5-v5` | **Embeddings** | 1024-dim, fast, good for RAG |
| `nvidia/fastpitch`, `nvidia/tacotron2` | **Speak (TTS)** | English-only; use Coqui for Bahasa |

Get an API key from [build.nvidia.com](https://build.nvidia.com/) and add it to your 9Router instance (`Dashboard → Providers → NVIDIA NIM`).

### 3. Local models (no external API)
Runs in your own `torch-gpu` env via the `idn-tts/` service in this repo.

| Model | Panel | Notes |
|---|---|---|
| **Coqui VITS** (Wikidepia/indonesian-tts v1.2) | **Speak (TTS)** | 83 Bahasa voices (`coqui/wibowo`, `coqui/ardi`, `coqui/gadis` + 80 regional) |
| **openai/whisper-large-v3** (HuggingFace local) | **Transcribe (STT)** | `local/whisper-large-v3`, loaded lazily on first request |

Your audio never leaves the machine.

### Optional 3rd-party providers
9Router also supports Tavily / Exa / Brave for search, Firecrawl / Jina Reader for URL fetch, ElevenLabs / Edge-TTS / Deepgram for more voice options, etc. All opt-in — add the key in 9Router and the dashboard will surface them automatically.

---

## Quick start

Prerequisites:
- Linux or macOS with a recent Python (3.10+)
- [Miniconda / Anaconda](https://docs.conda.io/en/latest/miniconda.html)
- A running [9Router](https://github.com/decolua/9router) instance on `http://localhost:20128`
- Optional (for local Indonesian TTS + Whisper STT): NVIDIA GPU with CUDA 12.x

### 1. Clone

```bash
git clone https://github.com/Wayan123/WY-NineXore-AI.git
cd WY-NineXore-AI
```

### 2. Dashboard backend — `info-ai` conda env

```bash
# create the env (first time only)
conda create -n info-ai python=3.10 -y
conda activate info-ai
pip install -r requirements.txt
```

Configure:

```bash
cp .env.example .env
nano .env
```

Only three lines usually need changing:

```dotenv
NINEROUTER_URL=http://localhost:20128           # where your 9Router listens
NINEROUTER_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx  # paste from 9Router → Dashboard → Keys
IDN_TTS_ENABLED=true                            # set to false if you skip the local service
```

Run:

```bash
./run.sh
# → http://127.0.0.1:8765
```

### 3. Local ML service — `torch-gpu` conda env (optional but recommended)

The dashboard works without this service, but Bahasa TTS and offline Whisper STT need it.

```bash
# expects an existing torch-gpu env with PyTorch + CUDA already installed.
# see docs/SETUP.md for creating one from scratch.
conda activate torch-gpu
cd idn-tts
./run.sh
# first run downloads ~330 MB of Coqui VITS weights into idn-tts/models/
# Whisper large-v3 is loaded from ~/.cache/huggingface on first request
# → http://127.0.0.1:21128
```

Once both services are up, reload the dashboard and you'll see `idn-tts · 83 voices` in the sidebar footer.

---

## Tutorial — panel by panel

### Chat (`#/chat`)
Multi-session chat with streaming output. Each session lives in SQLite under `data/history.db`.

1. Click **+ New chat** in the left rail.
2. Pick a model from the dropdown (defaults to `ds/deepseek-chat`).
3. Type → Enter to send, Shift+Enter for a newline.
4. The chat header has three buttons:
   - **system** — a per-session instruction the model sees before every reply (opens a modal)
   - **T=0.7** — generation knobs (temperature + max tokens)
   - **stream** — toggle SSE streaming

Sessions can be pinned (★), renamed (✎), or deleted (✕). Pinned sessions sort first.

**Good defaults**: `kr/claude-haiku-4.5` for quick drafts, `cx/gpt-5.4` for vision + reasoning, `ds/deepseek-chat` for long context.

### Image (`#/image`)
Text → image via `cx/*-image` Codex models. Requires an OpenAI Plus subscription upstream.

1. Pick a model — typically `cx/gpt-5.4-image`.
2. Write a prompt in English or Indonesian.
3. Optional: size (default `1024x1024`), quality, n.
4. **Generate**. Images save to `data/outputs/*.png` and show in the gallery below.

Click a thumbnail to open at full size. Favourite (★) or delete (✕) per item.

### Speak — TTS (`#/tts`)
Two kinds of voices:

- **Coqui (recommended for Indonesian)**: `coqui/wibowo`, `coqui/ardi`, `coqui/gadis` + 80 regional speakers (Javanese, Sundanese). Runs locally in the `idn-tts` service.
- **Upstream**: NVIDIA NIM (`nvidia/fastpitch`, `nvidia/tacotron2`), or whatever else your 9Router instance has (Edge-TTS, ElevenLabs, OpenAI, …).

1. The model dropdown groups "Coqui · Indonesian (recommended)" first.
2. Type text (placeholder switches to Bahasa when a coqui voice is selected).
3. **Speaking pace** — slider `0.5×` (very fast) to `2.5×` (very slow). `1.20×` is the natural-sounding default. Reset button returns to `1.20×`.
4. **Speak** → WAV/MP3 saved to `data/outputs/`.

Click **sample · id** or **sample · en** to load an example phrase.

### Transcribe — STT (`#/stt`)
Default model: `local/whisper-large-v3` (offline, GPU-accelerated, Indonesian-aware).

1. Drag an audio file onto the dropzone, or click **record** to capture from your mic (MediaRecorder API).
2. Optional: language hint (default `id` for Whisper), prompt, response format.
3. **Transcribe**.

First Whisper request loads the 2.9 GB model (~10–15 s). Subsequent requests are <1 s on a mid-range GPU.

Upstream STT options (OpenAI Whisper API, Groq, Deepgram, …) show up when configured in 9Router.

### Vision / OCR (`#/vision`) — **image → text**
Uses multimodal chat models to read text from images.

1. Drop an image (PNG, JPG, WebP, BMP, GIF) — up to 12 MB.
2. Pick a model. Known good: `cx/gpt-5.4`, `cx/gpt-5.5`, or Claude if provisioned.
3. Pick a prompt chip:
   - **OCR (id)** — Indonesian extraction, verbatim
   - **OCR (en)** — English extraction
   - **describe** — natural-language summary
   - **extract table** — returns Markdown pipe table
   - **translate → id** — reads foreign text and returns it translated to Bahasa

The result renders as markdown below the form; full output is copyable and stored in history.

### Embeddings (`#/embed`)
Turn sentences into vectors and compare them with cosine similarity.

1. One sentence per line in the textarea (`example` button fills a demo set).
2. Model defaults to `nvidia/nv-embedqa-e5-v5` (1024-dim).
3. **Embed** returns: summary pills, a colour-graded similarity matrix (lavender = closer), and the first 8 dimensions of each vector.
4. **copy vectors** copies the full matrix to clipboard as JSON.

### Search (`#/search`)
Web search through any 9Router-configured provider (Tavily, Exa, Brave, Serper, …).

### Read URL (`#/fetch`)
URL → markdown/text/HTML via Firecrawl, Jina Reader, Tavily Extract, or Exa Contents. HTML is rendered inside a sandboxed iframe so remote pages cannot touch your origin.

### Models (`#/models`)
Live browser over every model your 9Router instance exposes, grouped by kind. Filter by ID (e.g. `deepseek`, `gemini`, `coqui`). Click **info** on any model to see its JSON metadata.

### History (`#/history`)
Every output you've generated, filterable by kind (image / tts / stt / embedding / search / fetch / vision). Star favourites, delete, see rolling stats.

### Settings (`#/settings`)
Read-only view of effective config, live upstream probe, Indonesian TTS status panel with speakers count and Whisper device/loaded state.

---

## Keyboard shortcuts

Available anywhere outside a text field (vim-style `g` prefix):

| Keys | Panel |
|---|---|
| `g h` | Home |
| `g c` | Chat |
| `g i` | Image |
| `g t` | Speak (TTS) |
| `g r` | Transcribe (STT) |
| `g v` | Vision / OCR |
| `g e` | Embeddings |
| `g s` | Search |
| `g f` | Read URL |
| `g m` | Models |
| `g y` | History |
| `g ,` | Settings |

Inside chat: `Enter` sends, `Shift+Enter` is newline, `Esc` closes modals.

---

## Configuration reference (`.env`)

```dotenv
# ----- 9Router gateway -----
NINEROUTER_URL=http://localhost:20128      # your 9Router URL
NINEROUTER_KEY=                            # paste from 9Router → Keys (empty if requireApiKey=false)

# ----- Indonesian TTS + Whisper STT service (optional, see idn-tts/) -----
IDN_TTS_URL=http://localhost:21128
IDN_TTS_ENABLED=true

# ----- Dashboard server -----
APP_HOST=127.0.0.1                         # 0.0.0.0 to expose on LAN (read SECURITY.md first)
APP_PORT=8765
DATA_DIR=./data                            # history DB + generated images/audio
REQUEST_TIMEOUT=180                        # seconds; bump for slow providers

# ----- Default models (blank = auto-pick first available) -----
DEFAULT_CHAT_MODEL=ds/deepseek-chat
DEFAULT_IMAGE_MODEL=
DEFAULT_TTS_MODEL=coqui/wibowo
DEFAULT_STT_MODEL=local/whisper-large-v3
DEFAULT_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
DEFAULT_SEARCH_MODEL=
DEFAULT_FETCH_MODEL=
```

See [`.env.example`](./.env.example) for the full commented list.

---

## Security

- **Never commit `.env`** — it is already in `.gitignore`. The only key this project uses is your `NINEROUTER_KEY`.
- The dashboard does not store provider keys. All external calls go through 9Router, which holds them.
- Binding `APP_HOST=0.0.0.0` exposes the dashboard to anyone on your network *without* authentication. Do not do this without a reverse proxy with TLS + auth.
- Local Whisper keeps audio on your machine; nothing is uploaded.
- See [`docs/SECURITY.md`](./docs/SECURITY.md) for the full threat model.

---

## Development

### Running tests

```bash
conda activate info-ai
pytest tests/ -v          # 26 tests, all use an in-memory fake of 9Router
```

### Project layout

```
WY-NineXore-AI/
├── backend/                       # FastAPI app (conda info-ai)
│   ├── main.py
│   ├── config.py                  # pydantic-settings, reads .env
│   ├── client.py                  # async httpx wrapper around 9Router
│   ├── idn_tts.py                 # client for the optional local ML service
│   ├── routes/                    # one file per capability (+ vision.py, stt.py)
│   └── storage/db.py              # SQLite history store
├── frontend/
│   ├── index.html
│   ├── favicon.svg
│   └── assets/
│       ├── styles.css             # dark canvas, single lavender accent
│       ├── app.js                 # hash router + status poller
│       ├── store.js               # cached models + settings
│       ├── api.js                 # fetch helpers + SSE
│       ├── ui.js                  # toasts, modal, DOM helpers
│       ├── md.js                  # tiny markdown renderer
│       └── components/            # home / chat / image / tts / stt / vision / …
├── idn-tts/                       # Local CUDA service (conda torch-gpu)
│   ├── service.py                 # Coqui VITS + Whisper in one FastAPI app
│   ├── run.sh
│   ├── download.sh                # fetches Wikidepia/indonesian-tts v1.2
│   ├── requirements.txt
│   ├── models/                    # .gitignored — populated by download.sh
│   └── README.md
├── data/                          # .gitignored runtime dir
│   ├── history.db                 # chat sessions + generated outputs index
│   └── outputs/                   # saved images / wav / mp3
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SETUP.md
│   ├── SECURITY.md
│   └── API.md                     # REST reference
├── tests/                         # pytest smoke tests (fake upstream)
├── DESIGN.md                      # the dark-canvas design system
├── .env.example                   # starter config (no real keys)
├── .gitignore
├── run.sh                         # starts the dashboard in info-ai env
├── requirements.txt
├── LICENSE
└── README.md
```

---

## FAQ

**Do I need all three services?**
No. Just the dashboard + a 9Router instance gets you chat, images, web search, URL fetch, embeddings, and any upstream TTS/STT 9Router has configured. The local `idn-tts` service adds offline Bahasa TTS and Whisper — skip it if you don't need those.

**I don't see `coqui/*` voices in the TTS panel.**
The `idn-tts` service isn't reachable. Check:
1. `./idn-tts/run.sh` is running and `curl http://127.0.0.1:21128/health` returns JSON.
2. `IDN_TTS_ENABLED=true` in `.env`.
3. Press **↻ refresh voices** at the top of the TTS panel.

**Whisper is slow on the first transcribe.**
Expected. The 2.9 GB `openai/whisper-large-v3` model loads lazily into GPU memory on first call (~10–15 s). Subsequent calls are <1 s.

**Image generation returns "Codex did not return an image. Plus/Pro required."**
9Router's Codex provider needs an active ChatGPT Plus or Pro subscription. Other image providers (Gemini nano-banana, FLUX, Stability, Recraft) work without Plus if you add the key.

**The dashboard killed my terminal when I closed it.**
Use `./run.sh` which handles process lifetime cleanly, or `nohup uvicorn backend.main:app ... &` and `disown` if you need to detach manually.

---

## Credits

- [9Router](https://github.com/decolua/9router) by decolua — the gateway this project sits on top of.
- [Wikidepia/indonesian-tts](https://github.com/Wikidepia/indonesian-tts) — Coqui VITS fine-tune for Bahasa Indonesia.
- [g2p-id](https://github.com/Wikidepia/g2p-id) — grapheme → phoneme conversion for Bahasa.
- [OpenAI Whisper](https://huggingface.co/openai/whisper-large-v3) — STT model.
- Design language adapted from [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (Linear + ElevenLabs patterns). See [`DESIGN.md`](./DESIGN.md).

---

## License

MIT. See [`LICENSE`](./LICENSE).

**Do not use the Wikidepia/indonesian-tts model weights for commercial purposes** — per the upstream model licence. The MIT licence covers this project's source code only.
