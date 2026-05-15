"""/api/video — short-video pipeline (script → image → TTS → ffmpeg compose).

Long-running by design: every request that starts a job returns
immediately with the job id, then the client polls
``GET /api/video/status/{id}`` until ``state == "done"`` or
``"failed"``.

Mirrors the Pixelle-Video flow but uses our existing primitives
(NineRouterClient for chat / image / TTS, IdnTTSClient for the local
Coqui + Supertonic services, ffmpeg for composition).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..client import NineRouterClient
from ..config import Settings
from ..idn_tts import IdnTTSClient
from ..pipelines import (
    ASPECT_PRESETS,
    DEFAULT_ASPECT,
    is_ffmpeg_available,
)
from ..pipelines.video import (
    VideoJob,
    VideoJobStore,
    new_job_id,
    run_video_job,
)
from ..storage.db import HistoryStore
from .deps import get_client, get_idn_tts, get_settings_dep, get_store

router = APIRouter(prefix="/api/video", tags=["video"])


class VideoGenerateRequest(BaseModel):
    topic: str = Field(..., min_length=2, max_length=400,
                       description="What the video is about.")
    scene_count: int = Field(default=5, ge=2, le=10)
    aspect: str = Field(default=DEFAULT_ASPECT,
                        description="One of " + ", ".join(ASPECT_PRESETS.keys()))
    chat_model: str = Field(..., description="LLM that writes the script.")
    image_model: str = Field(..., description="Image model (e.g. dalle-3, flux-schnell).")
    tts_model: str = Field(..., description="TTS model: coqui/<name>, supertonic/<voice>, or upstream id.")
    voice: str = Field(default="", description="Voice id for upstream TTS providers.")
    language: str = Field(default="id", description="ISO-639-1 code for narration language.")
    style_prefix: str = Field(default="", description="Optional image style prefix (English).")


def get_job_store(request: Request) -> VideoJobStore:
    return request.app.state.video_jobs  # type: ignore[no-any-return]


@router.get("/capabilities")
def capabilities(settings: Settings = Depends(get_settings_dep)) -> dict[str, Any]:
    """Pre-flight check the UI hits before showing the panel."""
    return {
        "ffmpeg": is_ffmpeg_available(),
        "aspects": list(ASPECT_PRESETS.keys()),
        "default_aspect": DEFAULT_ASPECT,
        "scene_min": 2,
        "scene_max": 10,
        "default_scenes": 5,
        "outputs_dir": str(settings.outputs_path),
    }


@router.post("/generate")
async def generate(
    req: VideoGenerateRequest,
    background_tasks: BackgroundTasks,
    client: NineRouterClient = Depends(get_client),
    idn: IdnTTSClient = Depends(get_idn_tts),
    settings: Settings = Depends(get_settings_dep),
    store: HistoryStore = Depends(get_store),
    jobs: VideoJobStore = Depends(get_job_store),
) -> dict[str, Any]:
    if not is_ffmpeg_available():
        raise HTTPException(
            503,
            "ffmpeg is not installed. Install with 'sudo apt install ffmpeg' or 'brew install ffmpeg'.",
        )
    if req.aspect not in ASPECT_PRESETS:
        raise HTTPException(400, f"aspect must be one of {list(ASPECT_PRESETS.keys())}")

    job = VideoJob(
        id=new_job_id(),
        topic=req.topic.strip(),
        scene_count=req.scene_count,
        aspect=req.aspect,
        chat_model=req.chat_model,
        image_model=req.image_model,
        tts_model=req.tts_model,
        voice=req.voice,
        language=req.language,
        style_prefix=req.style_prefix.strip(),
    )
    await jobs.add(job)

    background_tasks.add_task(
        run_video_job,
        job,
        client=client, idn=idn, settings=settings,
        store=store, job_store=jobs,
    )
    return {"job_id": job.id, "state": job.state, "message": "Job queued."}


@router.get("/status/{job_id}")
def status(job_id: str, jobs: VideoJobStore = Depends(get_job_store)) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"video job {job_id} not found")
    return job.to_dict()


@router.get("/jobs")
def list_jobs(jobs: VideoJobStore = Depends(get_job_store)) -> dict[str, Any]:
    return {"jobs": [j.to_dict() for j in jobs.list(limit=50)]}


# Wire-up helper for backend/main.py.
def install(app, settings: Settings) -> None:
    """Install the per-process VideoJobStore onto the FastAPI app."""
    work_root = settings.data_path / "video"
    work_root.mkdir(parents=True, exist_ok=True)
    app.state.video_jobs = VideoJobStore(work_root)
