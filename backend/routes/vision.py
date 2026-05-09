"""/api/vision — image → text via multimodal chat models.

Accepts a multipart upload (image) plus a prompt and model id, wraps them
into an OpenAI-compatible ``/v1/chat/completions`` body with an ``image_url``
content block, forwards to 9Router, and persists the result in the
``vision`` output kind.

Typical use: OCR of Indonesian documents with ``cx/gpt-5.4``.
"""
from __future__ import annotations

import base64
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..client import NineRouterClient
from ..storage.db import HistoryStore
from .deps import get_client, get_store

router = APIRouter(prefix="/api/vision", tags=["vision"])

# Default prompts the UI exposes as one-click chips.
DEFAULT_PROMPTS = {
    "ocr": (
        "Baca semua teks pada gambar ini dan tulis ulang persis apa adanya. "
        "Pertahankan baris dan tanda baca. Jangan tambahkan komentar."
    ),
    "ocr-en": (
        "Transcribe every piece of text in this image exactly as it appears. "
        "Preserve line breaks and punctuation. Do not add commentary."
    ),
    "describe": (
        "Describe what is shown in this image concisely. "
        "Mention objects, people, atmosphere, and any visible text."
    ),
    "table": (
        "If this image contains a table, return it as pipe-delimited Markdown. "
        "If not, say 'no table detected'."
    ),
    "translate-id": (
        "Read all text in this image and translate it to Bahasa Indonesia. "
        "Return only the translation."
    ),
}


def _mime_from_upload(file: UploadFile, raw: bytes) -> str:
    """Pick a MIME type for the image data URL.

    Order of preference:
      1. ``file.content_type`` if it already declares an image/* subtype.
      2. magic bytes at the start of the blob.
      3. filename extension.
      4. ``image/png`` as a last resort.
    """
    declared = (file.content_type or "").lower()
    if declared.startswith("image/"):
        return declared

    # magic bytes
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:4] == b"GIF8":
        return "image/gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:2] == b"BM":
        return "image/bmp"

    # extension fallback
    lower = (file.filename or "").lower()
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    if lower.endswith(".bmp"):
        return "image/bmp"
    return "image/png"


@router.post("/extract")
async def extract(
    file: UploadFile = File(...),
    model: str = Form(...),
    prompt: Optional[str] = Form(default=None),
    max_tokens: Optional[int] = Form(default=1024),
    temperature: Optional[float] = Form(default=0.0),
    client: NineRouterClient = Depends(get_client),
    store: HistoryStore = Depends(get_store),
) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty upload")
    # Base64 inflates by ~33%, and upstream JSON body limits are commonly ~25 MB.
    # Keep raw upload comfortably below that threshold.
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(413, f"image too large ({len(raw)} bytes; cap 12 MB so base64 stays under upstream body limits)")

    if not prompt or not prompt.strip():
        prompt = DEFAULT_PROMPTS["ocr"]

    mime = _mime_from_upload(file, raw)
    b64 = base64.b64encode(raw).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    body: dict[str, Any] = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text", "text": prompt.strip()},
            ],
        }],
        "stream": False,
    }
    if max_tokens:
        body["max_tokens"] = int(max_tokens)
    if temperature is not None:
        body["temperature"] = float(temperature)

    resp = await client.chat_completion(body)
    if not isinstance(resp, dict):
        raise HTTPException(502, f"unexpected upstream shape: {type(resp).__name__}")
    text = ""
    try:
        text = resp["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        text = ""

    usage = resp.get("usage") or {}

    out_id = store.log_output(
        kind="vision",
        model=model,
        prompt=f"[file: {file.filename}, {len(raw)} bytes] {prompt[:160]}",
        result={
            "text": text,
            "usage": usage,
            "filename": file.filename,
            "bytes": len(raw),
            "mime": mime,
        },
    )
    return {
        "id": out_id,
        "model": model,
        "filename": file.filename,
        "bytes": len(raw),
        "mime": mime,
        "prompt": prompt,
        "text": text,
        "usage": usage,
    }


@router.get("/prompts")
def prompts() -> dict:
    """Expose the canned prompts so the UI can render chip buttons."""
    return {"prompts": DEFAULT_PROMPTS}
