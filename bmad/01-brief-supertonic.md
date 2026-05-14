# Brief: Supertonic TTS integration

**Date:** 2026-05-14
**Owner:** Wayan
**Status:** approved → tech-spec next

## Goal

Add **Supertonic** as a third TTS provider in WY NineXore AI. It is the
only on-device TTS in our stack that covers **31 languages** in a single
model (Coqui VITS only does Indonesian; 9Router upstream covers many
languages but every one of those is **cloud-based**, so picking a non-EN
language there means data leaves the laptop).

The integration must:

- Make Supertonic appear in the **Speak (TTS)** panel like any other voice.
- When the user picks a Supertonic voice, surface a **language picker**
  (31 options) so the same voice style can speak any supported language.
- Surface a **voice-style picker** (Supertonic's `M1`–`M5` and `F1`–`F5`,
  plus any voice JSON the user drops in).
- Run **fully on-device** — no audio leaves the machine, just like the
  Coqui Indonesian voices.
- Auto-download the ~260 MB ONNX model bundle on first use, with the same
  progress + status conventions as the multi-variant Whisper feature.

## Why

Today the Speak panel offers two paths:

| Path | Reach | Privacy |
|---|---|---|
| `coqui/<speaker>` | Bahasa Indonesia, 83 voices | on-device ✅ |
| `<provider>/<voice>` (via 9Router) | dozens of langs | cloud, audio leaves the laptop ❌ |

That gap (on-device + multilingual) is exactly what Supertonic 3 fills:
ONNX, 260 MB total, 31 languages, MIT-licensed model files, streamed at
realtime on a CPU. It is also a **stronger pitch** for the dashboard:
"locally generated speech in 31 languages, including Indonesian, with
audio that never leaves the laptop."

## Non-goals

- **No** Supertonic voice training in this iteration (their Voice Builder
  is a hosted service we don't want to depend on yet).
- **No** voice mixing / interpolation UI (mentioned in their docs as a
  separate community PyQt5 tool).
- **No** breaking changes to the existing Coqui Indonesian path or any
  9Router-routed voice.

## Success criteria

1. Selecting `supertonic/M1` (or any voice) in the Speak panel reveals a
   language dropdown that defaults to the OS / browser locale and is
   editable to any of the 31 supported codes.
2. Pressing **Generate** with Supertonic + Indonesian + voice `F2`
   produces a `.wav` with audible Indonesian speech in ≤ 5 s on the
   developer laptop after the model is loaded.
3. First-time use auto-downloads the model with a visible progress
   indicator on the dashboard, same UX as the Whisper variants.
4. `pytest tests/ -q` stays green (26+ tests, plus new Supertonic ones).
5. No leak of API keys, no `.env` content, no audio bytes leaving
   `127.0.0.1`.
6. Existing Coqui Indonesian + 9Router TTS paths still work unchanged.

## Constraints

- Single conda env `torch-gpu`. Supertonic ships an `onnxruntime-gpu`
  dependency that must coexist with our existing torch 2.10 + CUDA 12.8.
- Dashboard already has 11 panels — **no** new top-level panel.
  Integration is invisible until a Supertonic voice is selected.
- `.env` already gitignored, public repo, multi-account `gh` setup —
  zero secret-leak tolerance per existing security policy.

## Risks (informs tech-spec)

| # | Risk | Mitigation |
|---|---|---|
| R1 | `pip install supertonic` may pull a binary onnxruntime that conflicts with torch CUDA | Pin to `onnxruntime` (CPU) by default; let user opt into `onnxruntime-gpu` later |
| R2 | First-run 260 MB download blocks the API for tens of seconds | Reuse the multi-variant Whisper background loader pattern; expose `/supertonic/load` |
| R3 | 31-language dropdown clutters the TTS panel for users who only ever pick Indonesian | Show language dropdown **only** when a Supertonic voice is selected |
| R4 | Voice JSON files are local artefacts — adding new ones is a manual filesystem step | Provide a `voices/` subfolder under `idn-tts/` and auto-list any `.json` found |
| R5 | Folder rename `agent-9router-test` → `WY-NineXore-AI` may break absolute paths in scripts | Pre-rename audit, then a single `mv` + `find/replace` pass |

## Out of scope this PR

- Streaming `audio/wav` chunks (current Speak path returns full file once;
  Supertonic supports it but the dashboard does not yet).
- Audiobook / long-form chunking UI (Supertonic auto-chunks long text
  internally; we don't need a separate UI).
- A separate "Voices" tab — the picker lives inside the existing Speak
  panel.

## Approvals to proceed

- [x] Owner — Wayan
