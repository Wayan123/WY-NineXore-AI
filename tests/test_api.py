"""Smoke tests for the backend.

These avoid hitting real 9Router; they use FastAPI TestClient and a
fake upstream via a pytest fixture that monkey-patches ``NineRouterClient``.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Point data dir at a per-session temp folder BEFORE the app is imported
_TMP = tempfile.mkdtemp(prefix="9r-test-")
os.environ["DATA_DIR"] = _TMP
os.environ["NINEROUTER_URL"] = "http://fake.local"
os.environ["NINEROUTER_KEY"] = ""

from backend.main import app  # noqa: E402
from backend.client import NineRouterError  # noqa: E402


class FakeUpstream:
    """In-memory stand-in for NineRouterClient."""

    def __init__(self, *_, **__):
        self.closed = False

    async def aclose(self):
        self.closed = True

    async def health(self):
        return {"ok": True}

    async def list_models(self, kind=None):
        if kind is None:
            return {"object": "list", "data": [{"id": "fake/chat-1", "owned_by": "fake"}]}
        if kind == "image":
            return {"object": "list", "data": [{"id": "fake/img-1", "owned_by": "fake"}]}
        if kind == "embedding":
            return {"object": "list", "data": [{"id": "fake/embed-1", "owned_by": "fake"}]}
        if kind == "web":
            return {"object": "list", "data": [
                {"id": "fake/search", "kind": "webSearch", "owned_by": "fake"},
                {"id": "fake/fetch",  "kind": "webFetch",  "owned_by": "fake"},
            ]}
        return {"object": "list", "data": []}

    async def model_info(self, model_id):
        return {"id": model_id, "name": f"Fake {model_id}", "kind": "llm"}

    async def list_voices(self, provider=None, lang=None):
        return {"data": [{"model": "fake/voice", "language": lang or "en"}]}

    async def chat_completion(self, body):
        return {
            "id": "chat-1",
            "object": "chat.completion",
            "model": body.get("model"),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "hello back"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
        }

    async def chat_stream(self, body):
        yield b'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n'
        yield b'data: {"choices":[{"delta":{"content":"back"}}]}\n\n'
        yield b'data: [DONE]\n\n'

    async def images_generate(self, body):
        # return a tiny 1x1 png base64
        import base64
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==")
        b64 = base64.b64encode(png).decode()
        return {"created": 1, "data": [{"b64_json": b64}]}

    async def tts_speech(self, body):
        return b"ID3fake-mp3-bytes", "audio/mpeg"

    async def stt_transcribe(self, file_bytes, filename, model, **kwargs):
        return {"text": "fake transcript", "language": kwargs.get("language") or "en"}

    async def embeddings(self, body):
        n = len(body["input"]) if isinstance(body["input"], list) else 1
        return {
            "object": "list", "model": body["model"],
            "data": [{"object": "embedding", "index": i, "embedding": [0.1, 0.2, 0.3, 0.4]} for i in range(n)],
            "usage": {"prompt_tokens": n, "total_tokens": n},
        }

    async def web_search(self, body):
        return {"provider": "fake", "query": body["query"], "results": [
            {"title": "r1", "url": "https://x", "snippet": "..."},
        ], "usage": {}, "metrics": {}}

    async def web_fetch(self, body):
        return {"provider": "fake", "url": body["url"], "title": "fake",
                "content": {"format": body.get("format", "markdown"), "text": "# hi", "length": 4}}


class FakeIdnTTS:
    """Stand-in for IdnTTSClient in tests — behaves as "disabled/unreachable"."""
    enabled = False
    base = "http://fake-idn.local"

    async def aclose(self): pass
    async def health(self): return None
    async def is_reachable(self): return False
    async def whisper_is_reachable(self): return False
    async def whisper_variants(self): return {}
    async def speakers(self): return []
    async def default_speaker(self): return "wibowo"
    async def speak(self, text, speaker, speed=1.2): raise NotImplementedError
    # Supertonic stubs — default to disabled/unreachable
    async def supertonic_is_reachable(self): return False
    async def supertonic_voices(self): return {}
    async def supertonic_languages(self): return {}


@pytest.fixture
def client(monkeypatch):
    """FastAPI test client with fake upstream wired in."""
    with TestClient(app) as tc:
        # TestClient runs the lifespan, which creates the real client.
        # Replace it now, before any request.
        fake = FakeUpstream()
        app.state.client = fake  # type: ignore
        app.state.idn_tts = FakeIdnTTS()  # type: ignore
        yield tc


# ---------------------------------------------------------------- tests ---

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_settings_no_secret_leak(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    body = r.json()
    assert "nineroute_key" not in str(body)
    assert body["nineroute_url"] == "http://fake.local"


def test_upstream(client):
    r = client.get("/api/upstream")
    assert r.status_code == 200
    assert r.json()["reachable"] is True


def test_models_all(client):
    r = client.get("/api/models/all")
    assert r.status_code == 200
    data = r.json()
    for k in ("chat", "image", "tts", "stt", "embedding", "web", "image-to-text"):
        assert k in data


def test_models_kind_valid(client):
    r = client.get("/api/models?kind=image")
    assert r.status_code == 200
    assert r.json()["data"][0]["id"] == "fake/img-1"


def test_models_kind_invalid(client):
    r = client.get("/api/models?kind=bogus")
    assert r.status_code == 400


def test_chat_complete(client):
    r = client.post("/api/chat/complete", json={
        "model": "fake/chat-1",
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 200
    assert r.json()["choices"][0]["message"]["content"] == "hello back"


def test_chat_stream(client):
    with client.stream("POST", "/api/chat/stream", json={
        "model": "fake/chat-1",
        "messages": [{"role": "user", "content": "hi"}],
    }) as resp:
        assert resp.status_code == 200
        body = b"".join(resp.iter_bytes())
        assert b"hello" in body
        assert b"[DONE]" in body


def test_sessions_crud(client):
    r = client.post("/api/chat/sessions", json={"title": "t", "model": "fake/chat-1", "system": "you are fake"})
    assert r.status_code == 200
    sid = r.json()["id"]

    # send a message into this session
    r = client.post("/api/chat/complete", json={
        "model": "fake/chat-1",
        "messages": [{"role": "user", "content": "hey"}],
        "session_id": sid,
    })
    assert r.status_code == 200

    # get with messages
    r = client.get(f"/api/chat/sessions/{sid}")
    assert r.status_code == 200
    got = r.json()
    assert len(got["messages"]) == 2
    assert got["system"] == "you are fake"

    # patch system + title
    r = client.patch(f"/api/chat/sessions/{sid}", json={"system": "new sys", "title": "renamed"})
    assert r.status_code == 200
    assert r.json()["system"] == "new sys"
    assert r.json()["title"] == "renamed"

    # delete
    r = client.delete(f"/api/chat/sessions/{sid}")
    assert r.status_code == 200

    r = client.get(f"/api/chat/sessions/{sid}")
    assert r.status_code == 404


def test_image_generate(client, tmp_path):
    r = client.post("/api/image/generate", json={
        "model": "fake/img-1",
        "prompt": "a tiny test square",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["prompt"] == "a tiny test square"
    assert len(data["images"]) == 1
    # file was written to the DATA_DIR we set up
    f = Path(_TMP) / data["images"][0]["file"]
    assert f.exists()
    assert f.stat().st_size > 0


def test_tts_speak(client):
    r = client.post("/api/tts/speak", json={"model": "fake/voice", "input": "hello"})
    assert r.status_code == 200
    data = r.json()
    assert data["file"].startswith("outputs/")
    assert (Path(_TMP) / data["file"]).exists()


def test_stt_transcribe(client):
    files = {"file": ("clip.mp3", b"\x00\x01audio", "audio/mpeg")}
    r = client.post("/api/stt/transcribe", data={"model": "fake/stt"}, files=files)
    assert r.status_code == 200
    assert r.json()["result"]["text"] == "fake transcript"


def test_embeddings_with_similarity(client):
    r = client.post("/api/embeddings/embed", json={
        "model": "fake/embed-1",
        "input": ["one", "two", "three"],
    })
    assert r.status_code == 200
    d = r.json()
    assert d["dimensions"] == 4
    assert d["count"] == 3
    assert len(d["similarity"]) == 3
    # diagonal should be ~1.0
    for i in range(3):
        assert abs(d["similarity"][i][i] - 1.0) < 1e-6


def test_search(client):
    r = client.post("/api/search/run", json={"model": "fake/search", "query": "hi"})
    assert r.status_code == 200
    assert r.json()["provider"] == "fake"


def test_fetch(client):
    r = client.post("/api/fetch/run", json={"model": "fake/fetch", "url": "https://x"})
    assert r.status_code == 200
    assert r.json()["content"]["text"] == "# hi"


def test_history_and_favorite(client):
    # generate something, then query history
    client.post("/api/image/generate", json={"model": "fake/img-1", "prompt": "z"})
    r = client.get("/api/history/outputs?kind=image")
    assert r.status_code == 200
    items = r.json()
    assert items, "expected at least one image output"
    oid = items[0]["id"]
    r = client.patch(f"/api/history/outputs/{oid}", json={"favorite": True})
    assert r.status_code == 200
    items = client.get("/api/history/outputs?kind=image&favorite=true").json()
    assert any(i["id"] == oid for i in items)


def test_tts_coqui_routes_to_idn_tts(client):
    """A model starting with coqui/ should use the local service, not 9Router."""
    class ReachableIdn:
        enabled = True
        base = "http://fake-idn.local"
        async def aclose(self): pass
        async def health(self): return {"loaded": True}
        async def is_reachable(self): return True
        async def speakers(self): return ["wibowo", "ardi", "gadis"]
        async def default_speaker(self): return "wibowo"
        received_speed = None
        async def speak(self, text, speaker, speed=1.2):
            ReachableIdn.received_speed = speed
            assert speaker in {"wibowo", "ardi", "gadis"}
            assert text
            return b"RIFFfakewavbytes", "audio/wav"
    app.state.idn_tts = ReachableIdn()  # type: ignore

    r = client.post("/api/tts/speak", json={
        "model": "coqui/wibowo", "input": "Halo", "speed": 1.35,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["model"] == "coqui/wibowo"
    assert data["file"].startswith("outputs/")
    assert data["content_type"] == "audio/wav"
    assert data["speed"] == 1.35
    assert ReachableIdn.received_speed == 1.35


def test_stt_local_whisper_routes_to_idn_tts(client):
    """A model starting with local/whisper should use the local service."""
    class ReachableIdn:
        enabled = True
        base = "http://fake-idn.local"
        received = {}
        async def aclose(self): pass
        async def health(self): return {"loaded": True, "whisper": {"enabled": True, "loaded": True}}
        async def is_reachable(self): return True
        async def whisper_is_reachable(self): return True
        async def speakers(self): return []
        async def default_speaker(self): return "wibowo"
        async def speak(self, text, speaker, speed=1.2): raise NotImplementedError
        async def whisper_transcribe(self, audio_bytes, filename, **kw):
            ReachableIdn.received = {"filename": filename, "bytes": len(audio_bytes), **kw}
            return {
                "variant": kw.get("variant") or "large-v3",
                "model": "openai/whisper-" + (kw.get("variant") or "large-v3"),
                "text": "halo dunia",
                "language": kw.get("language"),
                "duration": 1.5,
                "segments": [],
            }
    app.state.idn_tts = ReachableIdn()  # type: ignore

    files = {"file": ("clip.wav", b"RIFFmock", "audio/wav")}
    r = client.post("/api/stt/transcribe", data={
        "model": "local/whisper-medium",
        "language": "id",
    }, files=files)
    assert r.status_code == 200
    data = r.json()
    assert data["model"] == "local/whisper-medium"
    assert data["result"]["text"] == "halo dunia"
    assert data["result"]["variant"] == "medium"
    assert ReachableIdn.received["variant"] == "medium"
    assert ReachableIdn.received["language"] == "id"
    assert ReachableIdn.received["bytes"] == len(b"RIFFmock")


def test_models_stt_includes_local_whisper(client):
    class ReachableIdn:
        enabled = True
        base = "http://fake-idn.local"
        async def aclose(self): pass
        async def health(self): return {
            "loaded": True,
            "whisper": {"enabled": True, "loaded": True, "model": "openai/whisper-large-v3", "device": "cuda"},
        }
        async def whisper_variants(self): return {
            "enabled": True,
            "default": "large-v3",
            "variants": {
                "tiny":     {"model": "openai/whisper-tiny",     "loaded": False, "loading": False, "error": None, "device": None, "size_gb": 0.15, "params_m": 39,  "notes": "CPU-friendly"},
                "medium":   {"model": "openai/whisper-medium",   "loaded": False, "loading": False, "error": None, "device": None, "size_gb": 1.5,  "params_m": 769, "notes": "balanced"},
                "large-v3": {"model": "openai/whisper-large-v3", "loaded": True,  "loading": False, "error": None, "device": "cuda", "size_gb": 2.9, "params_m": 1550, "notes": "best"},
            },
        }
        async def speakers(self): return []
        async def default_speaker(self): return "wibowo"
    app.state.idn_tts = ReachableIdn()  # type: ignore
    r = client.get("/api/models?kind=stt")
    ids = [m["id"] for m in r.json()["data"]]
    # All three variants should now be exposed
    assert "local/whisper-tiny" in ids
    assert "local/whisper-medium" in ids
    assert "local/whisper-large-v3" in ids


def test_models_tts_includes_coqui_when_reachable(client):
    class ReachableIdn:
        enabled = True
        base = "http://fake-idn.local"
        async def aclose(self): pass
        async def speakers(self): return ["wibowo", "ardi"]
        async def default_speaker(self): return "wibowo"
    app.state.idn_tts = ReachableIdn()  # type: ignore
    r = client.get("/api/models?kind=tts")
    ids = [m["id"] for m in r.json()["data"]]
    assert "coqui/wibowo" in ids
    assert "coqui/ardi" in ids


def test_upstream_error_passthrough(client):
    """Injected upstream error should bubble up in the canonical {error: {...}} shape."""
    async def boom(body):
        raise NineRouterError(503, {"error": {"message": "busy"}}, url="/v1/chat/completions")
    app.state.client.chat_completion = boom  # type: ignore
    r = client.post("/api/chat/complete", json={
        "model": "fake", "messages": [{"role": "user", "content": "x"}],
    })
    assert r.status_code == 503
    body = r.json()
    # Canonical error envelope — no FastAPI "detail" wrapper
    assert "error" in body
    assert "detail" not in body
    assert body["error"]["status"] == 503
    assert body["error"]["url"] == "/v1/chat/completions"
    # user-visible message is inside body.error.body.error.message
    assert body["error"]["body"]["error"]["message"] == "busy"


def test_stt_rejects_empty(client):
    files = {"file": ("clip.mp3", b"", "audio/mpeg")}
    r = client.post("/api/stt/transcribe", data={"model": "fake/stt"}, files=files)
    assert r.status_code == 400


def test_session_system_can_be_patched(client):
    r = client.post("/api/chat/sessions", json={"title": "x", "system": "first"})
    sid = r.json()["id"]
    r = client.patch(f"/api/chat/sessions/{sid}", json={"system": "second"})
    assert r.status_code == 200
    assert r.json()["system"] == "second"
    r = client.get(f"/api/chat/sessions/{sid}")
    assert r.json()["system"] == "second"


# --- Supertonic TTS integration --------------------------------------------

def test_models_tts_includes_supertonic(client):
    """/api/models?kind=tts should surface 10 supertonic voices when the
    local SDK reports as enabled."""
    class ReachableIdn:
        enabled = True
        base = "http://fake-idn.local"

        async def aclose(self): pass
        async def health(self): return {"loaded": True, "supertonic": {"enabled": True, "loaded": True}}
        async def is_reachable(self): return True
        async def whisper_is_reachable(self): return False
        async def whisper_variants(self): return {}
        async def speakers(self): return []
        async def default_speaker(self): return "wibowo"
        async def supertonic_is_reachable(self): return True
        async def supertonic_voices(self):
            return {
                "enabled": True,
                "loaded": True,
                "loading": False,
                "error": None,
                "device": "cpu",
                "voices_source": "cache",
                "voices": [
                    {"name": n, "family": "M" if n[0] == "M" else "F", "source": "cache"}
                    for n in ("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5")
                ],
                "sample_rate": 24000,
            }
        async def supertonic_languages(self):
            return {
                "default": "en",
                "languages": [{"code": c, "label": c.upper()} for c in
                              ("en", "ko", "ja", "id", "vi", "fr", "de", "es")],
            }

    app.state.idn_tts = ReachableIdn()  # type: ignore
    r = client.get("/api/models?kind=tts")
    assert r.status_code == 200
    ids = [m["id"] for m in r.json()["data"]]
    # All ten stock voices present
    for n in ("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"):
        assert f"supertonic/{n}" in ids
    # Per-entry metadata
    m1 = next(m for m in r.json()["data"] if m["id"] == "supertonic/M1")
    assert m1["voice_family"] == "M"
    assert m1["loaded"] is True
    assert "en" in m1["languages"]


def test_tts_supertonic_routes_to_idn_tts(client):
    """POST /api/tts/speak with model=supertonic/<voice> must reach the
    local idn-tts client with both `voice` and `language` kwargs."""
    captured = {}

    class ReachableIdn:
        enabled = True
        base = "http://fake-idn.local"
        async def aclose(self): pass
        async def health(self): return {"loaded": True, "supertonic": {"enabled": True}}
        async def is_reachable(self): return True
        async def whisper_is_reachable(self): return False
        async def whisper_variants(self): return {}
        async def speakers(self): return []
        async def default_speaker(self): return "wibowo"
        async def supertonic_is_reachable(self): return True
        async def supertonic_voices(self): return {"enabled": True, "voices": []}
        async def supertonic_languages(self): return {"default": "en", "languages": []}
        async def supertonic_speak(self, text, *, voice="M1", language="en", speed=1.05):
            captured["text"] = text
            captured["voice"] = voice
            captured["language"] = language
            captured["speed"] = speed
            # Minimal valid WAV header (44 bytes RIFF) + 4 silent samples
            return (b"RIFF" + b"\x00" * 40 + b"\x00\x00\x00\x00", "audio/wav")

    app.state.idn_tts = ReachableIdn()  # type: ignore

    body = {
        "model": "supertonic/F2",
        "input": "Halo, ini uji coba bahasa Indonesia.",
        "language": "id",
        "speed": 1.2,
    }
    r = client.post("/api/tts/speak", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["model"] == "supertonic/F2"
    assert data["language"] == "id"
    # The local client really got called with the right kwargs
    assert captured["voice"] == "F2"
    assert captured["language"] == "id"
    assert captured["speed"] == 1.2


def test_tts_supertonic_unsupported_lang_returns_400(client):
    """Bogus language codes should fail loudly (with a help link), not
    silently be coerced to 'en' by the local service."""
    class ReachableIdn:
        enabled = True
        base = "http://fake-idn.local"
        async def aclose(self): pass
        async def health(self): return {"loaded": True, "supertonic": {"enabled": True}}
        async def is_reachable(self): return True
        async def whisper_is_reachable(self): return False
        async def whisper_variants(self): return {}
        async def speakers(self): return []
        async def default_speaker(self): return "wibowo"
        async def supertonic_is_reachable(self): return True
        async def supertonic_voices(self): return {"enabled": True, "voices": []}
        async def supertonic_languages(self): return {"default": "en", "languages": []}
        async def supertonic_speak(self, *a, **kw):
            raise AssertionError("should not have reached the local service")

    app.state.idn_tts = ReachableIdn()  # type: ignore

    r = client.post(
        "/api/tts/speak",
        json={"model": "supertonic/M1", "input": "hi", "language": "xx"},
    )
    assert r.status_code == 400
    body = r.json()
    detail = body.get("detail") or ""
    assert "xx" in detail
    # Hint to the catalog endpoint should be present
    assert "/supertonic/languages" in detail
