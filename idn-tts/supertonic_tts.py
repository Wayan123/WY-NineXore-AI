"""Supertonic TTS integration for the idn-tts service.

This module is the thin lazy-load wrapper around the Supertonic Python
SDK (`pip install supertonic`). It mirrors the multi-variant Whisper
loader pattern used elsewhere in service.py:

  - one process-global `_State` singleton
  - one threading.Lock around model load
  - lazy load on first synth, or eager load via kick_off()
  - failure surfaced via state.error rather than raised exceptions
  - lock around `tts.synthesize(...)` to avoid concurrent ONNX session
    races (cheap on a laptop CPU; lift to a pool later if needed)

The module imports `supertonic` lazily so the dashboard process can
start even when the wheel is not installed yet (e.g. ARM platforms with
no ONNX wheel — `enabled` reports False and the dashboard hides the
optgroup).

Public surface:

    state                        # SupertonicState singleton
    SUPPORTED_LANGUAGES          # tuple of 31 ISO-639-1 codes
    LANGUAGE_LABELS              # {code: english_label}
    DEFAULT_VOICES               # fallback voice list before first download

    is_enabled() -> bool
    load(use_gpu=False) -> None  # blocking
    kick_off(use_gpu=False) -> None  # background thread
    list_voices() -> list[dict]
    list_languages() -> list[dict]
    synthesize(text, *, voice="M1", language="en", speed=1.05) -> tuple[bytes, dict]
"""

from __future__ import annotations

import io
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("idn-tts.supertonic")

# Stock voice styles that ship in every Supertonic 3 release. We keep a
# hand-maintained list so the dashboard can show the optgroup before the
# 260 MB bundle has been downloaded for the first time. The full list is
# refreshed from the on-disk cache once load() succeeds.
DEFAULT_VOICES: tuple[str, ...] = (
    "M1", "M2", "M3", "M4", "M5",
    "F1", "F2", "F3", "F4", "F5",
)

# 31 supported language codes. The single trailing 'na' code returned by
# `supertonic.SUPPORTED_LANGUAGES` is the unknown-language sentinel and
# is intentionally excluded from the user-facing dropdown.
SUPPORTED_LANGUAGES: tuple[str, ...] = (
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es",
    "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv",
    "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk",
    "vi",
)

LANGUAGE_LABELS: dict[str, str] = {
    "en": "English",        "ko": "Korean",      "ja": "Japanese",
    "ar": "Arabic",         "bg": "Bulgarian",   "cs": "Czech",
    "da": "Danish",         "de": "German",      "el": "Greek",
    "es": "Spanish",        "et": "Estonian",    "fi": "Finnish",
    "fr": "French",         "hi": "Hindi",       "hr": "Croatian",
    "hu": "Hungarian",      "id": "Indonesian",  "it": "Italian",
    "lt": "Lithuanian",     "lv": "Latvian",     "nl": "Dutch",
    "pl": "Polish",         "pt": "Portuguese",  "ro": "Romanian",
    "ru": "Russian",        "sk": "Slovak",      "sl": "Slovenian",
    "sv": "Swedish",        "tr": "Turkish",     "uk": "Ukrainian",
    "vi": "Vietnamese",
}

DEFAULT_LANGUAGE = "en"
SAMPLE_RATE = 24000  # Supertonic 3 always returns 24 kHz mono


@dataclass
class SupertonicState:
    """Process-global state for the Supertonic loader."""
    enabled: bool = False
    loaded: bool = False
    loading: bool = False
    error: Optional[str] = None
    device: Optional[str] = None  # "cpu" | "cuda" | None until load
    voices: list[str] = field(default_factory=lambda: list(DEFAULT_VOICES))
    voices_source: str = "default"  # "default" | "cache"
    loaded_at: Optional[float] = None
    model_dir: Optional[str] = None
    # Internal:
    lock: threading.Lock = field(default_factory=threading.Lock)
    synth_lock: threading.Lock = field(default_factory=threading.Lock)
    tts: object = None  # supertonic.TTS instance once loaded

    def to_health(self) -> dict:
        return {
            "enabled": self.enabled,
            "loaded": self.loaded,
            "loading": self.loading,
            "error": self.error,
            "device": self.device,
            "voices": list(self.voices),
            "voices_source": self.voices_source,
            "languages": list(SUPPORTED_LANGUAGES),
            "default_language": DEFAULT_LANGUAGE,
            "sample_rate": SAMPLE_RATE,
            "model_dir": self.model_dir,
        }


state = SupertonicState()

# Detect once at import whether the SDK is even available. We do not
# load the model — that's deferred to load() / synthesize().
try:
    import supertonic as _supertonic  # noqa: F401
    state.enabled = True
except Exception as _e:
    logger.info("supertonic SDK not importable; disabled (%s)", _e)
    state.enabled = False
    state.error = f"supertonic SDK not importable: {_e}"


def is_enabled() -> bool:
    return state.enabled


def _refresh_voices_from_cache() -> None:
    """Populate state.voices from the on-disk cache after load(). Safe to
    call repeatedly; falls back to DEFAULT_VOICES if the cache lookup
    fails for any reason."""
    try:
        from supertonic.loader import (
            list_available_voice_style_names,
            get_model_cache_dir,
        )
        model_dir = get_model_cache_dir("supertonic-3")
        names = list_available_voice_style_names(model_dir)
        if names:
            # Stable ordering: M1..M5, F1..F5, then anything else
            def sort_key(n: str) -> tuple:
                fam = "M" if n.startswith("M") else ("F" if n.startswith("F") else "Z")
                rest = n[1:] if n[0] in "MF" else n
                try:
                    rest_num = int(rest)
                except ValueError:
                    rest_num = 999
                return (fam, rest_num, n)
            state.voices = sorted(names, key=sort_key)
            state.voices_source = "cache"
            state.model_dir = str(model_dir)
            logger.info("supertonic voices refreshed from cache: %s", state.voices)
    except Exception as e:
        logger.warning("supertonic voice refresh failed: %s", e)


def load() -> None:
    """Synchronously load the Supertonic 3 model. Blocks the caller for
    ~1-3 s on a warm cache, ~30-90 s on first download (260 MB).

    The Supertonic Python SDK currently runs ONNX on CPU only — there is
    no device knob to surface, so we don't pretend to have one. ``device``
    in state is always ``"cpu"`` after a successful load.

    Idempotent. Concurrent calls block on a single lock.
    """
    if not state.enabled:
        raise RuntimeError("Supertonic SDK not installed (pip install supertonic)")
    if state.loaded:
        return

    with state.lock:
        if state.loaded:        # double-checked
            return
        state.loading = True
        state.error = None
        try:
            from supertonic import TTS
            t0 = time.time()
            tts = TTS(model="supertonic-3", auto_download=True)
            state.tts = tts
            state.device = "cpu"
            state.loaded = True
            state.loaded_at = time.time()
            elapsed = state.loaded_at - t0
            logger.info("supertonic loaded in %.1fs on %s", elapsed, state.device)
            _refresh_voices_from_cache()
        except Exception as e:
            state.error = str(e)
            logger.exception("supertonic load failed")
            raise
        finally:
            state.loading = False


def kick_off() -> None:
    """Start a background load thread. Returns immediately. Subsequent
    calls while a load is in progress are no-ops.
    """
    if not state.enabled or state.loaded or state.loading:
        return

    def _runner():
        try:
            load()
        except Exception:
            # error is recorded on state; nothing to do here
            pass

    th = threading.Thread(target=_runner, name="supertonic-loader", daemon=True)
    th.start()


def list_voices() -> list[dict]:
    """Return the catalogue of voices, with status hints."""
    rows = []
    for name in state.voices:
        family = "M" if name.startswith("M") else ("F" if name.startswith("F") else "custom")
        rows.append({
            "name": name,
            "family": family,
            "source": state.voices_source,
        })
    return rows


def list_languages() -> list[dict]:
    """Return the 31 supported languages with English labels."""
    return [
        {"code": c, "label": LANGUAGE_LABELS.get(c, c)}
        for c in SUPPORTED_LANGUAGES
    ]


def _wav_bytes_from_array(wav, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Encode a `(1, N)` or `(N,)` numpy array as 16-bit WAV bytes."""
    import numpy as np
    import soundfile as sf

    arr = wav
    # Supertonic returns shape (1, N); collapse to mono.
    if hasattr(arr, "ndim") and arr.ndim == 2 and arr.shape[0] == 1:
        arr = arr[0]
    # Clip to [-1, 1] as a defence against the rare amplitude overshoot.
    arr = np.clip(arr, -1.0, 1.0).astype(np.float32)

    buf = io.BytesIO()
    sf.write(buf, arr, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def synthesize(
    text: str,
    *,
    voice: str = "M1",
    language: str = DEFAULT_LANGUAGE,
    speed: float = 1.05,
    total_steps: int = 5,
) -> tuple[bytes, dict]:
    """Synthesise speech and return (wav_bytes, meta_dict).

    Lazy-loads the model on first call (blocks for ~30-90 s on first
    download, ~1-3 s on warm cache).

    Raises:
        RuntimeError if SDK unavailable
        ValueError on unknown voice / language
        Exception from the underlying SDK on synthesis failure
    """
    if not state.enabled:
        raise RuntimeError("Supertonic SDK not installed")

    if language not in SUPPORTED_LANGUAGES:
        raise ValueError(
            f"language '{language}' not supported by Supertonic; "
            f"choose one of {', '.join(SUPPORTED_LANGUAGES)}"
        )

    if not state.loaded:
        load()

    # Refresh voice list once the cache is hydrated; cheap, idempotent.
    if state.voices_source != "cache":
        _refresh_voices_from_cache()

    if voice not in state.voices:
        raise ValueError(
            f"voice '{voice}' not available; choose one of {', '.join(state.voices)}"
        )

    tts = state.tts
    style = tts.get_voice_style(voice_name=voice)

    t0 = time.time()
    with state.synth_lock:
        wav, duration = tts.synthesize(
            text,
            voice_style=style,
            speed=speed,
            lang=language,
            total_steps=total_steps,
        )
    elapsed = time.time() - t0

    # `duration` is np.ndarray shape=(1,) — pull scalar
    try:
        duration_s = float(duration[0]) if hasattr(duration, "__getitem__") else float(duration)
    except Exception:
        duration_s = 0.0

    audio_bytes = _wav_bytes_from_array(wav, sample_rate=SAMPLE_RATE)

    meta = {
        "voice": voice,
        "language": language,
        "speed": speed,
        "total_steps": total_steps,
        "sample_rate": SAMPLE_RATE,
        "duration_s": duration_s,
        "synthesis_s": round(elapsed, 3),
        "n_bytes": len(audio_bytes),
    }
    logger.info(
        "supertonic synth ok: voice=%s lang=%s len=%.2fs (took %.2fs)",
        voice, language, duration_s, elapsed,
    )
    return audio_bytes, meta
