"""/api/stt — audio upload → transcript.

Routes by model prefix:
* ``local/whisper-*`` → local Whisper via the idn-tts service
* everything else     → 9Router upstream
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..client import NineRouterClient
from ..idn_tts import IdnTTSClient, IdnTTSError, is_local_whisper_model, whisper_variant_from_model
from ..storage.db import HistoryStore
from .deps import get_client, get_idn_tts, get_store

router = APIRouter(prefix="/api/stt", tags=["stt"])


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(...),
    language: Optional[str] = Form(default=None),
    prompt: Optional[str] = Form(default=None),
    response_format: Optional[str] = Form(default=None),
    temperature: Optional[float] = Form(default=None),
    client: NineRouterClient = Depends(get_client),
    idn: IdnTTSClient = Depends(get_idn_tts),
    store: HistoryStore = Depends(get_store),
) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty upload")
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(413, f"file too large ({len(raw)} bytes; cap 200 MB)")

    # --- local Whisper branch ---------------------------------------------
    if is_local_whisper_model(model):
        if not idn.enabled:
            raise HTTPException(503, "Indonesian TTS / Whisper service disabled.")
        if not await idn.whisper_is_reachable():
            raise HTTPException(
                503,
                f"Local Whisper unreachable at {idn.base}. Check /tmp/wy-nine-idn-tts.log and restart ./run.sh.",
            )
        try:
            result = await idn.whisper_transcribe(
                raw,
                filename=file.filename or "audio",
                language=language,
                task="transcribe",
                return_segments=(response_format == "verbose_json"),
                variant=whisper_variant_from_model(model),
            )
        except IdnTTSError:
            raise

        # result is our own shape: {model, text, language, duration, segments}
        summary = result.get("text", "") or ""
        store.log_output(
            kind="stt",
            model=model,
            prompt=f"[file: {file.filename}, {len(raw)} bytes]",
            result={"result": result, "language": language, "format": response_format,
                    "provider": "local-whisper"},
        )
        return {
            "model": model,
            "filename": file.filename,
            "bytes": len(raw),
            "result": result,
            "preview": summary[:400],
        }

    # --- upstream 9Router branch ------------------------------------------
    result = await client.stt_transcribe(
        raw,
        filename=file.filename or "audio.mp3",
        model=model,
        language=language,
        prompt=prompt,
        response_format=response_format,
        temperature=temperature,
    )

    # Normalise: result may be dict (json/verbose_json) or str (text/srt/vtt)
    summary: str = ""
    if isinstance(result, dict):
        summary = result.get("text", "") or ""
    elif isinstance(result, str):
        summary = result[:400]

    store.log_output(
        kind="stt",
        model=model,
        prompt=f"[file: {file.filename}, {len(raw)} bytes]",
        result={"result": result, "language": language, "format": response_format},
    )
    return {
        "model": model,
        "filename": file.filename,
        "bytes": len(raw),
        "result": result,
        "preview": summary,
    }
