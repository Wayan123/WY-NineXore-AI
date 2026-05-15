"""Video job orchestrator — turns a single topic into a short narrated
video using the existing 9Router primitives plus ffmpeg.

Pipeline (mirrors Pixelle-Video, adapted to our stack):

   topic + style + scene_count + aspect ratio + voice + lang
       │
       ▼
   1. LLM       → list of {narration, image_prompt} per scene
   2. images    → one PNG per scene from /v1/images/generations
   3. TTS       → one WAV per scene (Supertonic / Coqui / upstream voice)
   4. ffmpeg    → loop image + audio per scene, then concat all
       │
       ▼
   data/outputs/{ts}_{slug}.mp4   (+ history entry, kind="video")

Long-running. The HTTP route starts a job and returns immediately; the
orchestrator runs as a BackgroundTask and updates a per-job state file
+ in-memory dict that the polling endpoint reads.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from ..client import NineRouterClient
from ..config import Settings
from ..idn_tts import (
    IdnTTSClient,
    IdnTTSError,
    coqui_speaker_from_model,
    is_coqui_model,
    is_supertonic_model,
    supertonic_voice_from_model,
)
from ..storage.db import HistoryStore
from ..utils import slugify, unique_path
from .ffmpeg import (
    DEFAULT_ASPECT,
    FfmpegError,
    compose_scene_clip,
    concat_clips,
    resolve_aspect,
)

logger = logging.getLogger("video.pipeline")


# ---------- job model ------------------------------------------------------

JOB_STATES = (
    "pending",
    "writing_script",
    "generating_images",
    "synthesizing_voices",
    "composing_video",
    "done",
    "failed",
    "cancelled",
)


@dataclass
class Scene:
    index: int
    narration: str = ""
    image_prompt: str = ""
    image_path: Optional[str] = None     # data/video/<id>/scenes/01.png
    audio_path: Optional[str] = None     # data/video/<id>/scenes/01.wav
    clip_path: Optional[str] = None      # data/video/<id>/scenes/01.mp4
    image_done: bool = False
    audio_done: bool = False
    clip_done: bool = False


@dataclass
class VideoJob:
    id: str
    topic: str
    scene_count: int
    aspect: str
    chat_model: str
    image_model: str
    tts_model: str
    voice: str
    language: str  # 'id' / 'en' / etc — used for narration + Supertonic
    style_prefix: str = ""
    state: str = "pending"
    progress: float = 0.0
    message: str = ""
    error: Optional[str] = None
    scenes: list[Scene] = field(default_factory=list)
    output_file: Optional[str] = None    # data/outputs/<ts>_<slug>.mp4
    output_id: Optional[int] = None      # history row id
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


# ---------- in-memory + on-disk job store ----------------------------------

class VideoJobStore:
    """Process-local job registry. Each job also has a state.json file
    in its work folder so a dashboard restart can recover it.
    """

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, VideoJob] = {}
        self._lock = asyncio.Lock()
        self._load_existing()

    def work_dir(self, job_id: str) -> Path:
        return self.root / job_id

    def _state_file(self, job_id: str) -> Path:
        return self.work_dir(job_id) / "job.json"

    def _load_existing(self) -> None:
        if not self.root.is_dir():
            return
        for d in self.root.iterdir():
            if not d.is_dir():
                continue
            sf = d / "job.json"
            if not sf.is_file():
                continue
            try:
                raw = json.loads(sf.read_text(encoding="utf-8"))
                scenes = [Scene(**s) for s in raw.pop("scenes", [])]
                job = VideoJob(scenes=scenes, **raw)
                self._jobs[job.id] = job
            except Exception:
                logger.warning("could not load video job state at %s", sf)

    async def add(self, job: VideoJob) -> None:
        async with self._lock:
            self._jobs[job.id] = job
            self._persist(job)

    async def update(self, job: VideoJob) -> None:
        async with self._lock:
            self._jobs[job.id] = job
            self._persist(job)

    def get(self, job_id: str) -> Optional[VideoJob]:
        return self._jobs.get(job_id)

    def list(self, *, limit: int = 50) -> list[VideoJob]:
        rows = sorted(
            self._jobs.values(),
            key=lambda j: j.created_at,
            reverse=True,
        )
        return rows[:limit]

    def _persist(self, job: VideoJob) -> None:
        try:
            d = self.work_dir(job.id)
            d.mkdir(parents=True, exist_ok=True)
            self._state_file(job.id).write_text(
                json.dumps(job.to_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning("could not persist job %s: %s", job.id, e)


# ---------- the orchestrator ----------------------------------------------

# Brief, instruction-style prompts. We ask for strict JSON because the
# downstream parser is dumb on purpose — easier to debug bad model
# behaviour by reading raw text than chasing a clever wrapper bug.
_SCRIPT_PROMPT_EN = """You are writing a short narrated video. Output ONLY a JSON array,
no prose, no markdown fences. The array must have EXACTLY {n} objects.
Each object: {{"narration": <one short sentence to speak aloud>,
"image_prompt": <visual description for an AI image generator, ENGLISH only,
descriptive, 12-25 words, NO text, NO captions>}}.

Topic: {topic}
Tone / style: {style}

Constraints:
- Narration in {lang_label}.
- Each narration is 1 sentence, 8-22 words, conversational.
- Each image_prompt is in English even when narration is not.
- Image prompts must NOT contain captions or any rendered text.
- The story flows: scene 1 hooks, scene {n} resolves.
"""

_SCRIPT_PROMPT_ID = """Tugas Anda menulis naskah video pendek bernarasi. Keluarkan HANYA
JSON array, tanpa prosa, tanpa markdown. Array harus berisi PERSIS {n} objek.
Tiap objek: {{"narration": <satu kalimat singkat untuk diucapkan>,
"image_prompt": <deskripsi visual untuk AI image generator,
HARUS BAHASA INGGRIS, deskriptif, 12-25 kata, JANGAN ada teks/caption>}}.

Topik: {topic}
Gaya / nada: {style}

Aturan:
- Narasi dalam Bahasa {lang_label}.
- Tiap narasi 1 kalimat, 8-22 kata, gaya percakapan.
- image_prompt tetap Bahasa Inggris meski narasi bahasa lain.
- image_prompt TIDAK boleh berisi caption / teks tertulis.
- Alur cerita: scene 1 menarik perhatian, scene {n} memberi penutup.
"""

_LANG_LABELS = {
    "id": ("Indonesian", "Indonesia"),
    "en": ("English", "Inggris"),
    "ja": ("Japanese", "Jepang"),
    "ko": ("Korean", "Korea"),
    "fr": ("French", "Prancis"),
    "de": ("German", "Jerman"),
    "es": ("Spanish", "Spanyol"),
    "vi": ("Vietnamese", "Vietnam"),
}


def _strip_json_fences(s: str) -> str:
    """LLMs love wrapping JSON in ```json … ``` even when told not to."""
    s = s.strip()
    if s.startswith("```"):
        # remove first fence line and last fence line
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


async def _generate_script(
    client: NineRouterClient,
    model: str,
    topic: str,
    scene_count: int,
    language: str,
    style: str,
) -> list[Scene]:
    label_en, label_id = _LANG_LABELS.get(language, (language.upper(), language.upper()))
    if language == "id":
        prompt = _SCRIPT_PROMPT_ID.format(
            n=scene_count, topic=topic, style=style or "natural, informative",
            lang_label=label_id,
        )
    else:
        prompt = _SCRIPT_PROMPT_EN.format(
            n=scene_count, topic=topic, style=style or "natural, informative",
            lang_label=label_en,
        )

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You produce strict JSON when asked. No prose."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 1400,
    }
    resp = await client.chat_completion(body)
    content = (
        (resp.get("choices") or [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    if not content:
        raise RuntimeError("LLM returned empty content for script generation.")

    raw = _strip_json_fences(content)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        # try to salvage: find the first '[' and last ']'
        i = raw.find("[")
        j = raw.rfind("]")
        if i >= 0 and j > i:
            try:
                data = json.loads(raw[i : j + 1])
            except json.JSONDecodeError:
                raise RuntimeError(f"LLM did not return valid JSON: {e}; got: {raw[:240]}") from e
        else:
            raise RuntimeError(f"LLM did not return JSON: {raw[:240]}") from e

    if not isinstance(data, list) or not data:
        raise RuntimeError(f"LLM script must be a non-empty JSON array; got: {type(data).__name__}")

    scenes: list[Scene] = []
    for i, item in enumerate(data[:scene_count], start=1):
        narration = (item or {}).get("narration", "").strip()
        image_prompt = (item or {}).get("image_prompt", "").strip()
        if not narration or not image_prompt:
            raise RuntimeError(f"Scene {i} from LLM is missing narration or image_prompt.")
        scenes.append(Scene(index=i, narration=narration, image_prompt=image_prompt))
    if len(scenes) < scene_count:
        raise RuntimeError(
            f"LLM returned {len(scenes)} scenes; expected {scene_count}. Re-run with a different model."
        )
    return scenes


def _aspect_to_size_str(aspect: str) -> str:
    w, h = resolve_aspect(aspect)
    return f"{w}x{h}"


async def _generate_image(
    client: NineRouterClient,
    image_model: str,
    prompt: str,
    aspect: str,
    style_prefix: str,
    out_path: Path,
) -> None:
    """Generate one PNG. Saves the first returned image."""
    import base64

    body: dict[str, Any] = {
        "model": image_model,
        "prompt": (style_prefix + " " + prompt).strip() if style_prefix else prompt,
        "size": _aspect_to_size_str(aspect),
        "response_format": "b64_json",
        "n": 1,
    }
    resp = await client.images_generate(body)
    arr = resp.get("data") or []
    if not arr:
        raise RuntimeError(f"Image generator returned no data: {resp}")
    first = arr[0]
    b64 = first.get("b64_json")
    if not b64:
        # some providers only return URLs
        url = first.get("url")
        if not url:
            raise RuntimeError(f"Image item has neither b64_json nor url: {first}")
        async with client._client.stream("GET", url) as r:  # type: ignore[attr-defined]
            r.raise_for_status()
            blob = await r.aread()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(blob)
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(base64.b64decode(b64))


async def _synthesize_voice(
    client: NineRouterClient,
    idn: IdnTTSClient,
    settings: Settings,
    *,
    text: str,
    tts_model: str,
    voice: str,
    language: str,
    out_path: Path,
) -> None:
    """Pick the right TTS branch based on the requested model.

    Same routing as backend/routes/tts.py, abridged. Always writes a wav
    even when the upstream returned mp3 (we let ffmpeg deal with it on
    compose).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Local Coqui (Indonesian)
    if is_coqui_model(tts_model) or is_coqui_model(voice):
        speaker = ""
        if is_coqui_model(voice):
            speaker = coqui_speaker_from_model(voice)
        elif is_coqui_model(tts_model):
            speaker = coqui_speaker_from_model(tts_model)
        if not speaker:
            raise RuntimeError("Coqui voice missing: e.g. coqui/wibowo")
        if not idn.enabled or not await idn.is_reachable():
            raise RuntimeError(
                "Indonesian TTS service unreachable; restart ./run.sh and verify "
                "/api/idn-tts/status before generating video."
            )
        blob, _ctype = await idn.speak(text, speaker, speed=1.05)
        out_path.write_bytes(blob)
        return

    # Local Supertonic (on-device)
    if is_supertonic_model(tts_model) or is_supertonic_model(voice):
        v = ""
        if is_supertonic_model(voice):
            v = supertonic_voice_from_model(voice)
        elif is_supertonic_model(tts_model):
            v = supertonic_voice_from_model(tts_model)
        if not idn.enabled or not await idn.is_reachable():
            raise RuntimeError("Supertonic requires the local idn-tts service.")
        blob, _ctype = await idn.supertonic_speak(text, voice=v, language=language, speed=1.05)
        out_path.write_bytes(blob)
        return

    # Upstream (OpenAI / Edge / NVIDIA / etc — anything 9Router exposes)
    body: dict[str, Any] = {
        "model": tts_model,
        "input": text,
        "voice": voice or "alloy",
        "response_format": "wav",
    }
    blob, _ctype = await client.tts_speech(body)
    out_path.write_bytes(blob)


# ---------- the actual orchestration --------------------------------------

async def run_video_job(
    job: VideoJob,
    *,
    client: NineRouterClient,
    idn: IdnTTSClient,
    settings: Settings,
    store: HistoryStore,
    job_store: VideoJobStore,
) -> None:
    """Drive a video job to completion. Updates state at every step.

    Failures are caught and recorded on the job so the polling endpoint
    can surface them; nothing is raised out of this function.
    """
    work_dir = job_store.work_dir(job.id)
    scenes_dir = work_dir / "scenes"
    scenes_dir.mkdir(parents=True, exist_ok=True)

    job.started_at = time.time()
    job.state = "writing_script"
    job.message = "Writing script…"
    job.progress = 0.05
    await job_store.update(job)

    try:
        # ------------------------------------------------------------- 1. Script
        scenes = await _generate_script(
            client=client,
            model=job.chat_model,
            topic=job.topic,
            scene_count=job.scene_count,
            language=job.language,
            style="",
        )
        job.scenes = scenes

        # ------------------------------------------------------------- 2. Images
        job.state = "generating_images"
        for i, sc in enumerate(scenes, start=1):
            job.message = f"Generating image {i}/{len(scenes)}…"
            job.progress = 0.05 + 0.4 * (i - 1) / len(scenes)
            await job_store.update(job)
            img_path = scenes_dir / f"{i:02d}.png"
            await _generate_image(
                client=client,
                image_model=job.image_model,
                prompt=sc.image_prompt,
                aspect=job.aspect,
                style_prefix=job.style_prefix,
                out_path=img_path,
            )
            sc.image_path = str(img_path)
            sc.image_done = True
            await job_store.update(job)

        # ------------------------------------------------------------- 3. Voices
        job.state = "synthesizing_voices"
        for i, sc in enumerate(scenes, start=1):
            job.message = f"Synthesizing voice {i}/{len(scenes)}…"
            job.progress = 0.45 + 0.3 * (i - 1) / len(scenes)
            await job_store.update(job)
            audio_path = scenes_dir / f"{i:02d}.wav"
            await _synthesize_voice(
                client=client, idn=idn, settings=settings,
                text=sc.narration, tts_model=job.tts_model, voice=job.voice,
                language=job.language, out_path=audio_path,
            )
            sc.audio_path = str(audio_path)
            sc.audio_done = True
            await job_store.update(job)

        # ------------------------------------------------------------- 4. Compose
        job.state = "composing_video"
        w, h = resolve_aspect(job.aspect)
        clips: list[Path] = []
        for i, sc in enumerate(scenes, start=1):
            job.message = f"Composing scene {i}/{len(scenes)}…"
            job.progress = 0.75 + 0.2 * (i - 1) / len(scenes)
            await job_store.update(job)
            clip_path = scenes_dir / f"{i:02d}.mp4"
            await asyncio.to_thread(
                compose_scene_clip,
                Path(sc.image_path or ""),
                Path(sc.audio_path or ""),
                clip_path,
                width=w,
                height=h,
            )
            sc.clip_path = str(clip_path)
            sc.clip_done = True
            clips.append(clip_path)
            await job_store.update(job)

        job.message = "Concatenating final video…"
        job.progress = 0.95
        await job_store.update(job)

        slug = slugify(job.topic[:40] or job.id)
        final_dst = unique_path(settings.outputs_path, slug, "mp4")
        await asyncio.to_thread(concat_clips, clips, final_dst)
        rel = f"outputs/{final_dst.name}"

        # Save to history so it shows up in the History panel.
        out_id = store.log_output(
            kind="video",
            model=f"{job.chat_model}+{job.image_model}+{job.tts_model}",
            prompt=job.topic,
            result={
                "scenes": len(scenes),
                "aspect": job.aspect,
                "voice": job.voice,
                "language": job.language,
                "bytes": final_dst.stat().st_size,
            },
            file_path=rel,
        )
        job.output_file = rel
        job.output_id = out_id
        job.state = "done"
        job.message = "Video ready."
        job.progress = 1.0
        job.finished_at = time.time()
        await job_store.update(job)

    except FfmpegError as e:
        job.state = "failed"
        job.error = f"ffmpeg: {e}"
        job.message = "Composition failed."
        job.finished_at = time.time()
        await job_store.update(job)
    except IdnTTSError as e:
        job.state = "failed"
        job.error = f"tts: {e}"
        job.message = "Voice synthesis failed."
        job.finished_at = time.time()
        await job_store.update(job)
    except Exception as e:
        logger.exception("video job %s failed", job.id)
        job.state = "failed"
        job.error = str(e) or e.__class__.__name__
        job.message = "Job failed — see error."
        job.finished_at = time.time()
        await job_store.update(job)


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]
