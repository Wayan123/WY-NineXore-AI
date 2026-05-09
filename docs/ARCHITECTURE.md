# Architecture

## Components and processes

Two local processes plus your external 9Router. The two local processes share a single `torch-gpu` conda env and are spawned by a single `./run.sh` (dashboard in the foreground, local ML in a managed background subprocess).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             BROWSER                                      │
│            http://127.0.0.1:8765  → Nine · Workbench UI                  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ REST + SSE (fetch / EventSource)
                                     │ same-origin; no external JS loaded
                                     │ besides Google Fonts (Inter + JetBrains Mono)
┌────────────────────────────────────┴────────────────────────────────────┐
│                   Dashboard backend   (FastAPI)                          │
│                   conda env: torch-gpu (shared with local ML)                     │
│                                                                          │
│   /api/chat          → /v1/chat/completions    (stream + session store)  │
│   /api/image         → /v1/images/generations  (saves to data/outputs/)  │
│   /api/tts           → routes by model prefix:                           │
│                         - coqui/*   → idn-tts:21128/v1/audio/speech      │
│                         - otherwise → 9Router:20128/v1/audio/speech      │
│   /api/stt           → routes by model prefix:                           │
│                         - local/whisper-*  → idn-tts Whisper             │
│                         - otherwise → 9Router /v1/audio/transcriptions   │
│   /api/embeddings    → /v1/embeddings + cosine similarity helper         │
│   /api/search        → /v1/search     (Tavily, Exa, Brave, …)            │
│   /api/fetch         → /v1/web/fetch  (Firecrawl, Jina, Tavily, Exa)     │
│   /api/vision        → /v1/chat/completions with multimodal image_url    │
│   /api/models        → /v1/models[/kind] + merges local models           │
│   /api/history       → SQLite CRUD for persisted outputs                 │
│   /api/idn-tts/status→ live health of the local ML service               │
└────────┬──────────────────────────────────────────────┬─────────────────┘
         │                                               │
         │ httpx async client                            │ httpx async client
         │                                               │
┌────────┴──────────────────────────┐     ┌─────────────┴────────────────┐
│  9Router gateway (external)       │     │  Local ML service             │
│  :20128  ·  OpenAI-compatible     │     │  :21128  ·  idn-tts/service.py│
│                                   │     │  conda env: torch-gpu (shared with dashboard) │
│  Providers (you configure):       │     │                               │
│   - Codex (OpenAI Plus, cx/*)     │     │  Loaded at boot:              │
│   - NVIDIA NIM (nvidia/*)         │     │   - Coqui VITS (TTS)          │
│   - DeepSeek (ds/*)               │     │   - g2p-id (g→p)              │
│   - K2 / Claude proxy (kr/*)      │     │                               │
│   - Tavily / Exa / Brave / …      │     │  Lazy-loaded on 1st request:  │
│   - Firecrawl / Jina              │     │   - openai/whisper-large-v3   │
│   - ElevenLabs / Edge-TTS / …     │     │                               │
│                                   │     │  Endpoints:                   │
│  Exposes each provider under an   │     │   /synthesize       (TTS)     │
│  OpenAI-compatible endpoint so    │     │   /v1/audio/speech  (TTS)     │
│  the dashboard does not know      │     │   /whisper/transcribe (STT)   │
│  which specific provider is       │     │   /v1/audio/transcriptions    │
│  being called.                    │     │   /speakers  /health          │
└───────────────────────────────────┘     └───────────────────────────────┘
```

### Why split?

- **Dashboard backend** is a lean HTTP service — fastapi + httpx + sqlite. Imports nothing from the ML stack.
- **Local ML service** carries the heavy stack: PyTorch + torchaudio, coqui-tts, transformers, librosa, soundfile. Boots the VITS model at startup; Whisper lazy-loads on first request.
- **Both local services share the same conda env** (`torch-gpu`). The dashboard doesn’t *import* any ML packages — it only talks HTTP to the local service — so the shared env is just a packaging convenience, not a coupling.
- **9Router** is a separate project; we treat it as an external dependency. That keeps provider credentials in one place.
- **One `./run.sh`** spawns both processes and traps Ctrl-C to tear them down together.

If all three are on the same machine everything is `127.0.0.1:*` and latency is a few ms each hop. Running any of them on another host is just a URL change in `.env`.

---

## Model routing rules

The dashboard decides which backend to call purely by **model ID prefix**.

| Prefix            | Routed to         | Capability            |
|-------------------|-------------------|-----------------------|
| `coqui/*`         | Local ML (:21128) | TTS (Bahasa, 83 voices) |
| `local/whisper-*` | Local ML (:21128) | STT (any language)    |
| everything else   | 9Router (:20128)  | whatever 9Router has  |

Routing lives in two tiny helpers (`backend/idn_tts.py`):

```python
def is_coqui_model(model):        return model.startswith("coqui/")
def is_local_whisper_model(model): return model.startswith("local/whisper")
```

`backend/routes/tts.py` and `backend/routes/stt.py` branch on these. No hardcoded upstream/local logic anywhere else; the rest of the dashboard treats every model as opaque.

### Model list merging

When the UI asks `/api/models?kind=tts`, the backend:

1. Calls 9Router's `/v1/models/tts`.
2. Probes the local ML service's `/speakers`.
3. Synthesises `coqui/<speaker>` entries for each reachable voice.
4. Returns the merged list. (Same idea for `kind=stt` + local Whisper.)

If the local service is down, only upstream models appear — the dashboard stays functional.

---

## Error envelope

Every API call returns one of two shapes. The frontend's `ApiError.upstreamMessage` understands both:

### Normal response
Whatever shape 9Router / local-ML returned.

### Upstream-sourced error
Raised by any httpx call that hits a 4xx/5xx from 9Router or idn-tts. A global FastAPI handler in `backend/main.py` converts it:

```json
{
  "error": {
    "status": 503,
    "body": { "error": { "message": "All accounts unavailable" } },
    "url": "/v1/chat/completions"
  }
}
```

### Validation error
Pydantic / FastAPI shape (`{detail: [...]}`). Also handled by the frontend parser.

---

## History storage

SQLite at `data/history.db`. Two concepts:

```
sessions (chat multi-turn)
├── id (uuid), title, model, system, pinned, created_at, updated_at
└── messages
    ├── role, content, created_at

outputs (every non-chat artifact)
├── id, kind, model, prompt, result (JSON), file_path, favorite, created_at
```

`kind` ∈ `image` · `tts` · `stt` · `embedding` · `search` · `fetch` · `vision`.

The History panel filters by `kind`. Anything with a `file_path` also gets a download button in the relevant panel.

---

## Data flow — two traces

### Chat stream

```
Browser                   Dashboard                       9Router
   │                         │                              │
   │ POST /api/chat/stream   │                              │
   │────────────────────────▶│                              │
   │                         │ POST /v1/chat/completions     │
   │                         │  (stream:true, messages…)    │
   │                         │─────────────────────────────▶│
   │                         │                              │
   │                         │◀──── SSE: data: {delta…}     │
   │◀── passthrough bytes ───│                              │
   │    (raw upstream frame) │                              │
   │    collect content side │                              │
   │                         │                              │
   │                         │ collected text + role:user,  │
   │                         │ role:assistant → sessions    │
   │                         │ table via session_id         │
```

### Indonesian TTS

```
Browser             Dashboard              Local ML (idn-tts)
   │                    │                        │
   │ POST /api/tts/speak│                        │
   │  {model:"coqui/..",│                        │
   │   input:"...",     │                        │
   │   speed:1.2}       │                        │
   │───────────────────▶│                        │
   │                    │ is_coqui_model(model)? │
   │                    │ → yes → idn.speak(…)   │
   │                    │                        │
   │                    │ POST /synthesize       │
   │                    │  {text, speaker,speed} │
   │                    │───────────────────────▶│
   │                    │                        │ g2p-id: text→phonemes
   │                    │                        │ length_scale = 1.2
   │                    │                        │ VITS.tts(…)
   │                    │                        │ float→int16 WAV
   │                    │◀───── audio/wav ───────│
   │                    │                        │
   │                    │ save to data/outputs/  │
   │                    │ log to outputs table   │
   │◀───── {url,file}───│                        │
```

Whisper (`local/whisper-*`) and Vision (`/api/vision/extract`) follow the same pattern with different endpoints.

---

## What runs where — memory & GPU

On a mid-range dev laptop (RTX 4060 8 GB VRAM, 16 GB RAM):

| Process | RAM | VRAM (when active) | Notes |
|---|---|---|---|
| Dashboard | ~80 MB | 0 | pure httpx + FastAPI |
| idn-tts (TTS only) | ~700 MB | ~1.4 GB | VITS always resident |
| idn-tts + Whisper | ~3.3 GB | ~4.5 GB | Whisper fp16 resident after first call |
| 9Router | varies | 0 | mostly HTTP plumbing |

Whisper can run on CPU if no GPU is present — significantly slower (30-60 s per 30 s clip vs <1 s on GPU).

---

## Extension points

### Add a new provider
Add it in 9Router (Dashboard → Providers). No code changes here — the new models show up in the next `/api/models/*` poll.

### Add a new model prefix that routes locally
1. Add a helper in `backend/idn_tts.py` (or a new `backend/<service>.py`).
2. Branch in the relevant `backend/routes/<kind>.py`.
3. Inject synthetic entries in `backend/routes/models.py`.

### Add a new panel
1. Create `frontend/assets/components/<name>.js` exporting `async function mount(root)`.
2. Register in `frontend/assets/app.js`'s `VIEWS` map.
3. Add nav entry in `frontend/index.html`.
4. Optionally add a backend route under `/api/<name>`.

No framework rules; every panel is ~100–300 LOC of plain JS that builds DOM with `el()`.

---

## What this project is **not**

- Not a 9Router replacement — it sits on top.
- Not multi-tenant. Single-user local console.
- Not a production-hardened service. No auth, no rate limiting, no audit log beyond the history DB.
- Not a chat-only app — TTS / STT / Vision / embeddings are first-class, not afterthoughts.
