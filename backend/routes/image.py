"""/api/image — image generation with on-disk caching."""
from __future__ import annotations

import base64
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..client import NineRouterClient
from ..config import Settings, get_settings
from ..storage.db import HistoryStore
from ..utils import ext_from_ctype, slugify, unique_path
from .deps import get_client, get_settings_dep, get_store

router = APIRouter(prefix="/api/image", tags=["image"])


class ImageRequest(BaseModel):
    model: str
    prompt: str
    n: Optional[int] = None
    size: Optional[str] = None
    quality: Optional[str] = None
    style: Optional[str] = None
    extra: dict[str, Any] = Field(default_factory=dict)


def _build_body(req: ImageRequest) -> dict:
    body: dict[str, Any] = {"model": req.model, "prompt": req.prompt}
    for k in ("n", "size", "quality", "style"):
        v = getattr(req, k)
        if v is not None and v != "":
            body[k] = v
    if req.extra:
        body.update(req.extra)
    return body


@router.post("/generate")
async def generate(
    req: ImageRequest,
    client: NineRouterClient = Depends(get_client),
    settings: Settings = Depends(get_settings_dep),
    store: HistoryStore = Depends(get_store),
) -> dict:
    """Generate image(s) and save every returned image to DATA_DIR/outputs.

    Always returns b64_json by asking upstream for ``response_format=b64_json``.
    If upstream returns URLs instead, we also download them so the UI can show
    them after 9Router's short-lived signed URLs expire.
    """
    body = _build_body(req)
    body["response_format"] = body.get("response_format", "b64_json")

    resp = await client.images_generate(body)

    data_arr = resp.get("data") or []
    saved: list[dict] = []

    async with httpx.AsyncClient(timeout=60.0) as dlr:
        for i, item in enumerate(data_arr):
            blob: Optional[bytes] = None
            ctype = "image/png"
            if item.get("b64_json"):
                try:
                    blob = base64.b64decode(item["b64_json"])
                except Exception:
                    blob = None
            elif item.get("url"):
                try:
                    r = await dlr.get(item["url"])
                    if r.status_code < 400:
                        blob = r.content
                        ctype = r.headers.get("content-type", ctype)
                except Exception:
                    pass

            if not blob:
                saved.append({"error": "empty image payload", "raw": item})
                continue

            ext = ext_from_ctype(ctype, "png")
            slug = slugify(req.prompt)
            suffix = f"{slug}-{i+1}" if len(data_arr) > 1 else slug
            dst = unique_path(settings.outputs_path, suffix, ext)
            dst.write_bytes(blob)
            saved.append({
                "file": f"outputs/{dst.name}",
                "url": f"/files/outputs/{dst.name}",
                "bytes": len(blob),
                "content_type": ctype,
                "revised_prompt": item.get("revised_prompt"),
            })

    out_id = store.log_output(
        kind="image",
        model=req.model,
        prompt=req.prompt,
        result={"saved": saved, "upstream_raw": {k: v for k, v in resp.items() if k != "data"}},
        file_path=saved[0]["file"] if saved and "file" in saved[0] else "",
    )
    return {
        "id": out_id,
        "model": req.model,
        "prompt": req.prompt,
        "images": saved,
        "created": resp.get("created"),
    }
