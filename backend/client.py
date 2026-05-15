"""Thin async wrapper around the 9Router HTTP API.

Goals
-----
* One shared AsyncClient (kept alive for the server lifetime).
* Auth header added automatically when NINEROUTER_KEY is set.
* Uniform error shape so frontend always sees {error: {...}}.
* Passes most params through verbatim; 9Router already speaks
  OpenAI-compatible shapes for each endpoint.
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Optional

import httpx

from .config import Settings, get_settings


class NineRouterError(Exception):
    """Upstream error with structured payload."""

    def __init__(self, status: int, body: Any, url: str = ""):
        self.status = status
        self.body = body
        self.url = url
        detail = body if isinstance(body, str) else json.dumps(body)[:400]
        super().__init__(f"9Router {status} ({url}): {detail}")

    def to_dict(self) -> dict:
        return {"error": {"status": self.status, "body": self.body, "url": self.url}}


class NineRouterClient:
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        # Large timeout: image gen + STT async upload can be slow.
        self._client = httpx.AsyncClient(
            base_url=self.settings.nineroute_url.rstrip("/"),
            timeout=httpx.Timeout(self.settings.request_timeout, connect=10.0),
            headers={"User-Agent": "9router-dashboard/0.1"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------ helpers
    def _h(self, extra: Optional[dict] = None) -> dict:
        h = dict(self.settings.auth_header())
        if extra:
            h.update(extra)
        return h

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> Any:
        resp = await self._client.request(
            method,
            path,
            json=json_body,
            params=params,
            headers=self._h(headers),
        )
        return self._parse_json_or_raise(resp, path)

    def _parse_json_or_raise(self, resp: httpx.Response, path: str) -> Any:
        if resp.status_code >= 400:
            try:
                body: Any = resp.json()
            except Exception:
                body = resp.text
            raise NineRouterError(resp.status_code, body, url=path)
        ctype = resp.headers.get("content-type", "")
        text = resp.text
        if "json" in ctype:
            try:
                return resp.json()
            except Exception:
                # upstream advertised json but sent junk — fall back to raw
                return {"raw": text}
        # Non-JSON response (e.g. accidentally streamed SSE for non-stream call).
        # Try JSON first in case content-type is just wrong.
        stripped = text.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return resp.json()
            except Exception:
                pass
        # 9Router (and a couple of upstreams) sometimes return text/event-stream
        # for a non-stream call: a JSON object followed by 'data: [DONE]'. Strip
        # the SSE trailer and re-parse so callers get real JSON, not {"raw": ...}.
        # The boundary may be 'X\ndata:' (well-formed SSE) or just '}data:' /
        # ']data:' when the upstream forgets the newline (we've seen both).
        if stripped.startswith("{") or stripped.startswith("["):
            import re as _re
            m = _re.search(r"(?<=[}\]])\s*data:\s*\[DONE\]", stripped)
            if m:
                head = stripped[:m.start()].rstrip()
                try:
                    import json as _json
                    return _json.loads(head)
                except Exception:
                    pass
            # Last resort: walk the SSE 'data:' lines and concatenate the
            # JSON deltas. Useful when the upstream really did stream.
            try:
                import json as _json
                pieces: list[Any] = []
                for line in stripped.splitlines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        pieces.append(_json.loads(payload))
                    except Exception:
                        continue
                if len(pieces) == 1:
                    return pieces[0]
                if pieces:
                    return {"data": pieces}
            except Exception:
                pass
        return {"raw": text}

    # --------------------------------------------------------------- discovery
    async def health(self) -> dict:
        r = await self._client.get("/api/health", headers=self._h())
        if r.status_code >= 400:
            raise NineRouterError(r.status_code, r.text, "/api/health")
        return r.json()

    async def list_models(self, kind: Optional[str] = None) -> dict:
        """kind: None (chat) | image | tts | stt | embedding | web | image-to-text."""
        path = "/v1/models" if not kind else f"/v1/models/{kind}"
        return await self._request_json("GET", path)

    async def model_info(self, model_id: str) -> dict:
        return await self._request_json(
            "GET", "/v1/models/info", params={"id": model_id}
        )

    async def list_voices(
        self, provider: Optional[str] = None, lang: Optional[str] = None
    ) -> dict:
        params = {}
        if provider:
            params["provider"] = provider
        if lang:
            params["lang"] = lang
        return await self._request_json("GET", "/v1/audio/voices", params=params)

    # ------------------------------------------------------------------- chat
    async def chat_completion(self, body: dict) -> dict:
        return await self._request_json(
            "POST", "/v1/chat/completions", json_body=body
        )

    async def chat_stream(self, body: dict) -> AsyncIterator[bytes]:
        """Yield raw SSE bytes (already framed) from upstream."""
        body = {**body, "stream": True}
        async with self._client.stream(
            "POST",
            "/v1/chat/completions",
            json=body,
            headers=self._h({"Accept": "text/event-stream"}),
        ) as resp:
            if resp.status_code >= 400:
                text = await resp.aread()
                raise NineRouterError(resp.status_code, text.decode(errors="replace"), "/v1/chat/completions")
            async for chunk in resp.aiter_raw():
                if chunk:
                    yield chunk

    # ------------------------------------------------------------------ image
    async def images_generate(self, body: dict) -> dict:
        return await self._request_json(
            "POST", "/v1/images/generations", json_body=body
        )

    async def images_generate_binary(self, body: dict) -> tuple[bytes, str]:
        resp = await self._client.post(
            "/v1/images/generations",
            json=body,
            params={"response_format": "binary"},
            headers=self._h(),
        )
        if resp.status_code >= 400:
            try:
                body_err: Any = resp.json()
            except Exception:
                body_err = resp.text
            raise NineRouterError(resp.status_code, body_err, "/v1/images/generations")
        return resp.content, resp.headers.get("content-type", "image/png")

    # -------------------------------------------------------------------- tts
    async def tts_speech(self, body: dict) -> tuple[bytes, str]:
        resp = await self._client.post(
            "/v1/audio/speech", json=body, headers=self._h()
        )
        if resp.status_code >= 400:
            try:
                body_err: Any = resp.json()
            except Exception:
                body_err = resp.text
            raise NineRouterError(resp.status_code, body_err, "/v1/audio/speech")
        return resp.content, resp.headers.get("content-type", "audio/mpeg")

    # -------------------------------------------------------------------- stt
    async def stt_transcribe(
        self,
        file_bytes: bytes,
        filename: str,
        model: str,
        *,
        language: Optional[str] = None,
        prompt: Optional[str] = None,
        response_format: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> Any:
        data: dict[str, Any] = {"model": model}
        if language:
            data["language"] = language
        if prompt:
            data["prompt"] = prompt
        if response_format:
            data["response_format"] = response_format
        if temperature is not None:
            data["temperature"] = str(temperature)
        files = {"file": (filename, file_bytes)}
        resp = await self._client.post(
            "/v1/audio/transcriptions",
            data=data,
            files=files,
            headers=self._h(),
        )
        return self._parse_json_or_raise(resp, "/v1/audio/transcriptions")

    # ------------------------------------------------------------- embeddings
    async def embeddings(self, body: dict) -> dict:
        return await self._request_json("POST", "/v1/embeddings", json_body=body)

    # ----------------------------------------------------------------- search
    async def web_search(self, body: dict) -> dict:
        return await self._request_json("POST", "/v1/search", json_body=body)

    async def web_fetch(self, body: dict) -> dict:
        return await self._request_json("POST", "/v1/web/fetch", json_body=body)
