"""/api/tts — text-to-speech.

Routes by model prefix:
* ``coqui/<speaker>`` → local Indonesian TTS service (``idn-tts/``)
* everything else     → 9Router upstream

The file the audio is saved to is always under ``DATA_DIR/outputs/``.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..client import NineRouterClient
from ..config import Settings
from ..idn_tts import (
    IdnTTSClient,
    IdnTTSError,
    coqui_speaker_from_model,
    is_coqui_model,
    is_supertonic_model,
    is_supertonic_language,
    supertonic_voice_from_model,
)
from ..storage.db import HistoryStore
from ..utils import ext_from_ctype, slugify, unique_path
from .deps import get_client, get_idn_tts, get_settings_dep, get_store

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TTSRequest(BaseModel):
    model: str
    input: str
    voice: Optional[str] = None
    speed: float = Field(default=1.2, ge=0.5, le=2.5,
                        description="Applies to local Coqui and Supertonic.")
    language: Optional[str] = Field(default=None,
                        description="ISO-639-1 code. Used by Supertonic; ignored elsewhere.")
    extra: dict[str, Any] = Field(default_factory=dict)


@router.get("/voices")
async def voices(
    provider: Optional[str] = Query(default=None),
    lang: Optional[str] = Query(default=None),
    client: NineRouterClient = Depends(get_client),
    idn: IdnTTSClient = Depends(get_idn_tts),
) -> dict:
    """Return upstream voices plus any local Coqui voices (when reachable)."""
    try:
        upstream = await client.list_voices(provider=provider, lang=lang)
    except Exception:
        upstream = {"data": []}

    data = list(upstream.get("data") or [])

    # Append coqui voices only when the user isn't filtering by a different provider.
    if (not provider or provider in ("coqui", "idn", "indonesian")) and (
        not lang or lang.lower() in ("id", "in", "idn", "indo", "bahasa")
    ):
        try:
            speakers = await idn.speakers()
        except Exception:
            speakers = []
        for name in speakers:
            data.append({
                "model": f"coqui/{name}",
                "provider": "coqui",
                "language": "id",
                "name": name,
            })

    return {"data": data}


@router.post("/speak")
async def speak(
    req: TTSRequest,
    client: NineRouterClient = Depends(get_client),
    idn: IdnTTSClient = Depends(get_idn_tts),
    settings: Settings = Depends(get_settings_dep),
    store: HistoryStore = Depends(get_store),
) -> dict:
    # --- local Indonesian TTS branch ----------------------------------------
    if is_coqui_model(req.model) or is_coqui_model(req.voice or ""):
        speaker = (req.voice or "").strip()
        if is_coqui_model(req.voice or ""):
            speaker = coqui_speaker_from_model(req.voice or "")
        if not speaker and is_coqui_model(req.model):
            speaker = coqui_speaker_from_model(req.model)

        if not idn.enabled:
            raise HTTPException(503, "Indonesian TTS service is disabled (IDN_TTS_ENABLED=false).")
        if not await idn.is_reachable():
            raise HTTPException(
                503,
                f"Indonesian TTS service unreachable at {idn.base}. Check /tmp/wy-nine-idn-tts.log and restart ./run.sh.",
            )

        try:
            blob, ctype = await idn.speak(req.input, speaker, speed=req.speed)
        except IdnTTSError:
            # bubble up — handled by the global exception handler in main.py
            raise

        ext = ext_from_ctype(ctype, "wav")
        dst = unique_path(settings.outputs_path, slugify(req.input[:40] or speaker), ext)
        dst.write_bytes(blob)
        rel = f"outputs/{dst.name}"
        out_id = store.log_output(
            kind="tts",
            model=f"coqui/{speaker}",
            prompt=req.input,
            result={"content_type": ctype, "bytes": len(blob), "provider": "coqui",
                    "speed": req.speed},
            file_path=rel,
        )
        return {
            "id": out_id,
            "model": f"coqui/{speaker}",
            "input": req.input,
            "file": rel,
            "url": f"/files/{rel}",
            "content_type": ctype,
            "bytes": len(blob),
            "speed": req.speed,
        }

    # --- Supertonic on-device TTS branch (31 languages) ---------------------
    if is_supertonic_model(req.model) or is_supertonic_model(req.voice or ""):
        voice = supertonic_voice_from_model(req.voice or "") or supertonic_voice_from_model(req.model)
        voice = voice or "M1"
        language = (req.language or "").strip().lower() or "en"
        if not is_supertonic_language(language):
            raise HTTPException(
                400,
                f"Supertonic does not support language '{language}'. "
                f"GET /api/idn-tts/supertonic/languages for the full list.",
            )

        if not idn.enabled:
            raise HTTPException(503, "Local TTS service is disabled (IDN_TTS_ENABLED=false).")
        # Note: we don't gate Supertonic on the Coqui-TTS load. Supertonic
        # is its own loader. We only need the service process to be alive
        # and the SDK importable.
        if not await idn.supertonic_is_reachable():
            raise HTTPException(
                503,
                "Supertonic SDK is not installed in the local TTS env, "
                "or the local service is unreachable. "
                "Run: conda activate torch-gpu && pip install supertonic",
            )

        # First-time call may block while the 260 MB bundle downloads.
        # The client uses a 180 s read timeout, which is enough for a
        # warm cache + cold load on a typical home connection.
        try:
            blob, ctype = await idn.supertonic_speak(
                req.input,
                voice=voice,
                language=language,
                speed=req.speed,
            )
        except IdnTTSError:
            raise

        ext = ext_from_ctype(ctype, "wav")
        dst = unique_path(
            settings.outputs_path,
            slugify(req.input[:40] or f"supertonic-{voice}-{language}"),
            ext,
        )
        dst.write_bytes(blob)
        rel = f"outputs/{dst.name}"
        out_id = store.log_output(
            kind="tts",
            model=f"supertonic/{voice}",
            prompt=req.input,
            result={
                "content_type": ctype,
                "bytes": len(blob),
                "provider": "supertonic",
                "language": language,
                "speed": req.speed,
            },
            file_path=rel,
        )
        return {
            "id": out_id,
            "model": f"supertonic/{voice}",
            "input": req.input,
            "file": rel,
            "url": f"/files/{rel}",
            "content_type": ctype,
            "bytes": len(blob),
            "language": language,
            "speed": req.speed,
        }

    # --- 9Router upstream branch --------------------------------------------
    body: dict[str, Any] = {"model": req.model, "input": req.input}
    if req.voice:
        body["voice"] = req.voice
    # Forward speed to any upstream that honors it (OpenAI / Edge-TTS / …).
    # Upstreams that don't look at the field simply ignore it.
    if req.speed and req.speed != 1.0:
        body["speed"] = req.speed
    if req.extra:
        body.update(req.extra)
    blob, ctype = await client.tts_speech(body)
    ext = ext_from_ctype(ctype, "mp3")
    dst = unique_path(settings.outputs_path, slugify(req.input[:40] or req.model), ext)
    dst.write_bytes(blob)
    rel = f"outputs/{dst.name}"
    out_id = store.log_output(
        kind="tts",
        model=req.model,
        prompt=req.input,
        result={"content_type": ctype, "bytes": len(blob)},
        file_path=rel,
    )
    return {
        "id": out_id,
        "model": req.model,
        "input": req.input,
        "file": rel,
        "url": f"/files/{rel}",
        "content_type": ctype,
        "bytes": len(blob),
    }
