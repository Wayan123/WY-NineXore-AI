"""/api/embeddings — vector embeddings + convenience similarity matrix."""
from __future__ import annotations

import math
from typing import Any, Optional, Union

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..client import NineRouterClient
from ..storage.db import HistoryStore
from .deps import get_client, get_store

router = APIRouter(prefix="/api/embeddings", tags=["embeddings"])


class EmbedRequest(BaseModel):
    model: str
    input: Union[str, list[str]]
    dimensions: Optional[int] = None
    encoding_format: Optional[str] = None
    extra: dict[str, Any] = Field(default_factory=dict)


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


@router.post("/embed")
async def embed(
    req: EmbedRequest,
    client: NineRouterClient = Depends(get_client),
    store: HistoryStore = Depends(get_store),
) -> dict:
    body: dict[str, Any] = {"model": req.model, "input": req.input}
    if req.dimensions:
        body["dimensions"] = req.dimensions
    if req.encoding_format:
        body["encoding_format"] = req.encoding_format
    if req.extra:
        body.update(req.extra)

    resp = await client.embeddings(body)

    inputs: list[str] = req.input if isinstance(req.input, list) else [req.input]
    vectors = [d.get("embedding", []) for d in resp.get("data", [])]

    matrix: list[list[float]] = []
    if len(vectors) >= 2:
        for i in range(len(vectors)):
            row: list[float] = []
            for j in range(len(vectors)):
                row.append(round(_cosine(vectors[i], vectors[j]), 6))
            matrix.append(row)

    dim = len(vectors[0]) if vectors and vectors[0] else 0

    store.log_output(
        kind="embedding",
        model=req.model,
        prompt=" | ".join(s[:60] for s in inputs)[:400],
        result={
            "dimensions": dim,
            "count": len(vectors),
            "usage": resp.get("usage"),
            # keep the first vector for preview; full vectors returned below
            "sample": vectors[0][:8] if vectors else [],
        },
    )

    return {
        "model": req.model,
        "dimensions": dim,
        "count": len(vectors),
        "inputs": inputs,
        "vectors": vectors,
        "similarity": matrix,
        "usage": resp.get("usage"),
    }
