"""Indonesian TTS service \u2014 Coqui TTS + g2p-id wrapper.

Loads the Wikidepia/indonesian-tts v1.2 VITS model from ``./models/`` and exposes
it over a small FastAPI HTTP API. The dashboard backend proxies to this service
when a user selects a ``coqui/<speaker>`` voice.

Endpoints
---------
* ``GET  /health``                 \u2014 service health + model status
* ``GET  /speakers``               \u2014 list of speaker IDs
* ``POST /synthesize``             \u2014 JSON ``{text, speaker, split_sentences?}`` \u2192 audio/wav
* ``POST /v1/audio/speech``        \u2014 OpenAI-compatible shape for drop-in use

Run
---
    conda activate torch-gpu
    uvicorn service:app --host 127.0.0.1 --port 21128
"""
from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

import supertonic_tts  # local module

log = logging.getLogger("idn-tts")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

ROOT = Path(__file__).resolve().parent
MODELS_DIR = Path(os.environ.get("IDN_TTS_MODELS_DIR", ROOT / "models"))
CHECKPOINT = MODELS_DIR / "checkpoint_1260000-inference.pth"
CONFIG = MODELS_DIR / "config.json"
SPEAKERS = MODELS_DIR / "speakers.pth"

USE_CUDA = os.environ.get("IDN_TTS_USE_CUDA", "auto")
SAMPLE_RATE_DEFAULT = 22050  # VITS default; overridden by model config

WHISPER_ENABLED = os.environ.get("WHISPER_ENABLED", "true").lower() in {"1", "true", "yes"}

# Variants the dashboard may request. Keyed by short name (the suffix after
# ``local/whisper-``), mapped to the HF model ID we pull with transformers.
#
# Order matters: the first entry is the default the dashboard picks when the
# user hasn't chosen anything.
WHISPER_VARIANTS: "dict[str, dict]" = {
    "large-v3": {
        "hf_id": "openai/whisper-large-v3",
        "size_gb": 2.9,
        "params_m": 1550,
        "notes": "Best accuracy. Needs ~4 GB VRAM in fp16; very slow on CPU.",
    },
    "medium": {
        "hf_id": "openai/whisper-medium",
        "size_gb": 1.5,
        "params_m": 769,
        "notes": "Good balance. Works on CPU at ~1–2× realtime.",
    },
    "tiny": {
        "hf_id": "openai/whisper-tiny",
        "size_gb": 0.15,
        "params_m": 39,
        "notes": "Tiny (~150 MB). Fast on CPU, accuracy is lower.",
    },
}


class _WhisperInstance:
    """Per-variant runtime state."""
    def __init__(self, hf_id: str):
        self.hf_id: str = hf_id
        self.model = None
        self.processor = None
        self.device: str = "cpu"
        self.loaded: bool = False
        self.loading: bool = False
        self.error: Optional[str] = None
        self.loaded_at: float = 0.0
        self.lock = threading.Lock()

# -------------------------------------------------------------------- state ---
class ModelState:
    # TTS (Coqui VITS)
    synthesizer = None
    g2p = None
    speakers: list[str] = []
    sample_rate: int = SAMPLE_RATE_DEFAULT
    device: str = "cpu"
    loaded: bool = False
    load_error: Optional[str] = None

    # STT (local Whisper, per variant)
    whisper_instances: "dict[str, _WhisperInstance]" = {
        v: _WhisperInstance(cfg["hf_id"]) for v, cfg in WHISPER_VARIANTS.items()
    }

state = ModelState()


def _load_models() -> None:
    """Load Coqui Synthesizer + g2p-id. Heavy \u2014 seconds of boot time."""
    # imports are here so missing deps produce a better error on startup
    import torch
    from TTS.utils.synthesizer import Synthesizer
    from g2p_id import G2P

    missing = [p.name for p in (CHECKPOINT, CONFIG, SPEAKERS) if not p.exists()]
    if missing:
        raise FileNotFoundError(
            f"model files missing from {MODELS_DIR}: {missing}. "
            f"run `bash download.sh` first."
        )

    cuda_wanted = USE_CUDA == "auto" and torch.cuda.is_available() or USE_CUDA in {"1", "true", "yes"}
    if cuda_wanted and not torch.cuda.is_available():
        log.warning("IDN_TTS_USE_CUDA set but CUDA not available; falling back to CPU.")
        cuda_wanted = False

    t0 = time.time()
    _prev_cwd = os.getcwd()
    try:
        # The bundled config.json references "speakers.pth" with a relative path.
        # TTS's speaker manager resolves that against CWD, so cd into the models
        # directory while the Synthesizer is constructed.
        os.chdir(MODELS_DIR)
        synth = Synthesizer(
            tts_checkpoint=CHECKPOINT.name,
            tts_config_path=CONFIG.name,
            tts_speakers_file=SPEAKERS.name,
            use_cuda=cuda_wanted,
        )
    finally:
        os.chdir(_prev_cwd)
    state.synthesizer = synth
    state.g2p = G2P()
    state.device = f"cuda:{torch.cuda.get_device_name(0)}" if cuda_wanted else "cpu"

    # Pull speakers list from the loaded model
    try:
        sm = getattr(synth.tts_model, "speaker_manager", None)
        if sm is not None:
            state.speakers = sorted(list(sm.name_to_id.keys()))
        else:
            state.speakers = []
    except Exception as e:
        log.warning("speaker enumeration failed: %s", e)
        state.speakers = []

    # output sample rate
    try:
        state.sample_rate = int(synth.output_sample_rate)
    except Exception:
        state.sample_rate = SAMPLE_RATE_DEFAULT

    state.loaded = True
    log.info("ready in %.1fs \u00b7 device=%s \u00b7 sr=%d \u00b7 %d speaker(s)",
             time.time() - t0, state.device, state.sample_rate, len(state.speakers))


# ------------------------------------------------------------------ helpers ---

# ===================================================================
#                          Whisper (local STT)
# ===================================================================

def _default_whisper_variant() -> str:
    """Pick the default variant when the caller didn't specify one.

    Strategy: prefer the first CUDA-enabled entry already loaded; otherwise the
    first one in the map insertion order (``large-v3`` in our defaults).
    """
    for name, inst in state.whisper_instances.items():
        if inst.loaded:
            return name
    return next(iter(state.whisper_instances.keys()))


def _load_whisper_if_needed(variant: str) -> _WhisperInstance:
    """Lazy-load a Whisper variant. Each variant is loaded at most once."""
    if not WHISPER_ENABLED:
        raise RuntimeError("Whisper disabled (WHISPER_ENABLED=false)")
    if variant not in state.whisper_instances:
        raise ValueError(
            f"unknown whisper variant '{variant}'. try one of: "
            + ", ".join(state.whisper_instances.keys())
        )
    inst = state.whisper_instances[variant]
    if inst.loaded:
        return inst

    with inst.lock:
        if inst.loaded:
            return inst
        inst.loading = True
        inst.error = None
        try:
            import torch
            from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

            use_cuda = torch.cuda.is_available() and USE_CUDA != "0"
            dtype = torch.float16 if use_cuda else torch.float32
            dev = "cuda" if use_cuda else "cpu"
            t0 = time.time()
            log.info("loading Whisper '%s' (%s) on %s…", variant, inst.hf_id, dev)
            processor = AutoProcessor.from_pretrained(inst.hf_id)
            model = AutoModelForSpeechSeq2Seq.from_pretrained(
                inst.hf_id,
                torch_dtype=dtype,
                low_cpu_mem_usage=True,
                use_safetensors=True,
            ).to(dev)
            model.eval()
            inst.processor = processor
            inst.model = model
            inst.device = dev
            inst.loaded = True
            inst.loaded_at = time.time()
            log.info("Whisper '%s' ready in %.1fs on %s", variant, time.time() - t0, dev)
            return inst
        except Exception as e:  # noqa: BLE001
            log.exception("Whisper '%s' load failed", variant)
            inst.error = str(e) or e.__class__.__name__
            raise
        finally:
            inst.loading = False


def _decode_audio_to_16k(raw: bytes, filename: str = "") -> tuple["np.ndarray", int]:
    """Decode any audio container we can reach to mono 16 kHz float32.

    Uses soundfile first (covers wav/flac/ogg), falls back to librosa for
    mp3/m4a/webm via audioread / ffmpeg.
    """
    import numpy as np
    import soundfile as sf
    buf = io.BytesIO(raw)
    try:
        data, sr = sf.read(buf, dtype="float32", always_2d=False)
    except Exception:
        import librosa
        buf.seek(0)
        try:
            data, sr = librosa.load(buf, sr=16000, mono=True)
            return data.astype("float32"), 16000
        except Exception as le:
            raise ValueError(f"could not decode audio ({filename}): {le}") from le
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != 16000:
        import librosa
        data = librosa.resample(data.astype("float32"), orig_sr=sr, target_sr=16000)
        sr = 16000
    return data.astype("float32"), sr


def _whisper_transcribe(
    audio_bytes: bytes,
    filename: str = "audio",
    language: Optional[str] = None,
    task: str = "transcribe",
    return_segments: bool = False,
    variant: Optional[str] = None,
) -> dict:
    """Run audio through one Whisper variant. ``variant`` names a key from
    ``WHISPER_VARIANTS`` (``large-v3``/``medium``/``tiny``). Defaults to the
    first already-loaded variant, or ``large-v3``.
    """
    use_variant = variant or _default_whisper_variant()
    try:
        inst = _load_whisper_if_needed(use_variant)
    except RuntimeError:
        raise
    except ValueError:
        raise

    import numpy as np
    import torch

    if not audio_bytes:
        raise ValueError("empty audio")

    audio, _sr = _decode_audio_to_16k(audio_bytes, filename)
    if audio.size == 0:
        raise ValueError("audio decoded to zero samples")

    # Too-short clip guard (< 0.2 s) — Whisper will still produce something
    # but the output is usually garbage. Let it through and warn via log.
    duration_s = audio.size / 16000.0

    processor = inst.processor
    model = inst.model
    dev = inst.device
    dtype = torch.float16 if dev == "cuda" else torch.float32

    inputs = processor(audio, sampling_rate=16000, return_tensors="pt")
    input_features = inputs.input_features.to(dev, dtype=dtype)

    generate_kwargs: dict = {
        "task": task if task in ("transcribe", "translate") else "transcribe",
        "return_timestamps": return_segments,
    }
    if language:
        generate_kwargs["language"] = language.lower()

    with torch.no_grad():
        predicted_ids = model.generate(
            input_features,
            **generate_kwargs,
        )

    if return_segments:
        decoded = processor.batch_decode(
            predicted_ids, skip_special_tokens=True, output_offsets=True
        )
        text = decoded[0]["text"]
        segments = decoded[0].get("offsets", [])
    else:
        decoded = processor.batch_decode(predicted_ids, skip_special_tokens=True)
        text = (decoded[0] if decoded else "").strip()
        segments = []

    return {
        "variant": use_variant,
        "model": inst.hf_id,
        "text": text.strip(),
        "language": language or None,
        "duration": round(duration_s, 2),
        "segments": segments,
    }


# ------------------------------------------------------------------ helpers ---
_HANGING_PUNCT = re.compile(r"[\u201c\u201d\u2018\u2019\u2013\u2014]")

def _clean(text: str) -> str:
    """Light clean-up before g2p. Keeps ASCII punctuation."""
    text = _HANGING_PUNCT.sub("'", text).strip()
    # collapse runs of whitespace
    text = re.sub(r"\s+", " ", text)
    return text


def _pcm16_to_wav(samples: np.ndarray, sr: int) -> bytes:
    """Encode a float or int audio array as 16-bit mono WAV bytes."""
    if samples.dtype != np.int16:
        # TTS returns float in [-1, 1]
        peak = max(1e-6, float(np.max(np.abs(samples))))
        norm = np.clip(samples / max(1.0, peak), -1.0, 1.0)
        samples = (norm * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def _synthesize(text: str, speaker: str, *, split_sentences: bool = True,
                speed: float = 1.0) -> bytes:
    if not state.loaded or state.synthesizer is None or state.g2p is None:
        raise RuntimeError("model not loaded" + (f": {state.load_error}" if state.load_error else ""))
    if not text.strip():
        raise ValueError("empty text")

    # Default speaker: prefer the nicely-named Indonesian voices.
    if not speaker and state.speakers:
        for name in ("wibowo", "ardi", "gadis"):
            if name in state.speakers:
                speaker = name
                break
        else:
            speaker = state.speakers[0]
    if speaker and state.speakers and speaker not in state.speakers:
        named = [s for s in state.speakers if s in {"ardi", "gadis", "wibowo"}]
        hint = named or state.speakers[:8]
        raise ValueError(
            f"unknown speaker '{speaker}'. try one of: " + ", ".join(hint)
        )

    # ``speed`` is exposed as an intuitive multiplier: >1 slower, <1 faster.
    # VITS internal ``length_scale`` works the same way — clamp to a safe range.
    length_scale = max(0.5, min(2.5, float(speed or 1.0)))
    prev_length_scale = getattr(state.synthesizer.tts_model, "length_scale", 1.0)
    state.synthesizer.tts_model.length_scale = length_scale

    try:
        text = _clean(text)
        phonemes = state.g2p(text) or text  # fall back to raw text if G2P returns empty
        wav = state.synthesizer.tts(
            text=phonemes,
            speaker_name=speaker,
            split_sentences=split_sentences,
        )
    finally:
        state.synthesizer.tts_model.length_scale = prev_length_scale

    # synth.tts returns a list or np.ndarray depending on version
    arr = np.asarray(wav, dtype=np.float32).squeeze()
    return _pcm16_to_wav(arr, state.sample_rate)


# --------------------------------------------------------------- FastAPI app ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        _load_models()
    except Exception as e:  # keep the API alive so /health can report the failure
        log.exception("model load failed")
        state.load_error = str(e)
    yield


app = FastAPI(
    title="Indonesian TTS",
    version="1.2",
    description="Coqui TTS + g2p-id service for Bahasa Indonesia voices.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------- schemas ---
class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1)
    speaker: Optional[str] = None
    split_sentences: bool = True
    speed: float = Field(
        default=1.2, ge=0.5, le=2.5,
        description="Higher = slower. 1.0 rushes slightly; 1.2 reads naturally.",
    )


class SpeechRequest(BaseModel):
    """Subset of OpenAI /v1/audio/speech shape."""
    model: Optional[str] = None          # voice id, e.g. ``coqui/wibowo`` or plain ``wibowo``
    input: str = Field(..., min_length=1)
    voice: Optional[str] = None          # alternative place to send the speaker
    response_format: Optional[str] = "wav"
    speed: float = Field(default=1.2, ge=0.5, le=2.5)


# ---------------------------------------------------------------- routes ---
@app.get("/health")
def health() -> dict:
    # Aggregate per-variant whisper status for the dashboard.
    any_loaded = any(i.loaded for i in state.whisper_instances.values())
    any_loading = any(i.loading for i in state.whisper_instances.values())
    any_error = next((i.error for i in state.whisper_instances.values() if i.error), None)
    variants = {
        v: {
            "model": inst.hf_id,
            "loaded": inst.loaded,
            "loading": inst.loading,
            "error": inst.error,
            "device": inst.device if inst.loaded else None,
            "size_gb": WHISPER_VARIANTS[v]["size_gb"],
            "params_m": WHISPER_VARIANTS[v]["params_m"],
            "notes": WHISPER_VARIANTS[v]["notes"],
        }
        for v, inst in state.whisper_instances.items()
    }
    return {
        "ok": state.loaded,
        "loaded": state.loaded,
        "device": state.device,
        "sample_rate": state.sample_rate,
        "n_speakers": len(state.speakers),
        "error": state.load_error,
        "whisper": {
            "enabled": WHISPER_ENABLED,
            # Aggregated — true if any variant is in that state.
            "loaded": any_loaded,
            "loading": any_loading,
            "error": any_error,
            # Backwards-compatible single-model fields: first loaded variant.
            "model": next((i.hf_id for i in state.whisper_instances.values() if i.loaded),
                          next(iter(state.whisper_instances.values())).hf_id),
            "device": next((i.device for i in state.whisper_instances.values() if i.loaded), None),
            "default_variant": _default_whisper_variant(),
            "variants": variants,
        },
        "supertonic": supertonic_tts.state.to_health(),
    }


@app.get("/speakers")
def speakers() -> dict:
    named_order = ["wibowo", "ardi", "gadis"]
    default = next((n for n in named_order if n in state.speakers),
                   state.speakers[0] if state.speakers else None)
    return {
        "speakers": state.speakers,
        "named": [s for s in state.speakers if s in set(named_order)],
        "default": default,
    }


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    try:
        wav = _synthesize(req.text, req.speaker or "",
                          split_sentences=req.split_sentences,
                          speed=req.speed)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return Response(content=wav, media_type="audio/wav")


@app.post("/v1/audio/speech")
def openai_speech(req: SpeechRequest) -> Response:
    """Drop-in compatible with OpenAI / 9Router shape.

    We accept the speaker either via ``voice`` or by pulling the trailing
    component of ``model`` (e.g. ``coqui/wibowo`` \u2192 speaker ``wibowo``).
    """
    speaker = req.voice or ""
    if not speaker and req.model:
        speaker = req.model.split("/")[-1]
    try:
        wav = _synthesize(req.input, speaker, speed=req.speed)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return Response(content=wav, media_type="audio/wav")


# ============================================================
#                    Whisper endpoints
# ============================================================

@app.get("/whisper/variants")
def whisper_variants() -> dict:
    """Catalogue of Whisper variants exposed by this service + their status."""
    return {
        "enabled": WHISPER_ENABLED,
        "default": _default_whisper_variant(),
        "variants": {
            v: {
                "model": inst.hf_id,
                "loaded": inst.loaded,
                "loading": inst.loading,
                "error": inst.error,
                "device": inst.device if inst.loaded else None,
                **WHISPER_VARIANTS[v],
            }
            for v, inst in state.whisper_instances.items()
        },
    }


def _kick_off_whisper_load(variant: str) -> None:
    """Fire-and-forget a background thread that loads a variant. Returns
    immediately; subsequent /health polls will see ``loading=true`` then
    ``loaded=true``.
    """
    def _bg():
        try:
            _load_whisper_if_needed(variant)
        except Exception:  # noqa: BLE001
            pass
    if variant not in state.whisper_instances:
        return
    inst = state.whisper_instances[variant]
    if inst.loaded or inst.loading:
        return
    threading.Thread(target=_bg, name=f"whisper-load-{variant}", daemon=True).start()


@app.post("/whisper/load")
async def whisper_load(
    variant: str = Form(..., description="tiny | medium | large-v3"),
) -> dict:
    """Kick off a background load of a variant without submitting audio.

    Returns 202 with the current status so the caller can poll ``/health``
    (or ``/whisper/variants``) for progress.
    """
    if variant not in state.whisper_instances:
        raise HTTPException(
            400, f"unknown variant '{variant}'. try one of: "
                 + ", ".join(state.whisper_instances.keys()))
    inst = state.whisper_instances[variant]
    _kick_off_whisper_load(variant)
    return {
        "variant": variant,
        "model": inst.hf_id,
        "loaded": inst.loaded,
        "loading": inst.loading or (not inst.loaded),  # just kicked off
        "error": inst.error,
    }


@app.post("/whisper/transcribe")
async def whisper_transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    task: Optional[str] = Form(default="transcribe"),
    return_segments: bool = Form(default=False),
    variant: Optional[str] = Form(default=None, description="tiny | medium | large-v3"),
) -> dict:
    """Transcribe an audio file using the selected Whisper variant."""
    raw = await file.read()
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(413, f"file too large ({len(raw)} bytes; cap 200 MB)")
    try:
        result = _whisper_transcribe(
            raw,
            filename=file.filename or "audio",
            language=language,
            task=task or "transcribe",
            return_segments=bool(return_segments),
            variant=variant or None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return result


@app.post("/v1/audio/transcriptions")
async def openai_transcriptions(
    file: UploadFile = File(...),
    model: str = Form(default=""),
    language: Optional[str] = Form(default=None),
    prompt: Optional[str] = Form(default=None),
    response_format: Optional[str] = Form(default="json"),
    temperature: Optional[float] = Form(default=None),
):
    """OpenAI-compatible Whisper endpoint. ``model`` selects the variant
    when it matches one of our keys (e.g. ``local/whisper-medium`` or
    just ``medium``). Otherwise the default variant is used.
    """
    raw = await file.read()
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(413, f"file too large ({len(raw)} bytes; cap 200 MB)")

    # Resolve variant from the model field if possible.
    variant = None
    if model:
        short = model.split("/")[-1]
        if short in state.whisper_instances:
            variant = short
        elif short.startswith("whisper-") and short[len("whisper-"):] in state.whisper_instances:
            variant = short[len("whisper-"):]

    try:
        result = _whisper_transcribe(
            raw,
            filename=file.filename or "audio",
            language=language,
            task="transcribe",
            return_segments=(response_format == "verbose_json"),
            variant=variant,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    if response_format == "text":
        return Response(content=result["text"], media_type="text/plain")
    if response_format == "verbose_json":
        return {
            "task": "transcribe",
            "language": result.get("language"),
            "duration": result.get("duration"),
            "text": result["text"],
            "segments": result.get("segments", []),
        }
    return {"text": result["text"]}


# ---------------------------------------------------------------------------
# Supertonic TTS endpoints (on-device, 31 languages)
# ---------------------------------------------------------------------------

@app.get("/supertonic/voices")
def supertonic_voices() -> dict:
    """Return the catalogue of Supertonic voice styles + per-voice status."""
    s = supertonic_tts.state
    return {
        "enabled": s.enabled,
        "loaded": s.loaded,
        "loading": s.loading,
        "error": s.error,
        "device": s.device,
        "voices_source": s.voices_source,
        "voices": supertonic_tts.list_voices(),
        "sample_rate": supertonic_tts.SAMPLE_RATE,
    }


@app.get("/supertonic/languages")
def supertonic_languages() -> dict:
    """Return the 31 ISO-639-1 codes Supertonic supports."""
    return {
        "default": supertonic_tts.DEFAULT_LANGUAGE,
        "languages": supertonic_tts.list_languages(),
    }


@app.post("/supertonic/load")
def supertonic_load() -> dict:
    """Kick off a background load of the Supertonic model. Returns fast.
    Subsequent calls while loading are no-ops; poll /health for progress.
    """
    if not supertonic_tts.is_enabled():
        raise HTTPException(503, "supertonic SDK not installed")
    supertonic_tts.kick_off()
    s = supertonic_tts.state
    return {
        "started": True,
        "loaded": s.loaded,
        "loading": s.loading,
        "error": s.error,
    }


@app.post("/supertonic/speak")
def supertonic_speak(
    text: str = Form(...),
    voice: str = Form("M1"),
    language: str = Form(supertonic_tts.DEFAULT_LANGUAGE),
    speed: float = Form(1.05),
    total_steps: int = Form(5),
) -> Response:
    """Synthesise speech with Supertonic. Returns raw audio/wav bytes.
    First call may block for ~30-90 s while the 260 MB bundle downloads.
    """
    if not supertonic_tts.is_enabled():
        raise HTTPException(503, "supertonic SDK not installed")
    text = (text or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    if speed < 0.5 or speed > 2.5:
        raise HTTPException(400, "speed must be between 0.5 and 2.5")

    try:
        audio_bytes, meta = supertonic_tts.synthesize(
            text,
            voice=voice,
            language=language,
            speed=float(speed),
            total_steps=int(total_steps),
        )
    except ValueError as e:
        # unknown voice / language — helpful 400
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    headers = {
        "X-Supertonic-Voice": meta["voice"],
        "X-Supertonic-Language": meta["language"],
        "X-Supertonic-Sample-Rate": str(meta["sample_rate"]),
        "X-Supertonic-Duration-S": f"{meta['duration_s']:.3f}",
    }
    return Response(content=audio_bytes, media_type="audio/wav", headers=headers)


@app.exception_handler(Exception)
async def _catchall(_, exc: Exception):
    # keep one consistent shape for the dashboard
    log.exception("unhandled error")
    return JSONResponse(status_code=500, content={
        "error": {"status": 500, "body": {"message": str(exc) or exc.__class__.__name__},
                  "url": "/v1/audio/speech"}
    })
