"""FastAPI dependency helpers — fetch shared resources from app state."""
from __future__ import annotations

from fastapi import Request

from ..client import NineRouterClient
from ..config import Settings
from ..idn_tts import IdnTTSClient
from ..storage.db import HistoryStore


def get_client(request: Request) -> NineRouterClient:
    return request.app.state.client  # type: ignore[no-any-return]


def get_store(request: Request) -> HistoryStore:
    return request.app.state.store  # type: ignore[no-any-return]


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]


def get_idn_tts(request: Request) -> IdnTTSClient:
    return request.app.state.idn_tts  # type: ignore[no-any-return]
