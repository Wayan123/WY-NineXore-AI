# Contributing

This is a small personal-scale project. Contributions are welcome but the bar is "does it make the single-user experience better without adding ceremony."

## Before you start

1. Read [`DESIGN.md`](./DESIGN.md) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). The visual and structural choices are intentional — they explain why the code looks the way it does.
2. Run the tests: `conda activate info-ai && pytest tests/`. 26/26 must pass before you open a PR.
3. Open an issue first for anything bigger than a bug fix. Saves both sides time.

## Code style

- **Python**: stdlib + FastAPI + httpx. No new heavy deps without a clear reason. Keep route handlers thin; put routing logic in `backend/idn_tts.py`-style helpers.
- **Frontend**: vanilla ES modules. No framework, no bundler. The `el()` helper in `ui.js` is the only DOM builder you need. Keep panels under ~300 LOC each — if it grows past that, split a helper into its own file.
- **CSS**: tokens in `:root`, utilities, then sections. All colours must use a `var(--token)` reference — no new hex codes outside `:root`. The only accent colour is `--accent`.
- **Markdown docs**: explain *why*, not just *what*. Keep prose conversational but precise.

## Adding a new capability

1. Add a route under `backend/routes/<name>.py`. Keep it thin — the real logic probably belongs in `backend/client.py` or `backend/idn_tts.py`.
2. Add a frontend panel at `frontend/assets/components/<name>.js` that exports `async function mount(root)`.
3. Register the view in `frontend/assets/app.js` (`VIEWS` map and `NAV_MAP`).
4. Add a nav link and empty `<section>` placeholder in `frontend/index.html`.
5. Add a test in `tests/test_api.py` with a fake upstream.

## Security basics

- **Never commit** `.env`, keys, tokens, or generated `data/` artefacts. Before committing: `git status`, `git diff --cached`, `git grep -n 'sk-' HEAD`.
- New endpoints that accept user input must have explicit size caps and empty-input guards.
- Anywhere you render untrusted remote content, sandbox it or escape it (see `md.js::renderMarkdown` and `fetch.js`'s iframe pattern).

## Pull request checklist

- [ ] 26/26 pytest still green
- [ ] `node --check` passes on every JS file (no bundler, so syntax matters)
- [ ] No new secrets, absolute paths, or `/home/*` leakage
- [ ] New capability: added test + docs entry
- [ ] `DESIGN.md` tokens untouched, or explicitly updated
- [ ] README / SETUP updated if the operator surface changed

## Commit messages

`type: subject` style. Types we use: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `security`. Keep subject ≤ 60 chars. Body in the imperative voice if details are needed.
