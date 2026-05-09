"""Storage / DB round-trip tests."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from backend.storage.db import HistoryStore


@pytest.fixture
def store(tmp_path):
    return HistoryStore(tmp_path / "h.db")


def test_session_crud(store):
    s = store.new_session("hello", model="m", system="sys")
    sid = s["id"]

    store.add_message(sid, "user", "hi")
    store.add_message(sid, "assistant", "back")

    full = store.get_session(sid)
    assert full["title"] == "hello"
    assert full["system"] == "sys"
    assert len(full["messages"]) == 2

    store.rename_session(sid, "renamed")
    assert store.get_session(sid)["title"] == "renamed"

    store.pin_session(sid, True)
    assert store.get_session(sid)["pinned"] == 1

    store.update_session_system(sid, "new sys")
    assert store.get_session(sid)["system"] == "new sys"

    store.update_session_model(sid, "new-model")
    assert store.get_session(sid)["model"] == "new-model"

    listing = store.list_sessions()
    assert any(x["id"] == sid for x in listing)

    store.delete_session(sid)
    assert store.get_session(sid) is None


def test_outputs_roundtrip(store):
    oid = store.log_output(kind="image", model="m", prompt="a", result={"k": 1}, file_path="outputs/a.png")
    items = store.list_outputs(kind="image")
    assert len(items) == 1
    assert items[0]["id"] == oid
    assert items[0]["result"] == {"k": 1}

    store.favorite_output(oid, True)
    favs = store.list_outputs(kind="image", favorite_only=True)
    assert len(favs) == 1

    rel = store.delete_output(oid)
    assert rel == "outputs/a.png"
    assert store.list_outputs() == []


def test_stats(store):
    s = store.new_session("s")
    store.add_message(s["id"], "user", "a")
    store.log_output(kind="tts", model="m")
    stats = store.stats()
    assert stats["sessions"] == 1
    assert stats["messages"] == 1
    assert stats["outputs_by_kind"].get("tts") == 1
