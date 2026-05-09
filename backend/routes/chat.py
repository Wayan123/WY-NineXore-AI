"""/api/chat — proxy + session persistence for chat/code-gen."""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..client import NineRouterClient, NineRouterError
from ..storage.db import HistoryStore
from .deps import get_client, get_store

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    session_id: Optional[str] = None
    system: Optional[str] = None
    # Generation knobs (all optional; passed through verbatim if set)
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    presence_penalty: Optional[float] = None
    frequency_penalty: Optional[float] = None
    extra: dict[str, Any] = Field(default_factory=dict)


def _build_upstream_body(req: ChatRequest, stream: bool = False) -> dict:
    msgs = [m.model_dump() for m in req.messages]
    # prepend system if provided and not already first
    if req.system and not (msgs and msgs[0].get("role") == "system"):
        msgs = [{"role": "system", "content": req.system}, *msgs]
    body: dict[str, Any] = {"model": req.model, "messages": msgs, "stream": stream}
    for key in ("temperature", "top_p", "max_tokens",
                "presence_penalty", "frequency_penalty"):
        v = getattr(req, key)
        if v is not None:
            body[key] = v
    if req.extra:
        body.update(req.extra)
    return body


# ------------------------------------------------------------------ non-stream
@router.post("/complete")
async def complete(
    req: ChatRequest,
    client: NineRouterClient = Depends(get_client),
    store: HistoryStore = Depends(get_store),
):
    body = _build_upstream_body(req, stream=False)
    resp = await client.chat_completion(body)

    # Persist if the caller attached a session
    if req.session_id and isinstance(resp, dict):
        try:
            user_msg = req.messages[-1] if req.messages else None
            if user_msg and user_msg.role == "user":
                store.add_message(req.session_id, "user", user_msg.content)
            ans = ((resp.get("choices") or [{}])[0]
                   .get("message", {}).get("content", ""))
            if ans:
                store.add_message(req.session_id, "assistant", ans)
            store.update_session_model(req.session_id, req.model)
        except Exception:
            pass

    return resp


# ---------------------------------------------------------------------- stream
@router.post("/stream")
async def stream(
    req: ChatRequest,
    client: NineRouterClient = Depends(get_client),
    store: HistoryStore = Depends(get_store),
):
    body = _build_upstream_body(req, stream=True)

    async def gen():
        collected: list[str] = []
        try:
            async for raw in client.chat_stream(body):
                # passthrough upstream SSE bytes
                yield raw
                # best-effort content capture for persistence
                try:
                    text = raw.decode("utf-8", errors="replace")
                    for line in text.splitlines():
                        line = line.strip()
                        if line.startswith("data:"):
                            payload = line[5:].strip()
                            if payload and payload != "[DONE]":
                                obj = json.loads(payload)
                                delta = (obj.get("choices") or [{}])[0].get("delta", {})
                                c = delta.get("content")
                                if c:
                                    collected.append(c)
                except Exception:
                    pass
        except NineRouterError as e:
            err = json.dumps(e.to_dict())
            yield f"data: {err}\n\n".encode()
            yield b"data: [DONE]\n\n"
            return

        # after stream ends, persist
        if req.session_id and collected:
            try:
                user_msg = req.messages[-1] if req.messages else None
                if user_msg and user_msg.role == "user":
                    store.add_message(req.session_id, "user", user_msg.content)
                store.add_message(req.session_id, "assistant", "".join(collected))
                store.update_session_model(req.session_id, req.model)
            except Exception:
                pass

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ------------------------------------------------------------------- sessions
@router.get("/sessions")
def list_sessions(store: HistoryStore = Depends(get_store)) -> list[dict]:
    return store.list_sessions()


@router.post("/sessions")
def create_session(
    body: dict = Body(default_factory=dict),
    store: HistoryStore = Depends(get_store),
) -> dict:
    title = body.get("title") or "New chat"
    return store.new_session(
        title=title,
        model=body.get("model", ""),
        system=body.get("system", ""),
    )


@router.get("/sessions/{sid}")
def get_session(sid: str, store: HistoryStore = Depends(get_store)) -> dict:
    s = store.get_session(sid)
    if not s:
        raise HTTPException(404, "session not found")
    return s


@router.patch("/sessions/{sid}")
def patch_session(
    sid: str,
    body: dict = Body(...),
    store: HistoryStore = Depends(get_store),
) -> dict:
    if "title" in body:
        store.rename_session(sid, str(body["title"]))
    if "pinned" in body:
        store.pin_session(sid, bool(body["pinned"]))
    if "model" in body:
        store.update_session_model(sid, str(body["model"]))
    if "system" in body:
        store.update_session_system(sid, str(body["system"]))
    s = store.get_session(sid)
    if not s:
        raise HTTPException(404, "session not found")
    return s


@router.delete("/sessions/{sid}")
def delete_session(sid: str, store: HistoryStore = Depends(get_store)) -> dict:
    store.delete_session(sid)
    return {"ok": True}
