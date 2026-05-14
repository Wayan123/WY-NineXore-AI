# Skills

This project pairs with [my-grand-project-skills](https://github.com/Wayan123/my-grand-project-skills),
a portable skill pack for AI coding agents (pi / Codex / Claude). The skills
sharpen the day-to-day dev loop — planning, debugging, TDD, secret-scanning,
release management, design discipline — without dragging in SaaS lifecycle
work this repo does not need.

The skill content lives at `.agents/skills/` (installed locally, **not**
committed). Reinstalling on a fresh clone is one command:

```bash
bash scripts/install-skills.sh
```

## Why these skills?

WY NineXore AI is a local OSS developer tool: FastAPI backend, vanilla-JS
frontend, no SaaS infra, no multi-tenant, no public web exposure (binds to
`127.0.0.1`). The picks below reflect that shape.

### Core (always)

| Skill | Purpose |
| --- | --- |
| `portable-project-adapter` | Reads the repo and adapts behaviour to local context. |
| `superpowers-suite` | Brainstorming, plan writing, plan execution, TDD, debugging, verification, agent dispatch. |
| `skill-evolution-engine` | Audits installed skills on a schedule and writes upgrade proposals. |
| `adaptive-master-architect` | Maintains a per-project tech radar (adopt / trial / assess / hold) + 12–24 month foresight brief. |

### OSS hygiene + delivery

| Skill | Purpose |
| --- | --- |
| `github-delivery` | Commit, push, PR, code-review, CI triage workflow. |
| `secure-commit-guard` | Pre-commit + pre-push secret scanning, dependency audit, signed commits. Closes the manual `.env`-leak audit gap. |
| `release-management` | SemVer, Conventional Commits, changelog automation, signed releases, blue-green/canary, one-command rollback. |
| `open-source-launch` | LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, governance, issue / PR templates, funding. |
| `security-validation` | Threat modelling, attack-path analysis, OSS-tool-grade security scans. |
| `devops-cicd-pipeline` | lint → test → SAST/SCA/secret-scan → SBOM → cosign signing → canary deploy → rollback. Useful when CI lands. |

### Frontend + design

| Skill | Purpose |
| --- | --- |
| `build-web-apps-suite` | Frontend app implementation, perf guidance. (We use vanilla JS — applies to bundling-free workflows too.) |
| `awesome-design-md` | UI / UX reference patterns. We already adapt the Linear + ElevenLabs systems for the dark canvas. |
| `gpt-taste` | Premium motion + UI taste. Aligned with the dark-canvas + lavender accent. |

### Backend / API quality

| Skill | Purpose |
| --- | --- |
| `api-contract-design` | Contract-first REST/GraphQL/gRPC/WebSocket with versioning, error model, idempotency, SDK generation. Useful for the OpenAI-compat endpoints (`/v1/chat/completions`, `/v1/audio/transcriptions`, etc.). |
| `observability-stack` | OpenTelemetry-first logs / metrics / traces / errors / dashboards / SLO alerts. Useful for the FastAPI + idn-tts services. |

### 9Router gateway context

These model cards explain the live gateway endpoints this dashboard sits on
top of, so AI agents picking up the project know which provider IDs / model
formats / response shapes to use without hitting docs.

The canonical source is the **vendored snapshot** at `vendor/9router-skills/`
(committed). It is built from upstream
[decolua/9router](https://github.com/decolua/9router); see
`vendor/9router-skills/UPSTREAM.yaml` for the exact commit + tag.

A fresh clone of WY-NineXore-AI is **self-contained** — no separate
`9router-skills-source` checkout is required. To refresh the snapshot from
upstream when the gateway adds providers, run:

```bash
bash scripts/sync-9router-skills.sh --pull
git add vendor/9router-skills
git commit -m "chore: refresh 9router skills snapshot"
```

| Skill | Purpose |
| --- | --- |
| `9router` | Setup + auth notes for the gateway. |
| `9router-chat` | `/v1/chat/completions` flow, streaming, tool calling. |
| `9router-tts` | `/v1/audio/speech` voice IDs across OpenAI / ElevenLabs / Edge / Google / Deepgram / Inworld / Coqui / Tortoise / NVIDIA / Cartesia / PlayHT / MiniMax. |
| `9router-stt` | `/v1/audio/transcriptions` for OpenAI / Groq / Gemini / Deepgram / AssemblyAI / NVIDIA / HuggingFace. |
| `9router-embeddings` | `/v1/embeddings`. |
| `9router-image` | `/v1/images/generations` and edit endpoints. |
| `9router-web-fetch` | `/v1/web/fetch`. |
| `9router-web-search` | `/v1/web/search`. |


### Skipped (don't apply to a localhost dev tool)

These exist in the upstream pack but are deliberately **not** installed here:

- `saas-product-lifecycle`, `grand-saas-orchestrator` — not a SaaS product.
- `bmad-suite` — full-PRD / sprint planning is overkill for a personal dev console.
- `database-engineering`, `database-safety-guardrail` — only SQLite, single-user, local.
- `auth-identity` — no user auth, runs only on `127.0.0.1`.
- `legal-compliance` — no users, no PII processing.
- `disaster-recovery` — no live production system to recover.
- `web-app-hardening` — no public web exposure, binds to localhost.
- `landing-page-marketing` — no marketing site (yet).
- `skillui-generator`, `skillui-desktop` — design system already extracted.
- `academic-research-suite`, `autoresearch-suite`, `research-paper-writing` — not academic.

If WY NineXore AI ever grows a hosted version, a marketing landing, or a
multi-user backend, switch profile to `saas-grand` (or pick from the skipped
list explicitly).

## How to install

The custom profile lives in the upstream pack at
`profiles/wy-nine-xore-local-tool/skills.list`.

```bash
# 1. Clone the my-grand-project-skills pack once.
git clone https://github.com/Wayan123/my-grand-project-skills.git \
    ~/AI/my-grand-project-skills

# 2. From the project root, run the wrapper. The 9Router skill cards are
#    served from the vendored snapshot at vendor/9router-skills/, so no
#    separate decolua/9router clone is needed for a stock install.
bash scripts/install-skills.sh
```

Flags forwarded to the upstream bootstrap: `--dry-run`, `--force`,
`--verbose`, `--no-deps`, `--no-conflicts`.

Override source paths with `GRAND_SKILLS_REPO=/path/to/clone` or
`NINEROUTER_SKILLS_REPO=/path/to/clone` env vars. The 9Router source order
of preference is: vendored snapshot → `NINEROUTER_SKILLS_REPO` clone.

Smart-sync rules apply (see the upstream README): unchanged skills are
skipped, older ones upgraded with a backup taken first, newer or diverged
local copies are preserved. A decision report is written to
`.agents/skills/.install-report.yaml` and a conflict report to
`.agents/skills/.conflicts-report.yaml`.

## How to upgrade later

```bash
# Refresh the my-grand-project-skills clone, then re-run the installer.
cd ~/AI/my-grand-project-skills && git pull
cd /path/to/WY-NineXore-AI
bash scripts/install-skills.sh           # smart-sync (keeps customisations)
# or, force overwrite even on diverged local copies (a backup is taken):
bash scripts/install-skills.sh --force

# Refresh the vendored 9Router skill snapshot when the gateway adds new
# providers or endpoints. Requires a clone of decolua/9router somewhere
# (default: ~/AI/9router-skills-source).
bash scripts/sync-9router-skills.sh --pull
git add vendor/9router-skills
git commit -m "chore: refresh 9router skills snapshot"
```

The skill-evolution-engine itself will surface a one-line notice when an
audit is due — it never auto-runs.

## Privacy

`.agents/skills/` is gitignored. Skills, install reports, conflict
reports, and any per-skill state files (e.g. `.skill-evolution/`,
`.adaptive-architect/`) all stay local.
