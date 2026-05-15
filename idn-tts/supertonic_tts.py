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

# Bilingual voice descriptions, sourced from the official Supertonic 3
# voice guide (https://supertone-inc.github.io/supertonic-py/voices/).
#
# Each entry has:
#   gender   : "male" | "female"          (always English, used as a key)
#   en       : { description, use_cases } in English
#   id       : { description, use_cases } in Indonesian
#
# Custom voice styles loaded from JSON via tts.get_voice_style_from_path()
# fall back to a generic "custom" descriptor in list_voices().
VOICE_PROFILES: dict[str, dict] = {
    "M1": {
        "gender": "male",
        "en": {
            "description": "Lively, upbeat male voice with confident energy and a standard, clear tone.",
            "use_cases": "Promotional videos, upbeat explainers, general-purpose narration, casual announcements.",
        },
        "id": {
            "description": "Suara pria lincah dan bersemangat dengan energi percaya diri dan nada jernih standar.",
            "use_cases": "Video promosi, explainer ceria, narasi serbaguna, pengumuman santai.",
        },
    },
    "M2": {
        "gender": "male",
        "en": {
            "description": "Deep, robust male voice; calm, composed, and serious with a grounded presence.",
            "use_cases": "Corporate content, serious announcements, documentaries, formal guidance.",
        },
        "id": {
            "description": "Suara pria dalam dan kokoh; tenang, mantap, dan serius dengan kehadiran yang membumi.",
            "use_cases": "Konten korporat, pengumuman serius, dokumenter, panduan formal.",
        },
    },
    "M3": {
        "gender": "male",
        "en": {
            "description": "Polished, authoritative male voice; confident and trustworthy with strong presentation quality.",
            "use_cases": "Business presentations, leadership messages, investor briefings, high-trust narration.",
        },
        "id": {
            "description": "Suara pria berwibawa dan terlatih; percaya diri dan terpercaya dengan kualitas presentasi yang kuat.",
            "use_cases": "Presentasi bisnis, pesan kepemimpinan, briefing investor, narasi yang menuntut kredibilitas tinggi.",
        },
    },
    "M4": {
        "gender": "male",
        "en": {
            "description": "Soft, neutral-toned male voice; gentle and approachable with a youthful, friendly quality.",
            "use_cases": "Educational content, friendly explainers, onboarding guides, youth-oriented narration.",
        },
        "id": {
            "description": "Suara pria lembut bernada netral; halus dan ramah dengan nuansa muda dan akrab.",
            "use_cases": "Konten edukasi, explainer ramah, panduan onboarding, narasi untuk audiens muda.",
        },
    },
    "M5": {
        "gender": "male",
        "en": {
            "description": "Warm, soft-spoken male voice; calm and soothing with a natural storytelling quality.",
            "use_cases": "Audiobooks, relaxation content, bedtime stories, reflective or emotional narration.",
        },
        "id": {
            "description": "Suara pria hangat dan lembut; tenang dan menenangkan dengan nuansa pencerita alami.",
            "use_cases": "Audiobook, konten relaksasi, cerita pengantar tidur, narasi reflektif atau emosional.",
        },
    },
    "F1": {
        "gender": "female",
        "en": {
            "description": "Calm female voice with a slightly low tone; steady and composed.",
            "use_cases": "Customer service, guided instructions, meditative content, professional narration.",
        },
        "id": {
            "description": "Suara wanita tenang dengan nada sedikit rendah; stabil dan mantap.",
            "use_cases": "Layanan pelanggan, instruksi terpandu, konten meditatif, narasi profesional.",
        },
    },
    "F2": {
        "gender": "female",
        "en": {
            "description": "Bright, cheerful female voice; lively, playful, and youthful with spirited energy.",
            "use_cases": "Youth content, playful ads, social media videos, character voices.",
        },
        "id": {
            "description": "Suara wanita cerah dan ceria; lincah, ceria, dan muda dengan energi penuh semangat.",
            "use_cases": "Konten remaja, iklan ceria, video media sosial, suara karakter.",
        },
    },
    "F3": {
        "gender": "female",
        "en": {
            "description": "Clear, professional announcer-style female voice; articulate and broadcast-ready.",
            "use_cases": "Commercials, documentaries, news-style narration, formal presentations.",
        },
        "id": {
            "description": "Suara wanita jernih dengan gaya penyiar profesional; artikulasi tajam dan siap tayang.",
            "use_cases": "Iklan, dokumenter, narasi gaya berita, presentasi formal.",
        },
    },
    "F4": {
        "gender": "female",
        "en": {
            "description": "Crisp, confident female voice; distinct and expressive with strong delivery.",
            "use_cases": "Business explainers, training videos, pitch decks, product announcements.",
        },
        "id": {
            "description": "Suara wanita tegas dan percaya diri; khas dan ekspresif dengan penyampaian yang kuat.",
            "use_cases": "Explainer bisnis, video pelatihan, pitch deck, pengumuman produk.",
        },
    },
    "F5": {
        "gender": "female",
        "en": {
            "description": "Kind, gentle female voice; soft-spoken, calm, and naturally soothing.",
            "use_cases": "Audiobooks, supportive messages, wellness content, empathetic narration.",
        },
        "id": {
            "description": "Suara wanita lembut dan ramah; halus, tenang, dan menenangkan secara alami.",
            "use_cases": "Audiobook, pesan dukungan, konten kesehatan, narasi empatik.",
        },
    },
}

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

# Indonesian-language labels for the 31 supported languages, used by the
# bilingual UI when the user picks Indonesian as their interface language.
LANGUAGE_LABELS_ID: dict[str, str] = {
    "en": "Inggris",        "ko": "Korea",       "ja": "Jepang",
    "ar": "Arab",           "bg": "Bulgaria",    "cs": "Ceko",
    "da": "Denmark",        "de": "Jerman",      "el": "Yunani",
    "es": "Spanyol",        "et": "Estonia",     "fi": "Finlandia",
    "fr": "Prancis",        "hi": "Hindi",       "hr": "Kroasia",
    "hu": "Hungaria",       "id": "Indonesia",   "it": "Italia",
    "lt": "Lithuania",      "lv": "Latvia",      "nl": "Belanda",
    "pl": "Polandia",       "pt": "Portugis",    "ro": "Rumania",
    "ru": "Rusia",          "sk": "Slovakia",    "sl": "Slovenia",
    "sv": "Swedia",         "tr": "Turki",       "uk": "Ukraina",
    "vi": "Vietnam",
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
    """Return the catalogue of voices, with bilingual descriptions.

    Each row carries the gender + EN/ID descriptions when known. Voices
    not in VOICE_PROFILES (e.g. user-supplied custom styles) get a
    generic "custom" descriptor so the dashboard never renders blank.
    """
    rows = []
    for name in state.voices:
        family = "M" if name.startswith("M") else ("F" if name.startswith("F") else "custom")
        profile = VOICE_PROFILES.get(name)
        if profile is None:
            profile = {
                "gender": "custom",
                "en": {
                    "description": "Custom voice style.",
                    "use_cases": "User-supplied voice loaded from a JSON style file.",
                },
                "id": {
                    "description": "Style suara kustom.",
                    "use_cases": "Suara kustom yang dimuat dari file JSON pengguna.",
                },
            }
        rows.append({
            "name": name,
            "family": family,
            "gender": profile["gender"],
            "source": state.voices_source,
            "description": {
                "en": profile["en"]["description"],
                "id": profile["id"]["description"],
            },
            "use_cases": {
                "en": profile["en"]["use_cases"],
                "id": profile["id"]["use_cases"],
            },
        })
    return rows


def list_languages() -> list[dict]:
    """Return the 31 supported languages with both EN and ID labels."""
    return [
        {
            "code": c,
            "label": LANGUAGE_LABELS.get(c, c),       # back-compat: English label
            "label_en": LANGUAGE_LABELS.get(c, c),
            "label_id": LANGUAGE_LABELS_ID.get(c, LANGUAGE_LABELS.get(c, c)),
        }
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
