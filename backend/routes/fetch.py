"""/api/fetch — URL → markdown/text/html proxy."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..client import NineRouterClient
from ..storage.db import HistoryStore
from .deps import get_client, get_store

router = APIRouter(prefix="/api/fetch", tags=["fetch"])


class FetchRequest(BaseModel):
    model: str
    url: str
    format: Optional[str] = "markdown"
    max_characters: Optional[int] = None
    extra: dict[str, Any] = Field(default_factory=dict)


@router.post("/run")
async def run(
    req: FetchRequest,
    client: NineRouterClient = Depends(get_client),
    store: HistoryStore = Depends(get_store),
) -> dict:
    body: dict[str, Any] = {"model": req.model, "url": req.url}
    if req.format:
        body["format"] = req.format
    if req.max_characters:
        body["max_characters"] = req.max_characters
    if req.extra:
        body.update(req.extra)

    resp = await client.web_fetch(body)

    content = (resp.get("content") or {})
    store.log_output(
        kind="fetch",
        model=req.model,
        prompt=req.url,
        result={
            "provider": resp.get("provider"),
            "title": resp.get("title"),
            "length": content.get("length"),
            "format": content.get("format"),
        },
    )
    return resp
