# Architecture: Supertonic TTS integration

**Date:** 2026-05-14
**Owner:** Wayan
**Tech-spec:** [02-tech-spec-supertonic.md](./02-tech-spec-supertonic.md)
**Status:** decided → ready for stories

## Three integration options

| Option | Process model | Pros | Cons |
|---|---|---|---|
| **A. In-process inside dashboard (`backend/`)** | dashboard Python imports supertonic | one process, fewer ports | ties model warm-up to dashboard restart; mixes torch + onnxruntime in one venv but in same process; harder to evict on memory pressure |
| **B. In-process inside `idn-tts/service.py`** | idn-tts already loads heavy ML (TTS + Whisper); adds Supertonic alongside | reuses existing lazy-load + status pattern; isolated from FastAPI request loop; same env so onnxruntime + torch already coexist | `idn-tts/` becomes "all local ML"; service name diverges from what the folder used to be |
| **C. Brand-new sidecar service (e.g. `supertonic-tts/`)** | own port, own env | clean separation | doubles process count; need a second `run.sh` block; dashboard must learn a third base URL |

### Decision: **Option B**

Reasons:

1. The `idn-tts/` service already owns all "ML that runs on the laptop"
   work — Whisper STT lives there too, and the folder is mis-named
   already. Picking B keeps the operational model unchanged.
2. The existing multi-variant Whisper plumbing
   (`_load_whisper_if_needed`, per-instance lock, `/health` aggregation,
   poll-based progress UI) is **exactly** the shape Supertonic needs.
   Building a fourth pattern would be cargo-culting.
3. CPU-only ONNX Runtime coexists fine with torch 2.10 + CUDA 12.8 in
   the same venv — confirmed in upstream Supertonic CI (their own
   examples target 3.10+).
4. One process means one `/health` payload to poll; the frontend
   already talks to that single endpoint.

### Migration follow-up

Rename `idn-tts/` to `local-ml/` once Supertonic ships and the rename of
the project root has settled — Bahasa Indonesia voices alone no longer
describe what that service does. **Out of scope for this PR**, tracked
in the post-PR tail-list.

## Module layout (after this PR)

```
idn-tts/
├── service.py               # FastAPI: TTS (Coqui) + STT (Whisper) + TTS (Supertonic)
├── supertonic_tts.py        # NEW — Supertonic loader + synth helper
├── voices/
│   └── supertonic/          # NEW — user-supplied voice JSON (gitignored)
├── requirements.txt
└── README.md
```

`supertonic_tts.py` exposes:

```python
class SupertonicState:
    enabled: bool
    loaded: bool
    loading: bool
    error: str | None
    device: str | None
    voices: list[dict]        # [{name, family, source, lang_default}]
    languages: list[str]      # 31 ISO codes

def load(use_gpu: bool = False) -> None: ...
def synthesize(text: str, *, voice: str, language: str, speed: float) -> tuple[bytes, dict]:
    """Return (wav_bytes, meta_dict).

    meta_dict has duration_s, sample_rate, voice, language, speed.
    """
```

The service module owns lifecycle (single threading lock, lazy `load()`,
`load.kick_off()` background helper). The wrapper is intentionally
small — Supertonic's own SDK is already easy.

## State diagram

```
┌──────────┐  pip wheel ok       ┌────────┐    /supertonic/load   ┌──────────┐
│ disabled ├──────────────────► ┌│ idle   ├──────────────────────►│ loading  │
└──────────┘                     └────────┘                        └────┬─────┘
       ▲ pip import error                                               │
       │                                                                ▼
   ┌──────────┐                                  ┌─────────┐    ┌─────────┐
   │ error    │ ◄─────── exception ◄──────────── │ loaded  │ ◄──┤ download│
   └──────────┘                                  └─────────┘    └─────────┘
```

`/health.supertonic` and `/api/models?kind=tts` always read from the
same singleton `SupertonicState`. Concurrent loads are blocked by the
lock; concurrent synth requests proceed in parallel (the underlying
ONNX session is thread-safe per the upstream docs).

## Concurrency

Supertonic's `TTS` instance is reused across requests. For now we **do
not** run more than one Supertonic synth at a time:

- a `synthesize_lock = threading.Lock()` guards `tts.synthesize(...)`
- expected throughput ≤ 4 r/s on a laptop CPU; richer concurrency
  doesn't pay back the complexity yet

If profiling later shows the lock as a bottleneck we'll switch to a
thread pool of N pre-loaded `TTS` instances.

## Failure handling

| Failure | Behaviour |
|---|---|
| `pip install supertonic` not present | `/health.supertonic.enabled = false`, models endpoint omits supertonic entries; UI hides the optgroup |
| First-time download fails (e.g. offline) | `error` populated; frontend shows red dot + retry button on the voice card |
| Unsupported language | Backend returns 400 with `{"error":"language X not supported","supported":[...]}` |
| Voice JSON malformed | Backend returns 400 referencing the file path |

## Routing summary

```
POST /api/tts/synthesize  ──┐
                            │   model startswith 'supertonic/'  → idn.supertonic_speak(...)
                            ├── model startswith 'coqui/'       → idn.coqui_speak(...)
                            └── otherwise                       → 9Router /v1/audio/speech
```

The dashboard only knows three TTS providers. 9Router still owns dozens
of upstream voices, so the variety is not lost.

## Frontend pattern reuse

| Existing | Reused for Supertonic |
|---|---|
| `renderWhisperCard(idn, onRequestLoad)` | `renderSupertonicCard(idn, onRequestLoad)` |
| `/api/idn-tts/whisper/load?variant=...` | `/api/idn-tts/supertonic/load?voice=...` |
| Polling loop in `stt.js` | Same loop in `tts.js` |
| Per-variant size + status badge | Per-voice family icon + status |

## Tests + reviews

- TDD: write three new pytest cases against a `FakeIdnTTS` first;
  implement until they pass.
- Critique cycle:
  1. self-review code paths
  2. self-review UX (toggle Supertonic on/off, switch languages)
  3. dispatch a `subagent` reviewer for a cold-eye pass

Done definition copied from tech-spec.

## Out of architecture scope

- Voice mixing UI — community PyQt5 tool exists, and we don't want
  another panel.
- Streaming audio chunks — current dashboard has full-file flow.
- Cluster / multi-host inference — explicitly local-only product.
