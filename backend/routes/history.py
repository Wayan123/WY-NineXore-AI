"""/api/history — list/delete past outputs + stats."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ..config import Settings
from ..storage.db import HistoryStore
from .deps import get_settings_dep, get_store

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("/outputs")
def list_outputs(
    kind: Optional[str] = Query(default=None),
    favorite: bool = Query(default=False),
    limit: int = Query(default=100, le=500),
    store: HistoryStore = Depends(get_store),
) -> list[dict]:
    return store.list_outputs(kind=kind, limit=limit, favorite_only=favorite)


@router.patch("/outputs/{out_id}")
def patch_output(
    out_id: int,
    body: dict = Body(...),
    store: HistoryStore = Depends(get_store),
) -> dict:
    if "favorite" in body:
        store.favorite_output(out_id, bool(body["favorite"]))
    return {"ok": True}


@router.delete("/outputs/{out_id}")
def delete_output(
    out_id: int,
    store: HistoryStore = Depends(get_store),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    rel = store.delete_output(out_id)
    if rel:
        # rel looks like "outputs/<name>"; unlink only inside DATA_DIR
        try:
            target = (settings.data_path / rel).resolve()
            if target.exists() and settings.data_path in target.parents:
                target.unlink()
        except Exception:
            pass
    return {"ok": True}


@router.get("/stats")
def stats(store: HistoryStore = Depends(get_store)) -> dict:
    return store.stats()
