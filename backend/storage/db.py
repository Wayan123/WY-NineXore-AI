"""Tiny SQLite-backed history for the dashboard.

Two tables:

* ``sessions`` + ``messages`` — multi-turn chat history.
* ``outputs``                 — flat log for every non-chat capability call.

Uses stdlib ``sqlite3`` via a thread-safe pool. All APIs are synchronous; we
call them from route handlers with ``run_in_threadpool`` (already the
FastAPI default for ``def`` endpoints).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    model       TEXT,
    system      TEXT,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    pinned      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outputs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,   -- image | tts | stt | embedding | search | fetch | vision
    model       TEXT,
    prompt      TEXT,
    result      TEXT,            -- JSON-serialised response
    file_path   TEXT,            -- relative path under DATA_DIR/outputs
    favorite    INTEGER DEFAULT 0,
    created_at  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_outputs_kind ON outputs(kind);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
"""


class HistoryStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init()

    def _init(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(_SCHEMA)
            c.commit()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with self._lock:
                yield conn
        finally:
            conn.close()

    # ----------------------------------------------------------- chat sessions
    def new_session(
        self, title: str, model: str = "", system: str = ""
    ) -> dict:
        sid = uuid.uuid4().hex
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO sessions(id,title,model,system,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?)",
                (sid, title or "Untitled", model, system, now, now),
            )
            c.commit()
        return {
            "id": sid,
            "title": title or "Untitled",
            "model": model,
            "system": system,
            "created_at": now,
            "updated_at": now,
            "pinned": 0,
        }

    def list_sessions(self, limit: int = 100) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id) AS n_msg "
                "FROM sessions s ORDER BY pinned DESC, updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session(self, sid: str) -> Optional[dict]:
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM sessions WHERE id=?", (sid,)
            ).fetchone()
            if not row:
                return None
            msgs = c.execute(
                "SELECT role,content,created_at FROM messages WHERE session_id=? ORDER BY id",
                (sid,),
            ).fetchall()
        return {**dict(row), "messages": [dict(m) for m in msgs]}

    def add_message(self, sid: str, role: str, content: str) -> None:
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)",
                (sid, role, content, now),
            )
            c.execute("UPDATE sessions SET updated_at=? WHERE id=?", (now, sid))
            c.commit()

    def rename_session(self, sid: str, title: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE sessions SET title=?, updated_at=? WHERE id=?",
                      (title, time.time(), sid))
            c.commit()

    def pin_session(self, sid: str, pinned: bool) -> None:
        with self._conn() as c:
            c.execute("UPDATE sessions SET pinned=? WHERE id=?", (1 if pinned else 0, sid))
            c.commit()

    def delete_session(self, sid: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM sessions WHERE id=?", (sid,))
            c.commit()

    def update_session_model(self, sid: str, model: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE sessions SET model=?, updated_at=? WHERE id=?",
                      (model, time.time(), sid))
            c.commit()

    def update_session_system(self, sid: str, system: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE sessions SET system=?, updated_at=? WHERE id=?",
                      (system, time.time(), sid))
            c.commit()

    # ------------------------------------------------------------- flat outputs
    def log_output(
        self,
        kind: str,
        *,
        model: str = "",
        prompt: str = "",
        result: Any = None,
        file_path: str = "",
    ) -> int:
        now = time.time()
        payload = json.dumps(result, ensure_ascii=False) if result is not None else None
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO outputs(kind,model,prompt,result,file_path,created_at) "
                "VALUES(?,?,?,?,?,?)",
                (kind, model, prompt, payload, file_path, now),
            )
            c.commit()
            return int(cur.lastrowid)

    def list_outputs(
        self,
        kind: Optional[str] = None,
        limit: int = 100,
        favorite_only: bool = False,
    ) -> list[dict]:
        sql = "SELECT * FROM outputs WHERE 1=1"
        args: list[Any] = []
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        if favorite_only:
            sql += " AND favorite=1"
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with self._conn() as c:
            rows = c.execute(sql, args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            if d.get("result"):
                try:
                    d["result"] = json.loads(d["result"])
                except Exception:
                    pass
            out.append(d)
        return out

    def favorite_output(self, out_id: int, fav: bool) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE outputs SET favorite=? WHERE id=?",
                (1 if fav else 0, out_id),
            )
            c.commit()

    def delete_output(self, out_id: int) -> Optional[str]:
        """Delete row; return relative file_path if any (caller unlinks file)."""
        with self._conn() as c:
            row = c.execute(
                "SELECT file_path FROM outputs WHERE id=?", (out_id,)
            ).fetchone()
            c.execute("DELETE FROM outputs WHERE id=?", (out_id,))
            c.commit()
        return row["file_path"] if row else None

    def stats(self) -> dict:
        with self._conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS sessions_count FROM sessions"
            ).fetchone()
            s_count = row["sessions_count"]
            row = c.execute(
                "SELECT COUNT(*) AS msg_count FROM messages"
            ).fetchone()
            m_count = row["msg_count"]
            by_kind = c.execute(
                "SELECT kind, COUNT(*) AS n FROM outputs GROUP BY kind"
            ).fetchall()
        return {
            "sessions": s_count,
            "messages": m_count,
            "outputs_by_kind": {r["kind"]: r["n"] for r in by_kind},
        }
