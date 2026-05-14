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


async def _supertonic_tts_entries(idn: IdnTTSClient) -> list[dict]:
    """Return one model entry per Supertonic voice (10 stock voices on first load,
    plus any user-supplied JSON discovered on disk after warm-up).
    """
    try:
        catalog = await idn.supertonic_voices()
    except Exception:
        catalog = {}
    if not catalog or not catalog.get("enabled"):
        return []
    voices = catalog.get("voices") or []
    languages = []  # filled below from /supertonic/languages
    try:
        lang_resp = await idn.supertonic_languages()
        languages = [l.get("code") for l in (lang_resp.get("languages") or []) if l.get("code")]
    except Exception:
        languages = []
    loaded = bool(catalog.get("loaded"))
    loading = bool(catalog.get("loading"))
    error = catalog.get("error")
    device = catalog.get("device")
    voices_source = catalog.get("voices_source", "default")
    entries: list[dict] = []
    for v in voices:
        name = v.get("name")
        if not name:
            continue
        entries.append({
            "id": f"supertonic/{name}",
            "object": "model",
            "owned_by": "local",
            "kind": "tts",
            "provider": "supertonic (local)",
            "voice_family": v.get("family", "custom"),
            "voice_source": voices_source,
            "languages": languages,
            "default_language": "en",
            "sample_rate": catalog.get("sample_rate", 24000),
            "size_gb": 0.26,
            "loaded": loaded,
            "loading": loading,
            "error": error,
            "device": device,
        })
    return entries


async def _local_whisper_entries(idn: IdnTTSClient) -> list[dict]:
    """Return one model entry per Whisper variant exposed by the local service."""
    try:
        catalog = await idn.whisper_variants()
    except Exception:
        catalog = {}
    if not catalog or not catalog.get("enabled"):
        return []
    variants = catalog.get("variants") or {}
    entries: list[dict] = []
    for name, info in variants.items():
        entries.append({
            "id": f"local/whisper-{name}",
            "object": "model",
            "owned_by": "local",
            "kind": "stt",
            "upstream_model": info.get("model", ""),
            "loaded": bool(info.get("loaded")),
            "loading": bool(info.get("loading")),
            "error": info.get("error"),
            "device": info.get("device"),
            "size_gb": info.get("size_gb"),
            "params_m": info.get("params_m"),
            "notes": info.get("notes"),
        })
    # Stable order: tiny (lightest) → medium → large-v3
    order = {"tiny": 0, "medium": 1, "large-v3": 2}
    entries.sort(key=lambda m: order.get(m["id"].split("-", 1)[-1], 99))
    return entries


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
        resp["data"] = (
            await _supertonic_tts_entries(idn)
            + await _coqui_tts_entries(idn)
            + list(resp.get("data") or [])
        )
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
            catalog = await idn.whisper_variants()
        except Exception:
            catalog = {}
        if not catalog or not catalog.get("enabled"):
            raise HTTPException(404, "local whisper not available")
        # Parse variant from the tail: local/whisper-<variant>
        suffix = id[len("local/whisper"):].lstrip("-")
        variants = catalog.get("variants") or {}
        info = variants.get(suffix) if suffix else None
        if not info:
            # Fall back to the default variant for bare ``local/whisper``
            default_name = catalog.get("default") or next(iter(variants.keys()), "")
            info = variants.get(default_name) or {}
            suffix = default_name
        return {
            "id": id,
            "name": info.get("model", id),
            "kind": "stt",
            "owned_by": "local",
            "endpoint": "/v1/audio/transcriptions",
            "variant": suffix,
            "size_gb": info.get("size_gb"),
            "params_m": info.get("params_m"),
            "notes": info.get("notes"),
            "loaded": info.get("loaded"),
            "loading": info.get("loading"),
            "error": info.get("error"),
            "device": info.get("device"),
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
    supertonic_entries = await _supertonic_tts_entries(idn)
    whisper_entries = await _local_whisper_entries(idn)

    out: dict[str, dict] = {}
    for kind, payload in zip(kinds, results):
        key = kind or "chat"
        if key == "tts" and (coqui_entries or supertonic_entries):
            payload = dict(payload)
            # Same ordering as list_by_kind: supertonic → coqui → upstream.
            payload["data"] = (
                supertonic_entries
                + coqui_entries
                + list(payload.get("data") or [])
            )
        elif key == "stt" and whisper_entries:
            payload = dict(payload)
            payload["data"] = whisper_entries + list(payload.get("data") or [])
        out[key] = payload
    return out
