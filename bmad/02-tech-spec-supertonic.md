# Tech Spec: Supertonic TTS integration

**Date:** 2026-05-14
**Owner:** Wayan
**Brief:** [01-brief-supertonic.md](./01-brief-supertonic.md)
**Status:** approved → architecture next

## Reality check (from the upstream code)

`pip install supertonic` exposes:

```python
from supertonic import TTS
tts = TTS(auto_download=True)              # 260 MB ONNX bundle
style = tts.get_voice_style(voice_name="M4")
wav, duration = tts.synthesize(text, voice_style=style, lang="id")
tts.save_audio(wav, "out.wav")
```

- `wav`: `np.ndarray`, shape `(1, num_samples)`, sample rate **24000 Hz**
- `lang`: one of `en, ko, ja, ar, bg, cs, da, de, el, es, et, fi, fr, hi,
  hr, hu, id, it, lt, lv, nl, pl, pt, ro, ru, sk, sl, sv, tr, uk, vi`
  (31 codes — the canonical list lives in
  `supertonic/helper.py::AVAILABLE_LANGS`).
- Built-in voice styles: `M1`–`M5`, `F1`–`F5` plus any `.json` blob the
  user drops in.
- Runtime deps: `onnxruntime==1.23.1`, `numpy>=1.26`, `soundfile>=0.12`,
  `librosa>=0.10`, `pyyaml>=6.0`. **CPU-only by default**;
  `onnxruntime-gpu` is opt-in.

## API surface (this dashboard)

### Model IDs

```
supertonic/<voice>          → e.g. supertonic/M1, supertonic/F2, supertonic/custom-voice-name
```

`<voice>` is the basename of a voice JSON in
`idn-tts/voices/supertonic/`. The 10 stock styles ship inside the pip
package; the dashboard lists them automatically.

### Request flow

`POST /api/tts/synthesize` form/JSON body adds two new optional fields,
forwarded to the local service as form data:

| field | type | default | scope |
|---|---|---|---|
| `model` | str | n/a | always; carries the voice via `supertonic/<voice>` prefix |
| `language` | enum (31) | OS locale or `en` | only when `model` starts with `supertonic/` |
| `speed` | float (0.5–2.0) | `1.05` | always; existing slider already covers this |
| `voice_style_path` | str | derived from `<voice>` | optional override for power users |

If `model` does **not** start with `supertonic/`, both `language` and
`voice_style_path` are silently dropped (existing Coqui + 9Router paths
keep their current contract).

### Local service endpoints (idn-tts)

| route | verb | role |
|---|---|---|
| `GET  /supertonic/voices` | catalogue: `[{name, family, lang_default, has_json, source}]` |
| `GET  /supertonic/languages` | the 31-code list with English label and ISO-639-1 native label |
| `POST /supertonic/load`   | kick off background load (mirrors `/whisper/load`) |
| `POST /supertonic/speak`  | `multipart/form-data` `text, voice, language, speed` → `audio/wav` |
| `GET  /health`            | extended with `supertonic.{enabled, loaded, loading, device, error, voices: [...], languages: [...]}` |

### Existing /api/tts/synthesize keeps its shape

Backend route `backend/routes/tts.py`:

```python
if model.startswith("supertonic/"):
    voice = model.removeprefix("supertonic/")
    return await idn.supertonic_speak(text, voice=voice, language=language, speed=speed)
elif model.startswith("coqui/"):
    speaker = model.removeprefix("coqui/")
    return await idn.coqui_speak(text, speaker=speaker, speed=speed)
else:
    return await client.tts_speak(model=model, input=text)        # → 9Router
```

## Backend client (`backend/idn_tts.py`) additions

```python
async def supertonic_voices() -> dict: ...
async def supertonic_languages() -> dict: ...
async def supertonic_load(voice: str) -> dict: ...
async def supertonic_speak(
    text: str,
    *,
    voice: str = "M4",
    language: str = "en",
    speed: float = 1.05,
) -> bytes:    # raw audio/wav
    ...
SUPERTONIC_DEFAULT_LANG = "en"
```

`backend/idn_tts.py` already has the discriminating helpers
(`whisper_variant_from_model`, etc.) — add `supertonic_voice_from_model`
and `is_supertonic_model` next to them.

## Models endpoint (`backend/routes/models.py`)

`/api/models?kind=tts` adds one entry per voice style discovered:

```jsonc
{
  "id": "supertonic/M1",
  "object": "model",
  "owned_by": "local",
  "kind": "tts",
  "provider": "supertonic (local)",
  "languages": ["en", "ko", "ja", "..."],   // all 31, same for every voice
  "default_language": "en",
  "voice_family": "M",                      // "M" | "F" | "custom"
  "size_gb": 0.26,
  "device": "cpu",
  "loaded": true|false,
  "loading": true|false,
  "error": null
}
```

### Status policy

We always emit the 10 stock voices even before the model is loaded; the
loading/error flags carry the warm-up state. When the user picks one we
either use the cache or warm up via `/supertonic/load`.

## Frontend changes

### Speak panel (`frontend/assets/components/tts.js`)

- Voice dropdown gains a third **optgroup**: "Supertonic (local · 31 langs)".
  Existing "Coqui Indonesian" and "9Router upstream" optgroups stay.
- When the active model starts with `supertonic/`, render a **language
  selector** under the speed slider:
  - `<select>` with the 31 codes, each rendered as
    `id — Indonesian (Bahasa Indonesia)`.
  - Default value: `localStorage['wy-nine-supertonic-lang']`, fallback
    to the closest match for `navigator.language`, fallback to `en`.
  - Persisted via the same prefs path as model selection.
- "Voice card" (analogous to the existing whisper-card) shows:
  - Model load status (`loaded` / `loading…` / `not cached`)
  - Voice family icon (`M` for male, `F` for female, "custom" tag
    otherwise) plus its `lang_default` if set
  - "Load" button when not cached (calls `/api/idn-tts/supertonic/load`)
- For non-Supertonic models the panel renders unchanged.

### Settings panel

The existing "Indonesian TTS service" card grows an extra row:
`Supertonic` → `enabled? loaded? device? voices: 10`.

## Auto-download UX

Same pattern as multi-variant Whisper:

1. Status card shows "260 MB will download on first use".
2. User clicks **Load** (optional) → backend kicks off `/supertonic/load`.
3. Frontend polls `/api/idn-tts/status` every 2 s until `loaded` or
   `error`.
4. If user just hits **Generate** without pre-loading, the request
   blocks until the model is loaded (with the dashboard's existing
   spinner + toast).

## Dependency strategy

Append to root `requirements.txt`:

```
# Supertonic TTS (on-device, 31 langs)
supertonic==1.0.5    # pulls onnxruntime, soundfile, librosa, pyyaml
```

Pin to a minor version (`==1.0.5` at time of writing) to avoid surprise
ABI breaks with `onnxruntime`. CPU-only backend is the default; users
who want CUDA can `pip install onnxruntime-gpu` separately.

`run.sh` does **not** need to change. The torch-gpu env already has
numpy + soundfile via Coqui TTS, so the only net new wheel is
supertonic + onnxruntime.

## Storage

- ONNX model bundle goes to the standard HuggingFace cache:
  `~/.cache/huggingface/hub/models--Supertone--supertonic-3/`
  (~260 MB, alongside the existing Whisper checkpoints).
- Voice JSON files: stock voices live inside the pip wheel; user-supplied
  voices sit in `idn-tts/voices/supertonic/*.json`.
- Synthesised WAVs: kept in memory and streamed back as `audio/wav`.

## Tests

New cases under `tests/test_api.py`:

- `test_models_tts_includes_supertonic` — `/api/models?kind=tts` returns
  10 supertonic entries when the local service exposes them.
- `test_tts_supertonic_routes_to_idn_tts` — POST with
  `model=supertonic/M1` + `language=id` reaches the fake idn-tts
  client with the right kwargs.
- `test_tts_supertonic_unsupported_lang_returns_400` — invalid
  language returns a 400 with a helpful message and a link to the
  language list endpoint.

Smoke (manual): synthesise EN, ID, JA samples; verify each is audible
and starts within ~5 s on the dev laptop.

## Migration / rollout

- Forward-compatible: existing Coqui + 9Router voices unchanged.
- `model=supertonic/<voice>` is a new ID space — never collides.
- If `pip install supertonic` fails (e.g. ARM platform with no ONNX
  wheel), the dashboard simply omits Supertonic entries from
  `/api/models?kind=tts` (`/health` reports `enabled: false`).

## Risks → mitigations (from brief)

| # | Risk | Mitigation |
|---|---|---|
| R1 | onnxruntime / torch CUDA conflict | CPU-only by default; advertise `onnxruntime-gpu` as opt-in |
| R2 | First-run blocks API | Background loader + poll-based progress UI |
| R3 | 31-language clutter | Lang dropdown only when supertonic voice selected |
| R4 | Adding voices is manual | `idn-tts/voices/supertonic/*.json` auto-discovery |
| R5 | Folder rename breaks paths | Pre-rename audit script then a single move |

## Done definition

- [ ] Speak panel shows Supertonic + language picker
- [ ] EN, ID, JA samples synthesise on the dev laptop
- [ ] `/api/models?kind=tts` lists 10 stock voices when service is up
- [ ] First-time load downloads + caches without blocking the UI thread
- [ ] pytest 26+ green (the +3 new ones)
- [ ] No regression on Coqui / 9Router voices
- [ ] No `.env` / API-key leak; security scan returns 0 matches
