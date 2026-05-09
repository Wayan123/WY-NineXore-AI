"""/api/search — web search proxy."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..client import NineRouterClient
from ..storage.db import HistoryStore
from .deps import get_client, get_store

router = APIRouter(prefix="/api/search", tags=["search"])


class SearchRequest(BaseModel):
    model: str
    query: str
    max_results: Optional[int] = 5
    search_type: Optional[str] = None  # web | news
    country: Optional[str] = None
    language: Optional[str] = None
    time_range: Optional[str] = None
    domain_filter: Optional[list[str] | str] = None
    extra: dict[str, Any] = Field(default_factory=dict)


@router.post("/run")
async def run(
    req: SearchRequest,
    client: NineRouterClient = Depends(get_client),
    store: HistoryStore = Depends(get_store),
) -> dict:
    body: dict[str, Any] = {"model": req.model, "query": req.query}
    for k in ("max_results", "search_type", "country", "language",
              "time_range", "domain_filter"):
        v = getattr(req, k)
        if v is not None and v != "" and v != []:
            body[k] = v
    if req.extra:
        body.update(req.extra)

    resp = await client.web_search(body)

    store.log_output(
        kind="search",
        model=req.model,
        prompt=req.query,
        result={"provider": resp.get("provider"),
                "n_results": len(resp.get("results") or []),
                "answer": resp.get("answer")},
    )
    return resp
