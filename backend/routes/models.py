"""/api/models — expose model listing and info from upstream 9Router."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..client import NineRouterClient
from ..idn_tts import IdnTTSClient
from .deps import get_client, get_idn_tts

router = APIRouter(prefix="/api/models", tags=["models"])

# Each capability maps to a /v1/models/<kind> path segment (empty = chat).
_VALID_KINDS = {"chat", "image", "tts", "stt", "embedding", "web", "image-to-text"}


async def _coqui_tts_entries(idn: IdnTTSClient) -> list[dict]:
    """Return synthetic model entries for each Coqui speaker (if service is up)."""
    try:
        speakers = await idn.speakers()
    except Exception:
        speakers = []
    entries: list[dict] = []
    for name in speakers:
        entries.append({
            "id": f"coqui/{name}",
            "object": "model",
            "owned_by": "coqui",
            "kind": "tts",
            "language": "id",
        })
    return entries


async def _local_whisper_entries(idn: IdnTTSClient) -> list[dict]:
    """Return the local Whisper model entry when the idn-tts service has it enabled."""
    try:
        h = await idn.health()
    except Exception:
        h = None
    w = (h or {}).get("whisper") if isinstance(h, dict) else None
    if not w or not w.get("enabled"):
        return []
    model_id = w.get("model") or "openai/whisper-large-v3"
    # expose under a stable "local/" prefix so routing picks it up
    short = model_id.split("/")[-1]  # whisper-large-v3
    return [{
        "id": f"local/{short}",
        "object": "model",
        "owned_by": "local",
        "kind": "stt",
        "upstream_model": model_id,
        "loaded": bool(w.get("loaded")),
        "loading": bool(w.get("loading")),
        "device": w.get("device"),
    }]


@router.get("")
async def list_by_kind(
    kind: str = Query(default="chat", description="chat|image|tts|stt|embedding|web|image-to-text"),
    client: NineRouterClient = Depends(get_client),
    idn: IdnTTSClient = Depends(get_idn_tts),
) -> dict:
    if kind not in _VALID_KINDS:
        raise HTTPException(400, f"invalid kind: {kind}")
    resp = await client.list_models(None if kind == "chat" else kind)
    if kind == "tts":
        resp = dict(resp)
        resp["data"] = list(resp.get("data") or []) + await _coqui_tts_entries(idn)
    elif kind == "stt":
        resp = dict(resp)
        resp["data"] = await _local_whisper_entries(idn) + list(resp.get("data") or [])
    return resp


@router.get("/info")
async def model_info(
    id: str = Query(..., description="model id"),
    client: NineRouterClient = Depends(get_client),
    idn: IdnTTSClient = Depends(get_idn_tts),
) -> dict:
    # Synthetic info for coqui voices — don't round-trip to 9Router
    if id.startswith("coqui/"):
        speaker = id.split("/", 1)[1]
        speakers = await idn.speakers()
        if speaker and speaker in speakers:
            return {
                "id": id,
                "name": f"Coqui TTS — {speaker}",
                "kind": "tts",
                "owned_by": "coqui",
                "endpoint": "/v1/audio/speech",
                "language": "id",
                "provider": "coqui (local)",
            }
        raise HTTPException(404, f"unknown coqui speaker '{speaker}'")
    if id.startswith("local/whisper"):
        try:
            h = await idn.health()
        except Exception:
            h = None
        w = (h or {}).get("whisper") if isinstance(h, dict) else None
        if not w:
            raise HTTPException(404, "local whisper not available")
        return {
            "id": id,
            "name": w.get("model", id),
            "kind": "stt",
            "owned_by": "local",
            "endpoint": "/v1/audio/transcriptions",
            "loaded": w.get("loaded"),
            "device": w.get("device"),
            "provider": "whisper (local)",
        }
    return await client.model_info(id)


@router.get("/all")
async def list_all(
    client: NineRouterClient = Depends(get_client),
    idn: IdnTTSClient = Depends(get_idn_tts),
) -> dict:
    """Convenience: fetch every kind in parallel so the UI populates in one call."""
    import asyncio

    async def safe(kind: Optional[str]) -> dict:
        try:
            return await client.list_models(kind)
        except Exception as e:
            return {
                "data": [],
                "error": {"error": {
                    "status": 0,
                    "body": {"message": str(e) or e.__class__.__name__},
                    "url": f"/v1/models{'/' + kind if kind else ''}",
                }},
            }

    kinds = [None, "image", "tts", "stt", "embedding", "web", "image-to-text"]
    results = await asyncio.gather(*[safe(k) for k in kinds])
    coqui_entries = await _coqui_tts_entries(idn)
    whisper_entries = await _local_whisper_entries(idn)

    out: dict[str, dict] = {}
    for kind, payload in zip(kinds, results):
        key = kind or "chat"
        if key == "tts" and coqui_entries:
            payload = dict(payload)
            payload["data"] = list(payload.get("data") or []) + coqui_entries
        elif key == "stt" and whisper_entries:
            payload = dict(payload)
            payload["data"] = whisper_entries + list(payload.get("data") or [])
        out[key] = payload
    return out
