"""FastAPI application entry.

Run with:  uvicorn backend.main:app --reload

Layout:

* ``/``              — the dashboard frontend (static).
* ``/files/...``     — user-generated artefacts under DATA_DIR (images/audio).
* ``/api/health``    — this app's health.
* ``/api/settings``  — public settings view (no secrets).
* ``/api/upstream``  — upstream 9Router health probe.
* ``/api/models*``   — model discovery.
* ``/api/chat*``     — chat + sessions.
* ``/api/image*``    — image generation.
* ``/api/tts*``      — text-to-speech.
* ``/api/stt*``      — speech-to-text.
* ``/api/embeddings*`` — vectors + similarity helper.
* ``/api/search*``   — web search.
* ``/api/fetch*``    — URL extraction.
* ``/api/history*``  — history CRUD.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .client import NineRouterClient, NineRouterError
from .config import Settings, get_settings
from .idn_tts import IdnTTSClient, IdnTTSError
from .routes import chat, embeddings, fetch, history, image, models, search, stt, tts, vision
from .routes.deps import get_client, get_settings_dep
from .storage.db import HistoryStore

log = logging.getLogger("9router-dashboard")

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.client = NineRouterClient(settings)
    app.state.idn_tts = IdnTTSClient(settings)
    app.state.store = HistoryStore(settings.db_path)
    log.info(
        "ready. upstream=%s data=%s idn_tts=%s",
        settings.nineroute_url, settings.data_path,
        settings.idn_tts_url if settings.idn_tts_enabled else "disabled",
    )
    try:
        yield
    finally:
        await app.state.client.aclose()
        await app.state.idn_tts.aclose()


app = FastAPI(
    title="9Router Dashboard",
    version="0.1.0",
    description=(
        "A friendly web UI over the 9Router AI gateway. Chat, images, "
        "TTS, STT, embeddings, web search & fetch — all in one tab."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local tool; loosen by design
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------- basics
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "9router-dashboard"}


@app.get("/api/settings")
def settings_view(settings: Settings = Depends(get_settings_dep)) -> dict:
    return settings.public_view()


@app.get("/api/upstream")
async def upstream(client: NineRouterClient = Depends(get_client)) -> dict:
    try:
        h = await client.health()
        return {"reachable": True, "upstream": h}
    except NineRouterError as e:
        return {"reachable": False, "error": e.to_dict()["error"]}
    except Exception as e:
        return {"reachable": False, "error": {
            "status": 0,
            "body": {"message": str(e) or e.__class__.__name__},
            "url": "/api/health",
        }}


@app.get("/api/idn-tts/status")
async def idn_tts_status(request: Request) -> dict:
    """Health + capability summary for the optional Indonesian TTS / Whisper service."""
    idn = request.app.state.idn_tts
    if not idn.enabled:
        return {"reachable": False, "enabled": False, "url": idn.base}
    h = await idn.health()
    if not h:
        return {"reachable": False, "enabled": True, "url": idn.base}
    speakers = await idn.speakers()
    default = await idn.default_speaker()
    return {
        "reachable": True,
        "enabled": True,
        "url": idn.base,
        "loaded": h.get("loaded", False),
        "device": h.get("device"),
        "sample_rate": h.get("sample_rate"),
        "n_speakers": len(speakers),
        "named_speakers": [s for s in speakers if s in {"wibowo", "ardi", "gadis"}],
        "default_speaker": default,
        "whisper": h.get("whisper") or {"enabled": False},
    }


# --------------------------------------------------------------------- routers
app.include_router(models.router)
app.include_router(chat.router)
app.include_router(image.router)
app.include_router(tts.router)
app.include_router(stt.router)
app.include_router(embeddings.router)
app.include_router(search.router)
app.include_router(fetch.router)
app.include_router(history.router)
app.include_router(vision.router)


# ---------------------------------------------------------- global error shape
@app.exception_handler(NineRouterError)
async def _nr_err(_: object, exc: NineRouterError) -> JSONResponse:
    # Match the shape documented in docs/API.md:
    # { "error": { "status": N, "body": ..., "url": "/v1/..." } }
    return JSONResponse(status_code=exc.status, content=exc.to_dict())


@app.exception_handler(IdnTTSError)
async def _idn_err(_: object, exc: IdnTTSError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=exc.to_dict())


# ----------------------------------------------------------- files + frontend
def _mount_static() -> None:
    settings = get_settings()
    # user-generated artefacts
    app.mount(
        "/files",
        StaticFiles(directory=str(settings.data_path), check_dir=False),
        name="files",
    )
    # frontend assets (served only if the folder exists)
    if (FRONTEND_DIR / "assets").exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(FRONTEND_DIR / "assets")),
            name="assets",
        )


_mount_static()


@app.get("/")
def index() -> FileResponse:
    idx = FRONTEND_DIR / "index.html"
    if not idx.exists():
        raise HTTPException(500, "frontend missing — expected at " + str(idx))
    return FileResponse(str(idx))


@app.get("/favicon.svg")
def favicon() -> FileResponse:
    fav = FRONTEND_DIR / "favicon.svg"
    if fav.exists():
        return FileResponse(str(fav), media_type="image/svg+xml")
    raise HTTPException(404)
