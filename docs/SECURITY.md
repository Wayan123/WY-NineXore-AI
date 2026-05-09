# Security

This project is a single-user local developer console. It is deliberately **not** production-hardened. Understanding what that means is the whole point of this document.

---

## Threat model (what this project protects against)

### In scope

- **Secrets staying out of git.** The only credential this project consumes is `NINEROUTER_KEY` via `.env`. That file is gitignored and the key value is never logged, serialised into any response, or written to disk.
- **Untrusted HTML from web-fetch providers.** The "Read URL" panel renders HTML inside `<iframe sandbox="">` so remote pages cannot touch the dashboard origin.
- **Untrusted markdown from chat models.** `frontend/assets/md.js` escapes all input before applying inline rules and restricts link schemes to `http`, `https`, `mailto`, `tel`, and relative URLs. `javascript:` / `data:` / `vbscript:` URLs fall back to `href="#"`.
- **Local-ML file uploads.** STT caps audio uploads at 200 MB. Vision caps images at 12 MB. Both have empty-input guards.
- **History-DB file deletion.** `history.delete_output` only unlinks a file if it resolves inside `DATA_DIR`. Path traversal via the database path is rejected.

### Out of scope (read this carefully)

- **Multi-user.** No auth, no session cookies, no CSRF tokens. Anyone who can reach the HTTP socket can issue any request.
- **Network exposure.** Defaults bind to `127.0.0.1`. The moment you set `APP_HOST=0.0.0.0` the dashboard is reachable without auth from anyone on the LAN.
- **Rate limiting / quota.** If someone finds your dashboard and spams it, every request bills your 9Router provider keys. Protect the port.
- **Encryption at rest.** `data/history.db` stores chat content in plaintext SQLite. Anyone with filesystem access can read it.
- **Audit logging.** Beyond uvicorn's INFO-level access log, there is no per-user or per-key audit trail. You cannot answer "who did this" with more than one user.
- **Model content safety.** This project does not moderate what models say.

---

## What you must not commit

`.gitignore` already covers:

- `.env`, `.env.local`, `.env.*.local`
- `*.pem`, `*.key`, `*.crt`, `secrets/`, `**/credentials.json`
- `data/history.db` and `data/outputs/*` (keeps `.gitkeep`)
- `idn-tts/models/*` (330 MB weights; user downloads via `download.sh`)
- `__pycache__`, `.pytest_cache`, `.venv`, `venv`, `node_modules`

Before every commit, run:

```bash
git status                  # no .env, no data/*, no idn-tts/models/*
git diff --cached           # skim for accidentally-pasted keys
git grep -n 'sk-' HEAD      # shouldn't match anything outside .env.example placeholders
```

If you find a leaked key after pushing, **rotate it immediately** at the upstream provider, force-push history cleanup with `git filter-repo`, and add a deploy key only (never commit it back).

---

## Where your keys live

| Key type | Where it lives | Who sees it |
|---|---|---|
| `NINEROUTER_KEY` | `.env` on your filesystem | dashboard process only, forwarded as `Authorization: Bearer` to 9Router |
| Provider keys (OpenAI, NVIDIA, Tavily, …) | inside **9Router's** own config/DB | 9Router only — the dashboard never sees them |
| ChatGPT Plus / Pro session | inside 9Router's Codex provider state | 9Router only |

The dashboard holds exactly one secret. 9Router holds the rest. That separation is intentional: if you rotate 9Router keys you don't have to rebuild the dashboard.

---

## Safe deployment patterns

### Loopback only (default)
```dotenv
APP_HOST=127.0.0.1
```
No one outside the box can reach the dashboard. Safe.

### Same machine, multiple users
Still bind loopback. Use SSH port-forwarding:
```bash
ssh -L 8765:127.0.0.1:8765 user@host
```

### Remote access over LAN or internet
Put it behind a reverse proxy with TLS and at least HTTP Basic auth. Example Caddy snippet:

```caddy
wy.example.com {
    basicauth {
        ops JDJhJDEyJHNhbHQuZG9sbGFyLnNhbHQ     # bcrypt of a password
    }
    reverse_proxy 127.0.0.1:8765
}
```

Never set `APP_HOST=0.0.0.0` without a proxy in front.

### Local Whisper / Coqui network exposure
`idn-tts/run.sh` binds `127.0.0.1` by default. Override with `IDN_TTS_HOST=0.0.0.0` only if you're running the dashboard on a different host — same proxy rules apply.

---

## What data leaves your machine

| When | What | To whom |
|---|---|---|
| Any chat/image/embed/search/fetch call | prompt + args | 9Router → underlying provider |
| TTS with `coqui/*` voice | text (including prompts) | stays local (idn-tts service) |
| TTS with upstream voice (OpenAI, Edge-TTS, …) | text | 9Router → provider |
| STT with `local/whisper-large-v3` | audio | stays local |
| STT with upstream model | audio | 9Router → provider (e.g. Groq, Deepgram) |
| Vision / OCR | base64 image + prompt | 9Router → multimodal chat provider |
| Web search / fetch | query or URL | 9Router → search provider or target URL |

The UI shows a provider pill on every history entry so you can see where each output came from.

---

## Reporting a vulnerability

Open a private advisory on the GitHub repo (`Security → Report a vulnerability`). Do not open a public issue for anything exploitable.
