"""Client for the optional local Indonesian TTS service (``idn-tts/``).

The dashboard treats this as another TTS provider: when reachable, voices
appear in the TTS panel under the ``coqui/<speaker>`` prefix, and requests
with that prefix are routed here instead of to 9Router.

Failure modes are swallowed silently — the service is entirely optional.
"""
from __future__ import annotations

import asyncio
import time
from typing import Optional

import httpx

from .config import Settings


class IdnTTSError(Exception):
    def __init__(self, status: int, body):
        self.status = status
        self.body = body
        super().__init__(f"idn-tts {status}: {body}")

    def to_dict(self) -> dict:
        return {"error": {"status": self.status, "body": self.body, "url": "/synthesize"}}


class IdnTTSClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base = settings.idn_tts_url.rstrip("/")
        self.enabled = settings.idn_tts_enabled
        self._client = httpx.AsyncClient(
            base_url=self.base,
            timeout=httpx.Timeout(settings.request_timeout, connect=5.0),
        )
        self._cached_speakers: list[str] = []
        self._speakers_ttl = 0.0
        self._default_cached: str = ""
        self._lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ----------------------------------------------------------- discovery
    async def health(self) -> Optional[dict]:
        if not self.enabled:
            return None
        try:
            r = await self._client.get("/health", timeout=3.0)
            if r.status_code >= 400:
                return None
            return r.json()
        except Exception:
            return None

    async def is_reachable(self) -> bool:
        h = await self.health()
        return bool(h and h.get("loaded"))

    async def whisper_is_reachable(self) -> bool:
        """Whisper can work even if the Coqui TTS model failed to load, so
        this checks the service+whisper state independently."""
        h = await self.health()
        if not h:
            return False
        w = h.get("whisper") or {}
        if not w.get("enabled"):
            return False
        # Either already loaded, or still able to lazy-load (no terminal error).
        return bool(w.get("loaded") or (not w.get("error")))

    async def speakers(self) -> list[str]:
        """Cached list of speaker IDs. Empty list if the service is unreachable."""
        async with self._lock:
            if self._cached_speakers and (time.time() - self._speakers_ttl) < 60:
                return self._cached_speakers
            if not self.enabled:
                return []
            try:
                r = await self._client.get("/speakers", timeout=3.0)
                if r.status_code >= 400:
                    return self._cached_speakers
                data = r.json()
                self._cached_speakers = list(data.get("speakers") or [])
                self._default_cached = data.get("default") or "wibowo"
                self._speakers_ttl = time.time()
                return self._cached_speakers
            except Exception:
                return self._cached_speakers

    async def default_speaker(self) -> str:
        if self._default_cached:
            return self._default_cached
        await self.speakers()
        return self._default_cached or "wibowo"

    # --------------------------------------------------------------- speak
    async def speak(self, text: str, speaker: str, speed: float = 1.2) -> tuple[bytes, str]:
        """Synthesize audio. Returns ``(bytes, content_type)``."""
        payload = {"text": text, "speaker": speaker, "speed": speed}
        r = await self._client.post("/synthesize", json=payload)
        if r.status_code >= 400:
            try:
                body = r.json()
            except Exception:
                body = r.text
            raise IdnTTSError(r.status_code, body)
        return r.content, r.headers.get("content-type", "audio/wav")

    # --------------------------------------------------------- whisper STT
    async def whisper_transcribe(
        self,
        audio_bytes: bytes,
        filename: str,
        *,
        language: Optional[str] = None,
        task: str = "transcribe",
        return_segments: bool = False,
    ) -> dict:
        files = {"file": (filename, audio_bytes)}
        data: dict = {}
        if language:
            data["language"] = language
        if task and task != "transcribe":
            data["task"] = task
        if return_segments:
            data["return_segments"] = "true"
        r = await self._client.post("/whisper/transcribe", data=data, files=files, timeout=600.0)
        if r.status_code >= 400:
            try:
                body = r.json()
            except Exception:
                body = r.text
            raise IdnTTSError(r.status_code, body)
        return r.json()


# --------------------------------------------------------- helper constants
_COQUI_MODEL_PREFIX = "coqui/"
_WHISPER_MODEL_PREFIX = "local/whisper"


def is_coqui_model(model: str) -> bool:
    return bool(model) and model.startswith(_COQUI_MODEL_PREFIX)


def coqui_speaker_from_model(model: str) -> str:
    return model[len(_COQUI_MODEL_PREFIX):] if is_coqui_model(model) else ""


def is_local_whisper_model(model: str) -> bool:
    """Any ``local/whisper*`` model routes to the idn-tts service's Whisper loader."""
    return bool(model) and model.startswith(_WHISPER_MODEL_PREFIX)