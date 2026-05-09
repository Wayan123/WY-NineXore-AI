"""Small helpers shared across routes."""
from __future__ import annotations

import re
import time
from pathlib import Path


_slug_re = re.compile(r"[^a-zA-Z0-9._-]+")


def slugify(text: str, max_len: int = 40) -> str:
    """Make a filesystem-safe slug from arbitrary user text."""
    text = text.strip() or "untitled"
    text = _slug_re.sub("-", text).strip("-_.")
    return text[:max_len] or "untitled"


def unique_path(folder: Path, slug: str, ext: str) -> Path:
    """Return a non-clobbering path inside *folder* like ``20260508-153012_slug.ext``."""
    folder.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    base = f"{ts}_{slug}".strip("-_.")
    candidate = folder / f"{base}.{ext}"
    n = 1
    while candidate.exists():
        candidate = folder / f"{base}-{n}.{ext}"
        n += 1
    return candidate


def first_id(models_resp: dict) -> str:
    """Return the first ``data[].id`` or ``""`` from a /v1/models response."""
    try:
        data = models_resp.get("data") or []
        if data:
            return str(data[0].get("id") or "")
    except Exception:
        pass
    return ""


def ext_from_ctype(ctype: str, fallback: str = "bin") -> str:
    ctype = (ctype or "").split(";")[0].strip().lower()
    table = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "audio/flac": "flac",
        "audio/mp4": "m4a",
        "audio/aac": "aac",
    }
    return table.get(ctype, fallback)
