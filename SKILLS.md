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
# clone the upstream pack once
git clone https://github.com/Wayan123/my-grand-project-skills.git ~/AI/my-grand-project-skills

# from the project root, run the wrapper
bash scripts/install-skills.sh
```

Smart-sync rules apply (see the upstream README): unchanged skills are
skipped, older ones upgraded with a backup taken first, newer or diverged
local copies are preserved. A decision report is written to
`.agents/skills/.install-report.yaml` and a conflict report to
`.agents/skills/.conflicts-report.yaml`.

## How to upgrade later

```bash
cd ~/AI/my-grand-project-skills && git pull
cd /path/to/WY-NineXore-AI
bash scripts/install-skills.sh           # smart-sync (keeps customisations)
# or, force overwrite even on diverged local copies (a backup is taken):
bash scripts/install-skills.sh --force
```

The skill-evolution-engine itself will surface a one-line notice when an
audit is due — it never auto-runs.

## Privacy

`.agents/skills/` is gitignored. Skills, install reports, conflict
reports, and any per-skill state files (e.g. `.skill-evolution/`,
`.adaptive-architect/`) all stay local.
