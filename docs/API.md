# REST API reference

Every endpoint is under `/api` and returns JSON unless noted. Errors use a uniform shape:

```json
{ "error": { "status": 4xx|5xx, "body": "...upstream body...", "url": "/v1/..." } }
```

## Basics

### `GET /api/health`
```json
{ "ok": true, "service": "9router-dashboard" }
```

### `GET /api/settings`
Sanitised view for the UI — never includes the API key itself.
```json
{
  "nineroute_url": "http://localhost:20128",
  "has_key": false,
  "app_host": "127.0.0.1",
  "app_port": 8765,
  "defaults": {
    "chat": "ds/deepseek-chat", "image": "", "tts": "", "stt": "",
    "embedding": "nvidia/nv-embedqa-e5-v5", "search": "", "fetch": ""
  }
}
```

### `GET /api/upstream`
Probes the upstream `/api/health`.
```json
{ "reachable": true, "upstream": { "ok": true } }
```

---

## Models

### `GET /api/models?kind={chat|image|tts|stt|embedding|web|image-to-text}`
Passes through to `/v1/models/<kind>`. `chat` maps to the bare `/v1/models`.

### `GET /api/models/all`
Fans out all seven kinds in parallel. Returns `{kind: {data: [...], error?: ...}}`.

### `GET /api/models/info?id=<model_id>`
Passes through to `/v1/models/info`.

---

## Chat

### `POST /api/chat/complete`
```json
{
  "model": "ds/deepseek-chat",
  "messages": [{"role": "user", "content": "hi"}],
  "system": "You are a friendly assistant.",
  "session_id": "optional — to persist",
  "temperature": 0.7,
  "max_tokens": 512,
  "stream": false,
  "extra": { "response_format": {"type": "json_object"} }
}
```
Returns upstream's OpenAI-style chat completion payload.

### `POST /api/chat/stream`
Same body; returns `text/event-stream`. Frames are upstream SSE bytes passed through verbatim (`data: {...choices:[{delta:{content:"..."}}]...}\n\n`, terminated by `data: [DONE]\n\n`).

### Sessions

- `GET  /api/chat/sessions` → list (pinned first, then most recent).
- `POST /api/chat/sessions` → `{title?, model?, system?}` creates a session.
- `GET  /api/chat/sessions/{id}` → session with `messages[]`.
- `PATCH /api/chat/sessions/{id}` → `{title?, pinned?, model?}`.
- `DELETE /api/chat/sessions/{id}` → `{ok: true}`.

Streamed and non-streamed responses are both persisted when `session_id` is provided.

---

## Image

### `POST /api/image/generate`
```json
{
  "model": "cx/gpt-5.4-image",
  "prompt": "watercolour tea-house at dusk",
  "n": 1,
  "size": "1024x1024",
  "quality": "standard",
  "style": "natural",
  "extra": { "background": "transparent" }
}
```
Always requests `response_format=b64_json` from upstream so we can save bytes locally. If upstream returns URLs, they're downloaded once and cached.
```json
{
  "id": 42,
  "model": "...",
  "prompt": "...",
  "created": 1735000000,
  "images": [
    { "file": "outputs/20260508-153012_tea-house.png",
      "url": "/files/outputs/20260508-153012_tea-house.png",
      "bytes": 483201, "content_type": "image/png",
      "revised_prompt": null }
  ]
}
```

---

## TTS

### `GET /api/tts/voices?provider=elevenlabs&lang=en`
Passes through to `/v1/audio/voices`.

### `POST /api/tts/speak`
```json
{ "model": "openai/tts-1", "input": "Hello world", "voice": null, "extra": {} }
```
Saves the returned audio and replies:
```json
{
  "id": 7, "model": "...", "input": "...",
  "file": "outputs/20260508-123456_hello-world.mp3",
  "url": "/files/outputs/20260508-123456_hello-world.mp3",
  "content_type": "audio/mpeg", "bytes": 12345
}
```

---

## STT

### `POST /api/stt/transcribe` (multipart/form-data)

| Field            | Required | Notes                                            |
| ---------------- | -------- | ------------------------------------------------ |
| `file`           | yes      | audio blob                                       |
| `model`          | yes      | e.g. `openai/whisper-1`                          |
| `language`       | no       | ISO-639-1                                        |
| `prompt`         | no       | hint text                                        |
| `response_format`| no       | `json` (default) \| `text` \| `verbose_json` \| `srt` \| `vtt` |
| `temperature`    | no       | 0–1                                              |

Response:
```json
{
  "model": "...", "filename": "note.mp3", "bytes": 48210,
  "result": { "text": "..." },   /* or a string for srt/vtt/text */
  "preview": "first 400 chars…"
}
```

---

## Embeddings

### `POST /api/embeddings/embed`
```json
{
  "model": "nvidia/nv-embedqa-e5-v5",
  "input": ["first sentence", "second sentence"],
  "dimensions": null,
  "encoding_format": "float"
}
```
Response adds a cosine similarity matrix for convenience:
```json
{
  "model": "...",
  "dimensions": 1024,
  "count": 2,
  "inputs": ["...", "..."],
  "vectors": [[0.012, -0.003, ...], [...]],
  "similarity": [[1.0, 0.82], [0.82, 1.0]],
  "usage": { "prompt_tokens": 12, "total_tokens": 12 }
}
```

---

## Web search

### `POST /api/search/run`
```json
{
  "model": "tavily/search",
  "query": "open-source llm gateway",
  "max_results": 8,
  "search_type": "web",
  "country": "us",
  "language": "en",
  "time_range": "month",
  "domain_filter": ["github.com"],
  "extra": {}
}
```
Returns the upstream `/v1/search` payload (provider-dependent but with a uniform `results[]`).

---

## Web fetch

### `POST /api/fetch/run`
```json
{
  "model": "jina/fetch",
  "url": "https://9router.com",
  "format": "markdown",
  "max_characters": 20000
}
```
Returns upstream `/v1/web/fetch` payload:
```json
{
  "provider": "jina-reader",
  "url": "...",
  "title": "...",
  "content": { "format": "markdown", "text": "...", "length": 1234 },
  "metadata": {}, "usage": {}, "metrics": {}
}
```

---

## History

### `GET /api/history/outputs?kind=image&favorite=false&limit=100`
List of outputs, newest first. `kind` is optional.

Each row:
```json
{
  "id": 12, "kind": "image", "model": "...", "prompt": "...",
  "result": { ...stringified → parsed... },
  "file_path": "outputs/...", "favorite": 0,
  "created_at": 1735000000.4
}
```

### `PATCH /api/history/outputs/{id}`
Body `{favorite: true|false}` toggles the star.

### `DELETE /api/history/outputs/{id}`
Removes the DB row and unlinks the saved file (if any, and only inside `DATA_DIR`).

### `GET /api/history/stats`
```json
{
  "sessions": 3, "messages": 42,
  "outputs_by_kind": { "image": 8, "tts": 2, "embedding": 4 }
}
```

---

## Static files

- `GET /`                      — the dashboard HTML.
- `GET /assets/...`            — JS/CSS/icons.
- `GET /files/outputs/...`     — user-generated artefacts (images, audio).
- `GET /favicon.svg`           — the mark.
