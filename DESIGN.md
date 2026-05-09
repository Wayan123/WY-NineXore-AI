---
name: Nine Workbench
description: >
  A near-black developer-workbench canvas for the 9Router AI gateway. Reads as a
  technical tool document, not a consumer app. The base is an almost-black
  #08090a with warm-off-white #f7f8f8 ink; a single soft-lavender #8b90f0 accent
  marks active states, focus rings, and the "voice is speaking" beat. Type is
  Inter throughout with tight negative tracking on display sizes — no licensed
  serifs, no atmospheric gradients, no terracotta warmth. Cards live as charcoal
  panels with 1px hairlines; audio rows borrow ElevenLabs' waveform-card motif
  for TTS surfaces. The dashboard feels like a private studio console, not a
  marketing page.

colors:
  # canvas
  canvas:          "#08090a"
  canvas-2:        "#0b0c0e"
  surface-1:       "#0f1113"
  surface-2:       "#16181b"
  surface-3:       "#1b1e22"

  # hairlines
  hairline:        "#1e2024"
  hairline-strong: "#2a2d33"
  hairline-soft:   "#17191c"

  # ink
  ink:             "#f7f8f8"
  ink-muted:       "#c7cbd1"
  ink-subtle:      "#8a8f98"
  ink-tertiary:    "#5c6067"
  ink-disabled:    "#404348"

  # single accent
  accent:          "#8b90f0"
  accent-strong:   "#a0a6ff"
  accent-ink:      "#0a0a10"
  accent-bg:       "rgba(139, 144, 240, 0.12)"
  accent-bg-strong:"rgba(139, 144, 240, 0.22)"

  # semantic
  good:            "#34d399"
  good-bg:         "rgba(52, 211, 153, 0.12)"
  warn:            "#fbbf24"
  warn-bg:         "rgba(251, 191, 36, 0.12)"
  bad:             "#f87171"
  bad-bg:          "rgba(248, 113, 113, 0.14)"

typography:
  display-lg:
    fontFamily: "'Inter', 'Inter Display', system-ui, sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.64px
  display-md:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.4px
  title-lg:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.18px
  title-md:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: -0.1px
  body-md:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-strong:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: 0
  body-sm:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.1px
  caption-uppercase:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 1.1px
    textTransform: uppercase
  button:
    fontFamily: "'Inter', system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5

rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 20px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

components:
  app-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
  sidebar:
    backgroundColor: "{colors.canvas}"
    borderRight: "1px {colors.hairline}"
    width: 224px
  sidebar-item:
    backgroundColor: transparent
    textColor: "{colors.ink-subtle}"
    hoverTextColor: "{colors.ink}"
    hoverBackgroundColor: "{colors.surface-1}"
    activeBackgroundColor: "{colors.surface-2}"
    activeTextColor: "{colors.ink}"
    activeLeftIndicator: "2px {colors.accent}"
    typography: "{typography.body-sm}"
    padding: 6px 10px
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface-1}"
    borderColor: "{colors.hairline}"
    borderWidth: 1px
    rounded: "{rounded.lg}"
    padding: 16px
  card-elevated:
    backgroundColor: "{colors.surface-2}"
    borderColor: "{colors.hairline-strong}"
    borderWidth: 1px
    rounded: "{rounded.lg}"
    padding: 20px
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    hoverBackgroundColor: "{colors.accent-strong}"
    typography: "{typography.button}"
    padding: 7px 14px
    height: 32px
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink-subtle}"
    hoverTextColor: "{colors.ink}"
    hoverBackgroundColor: "{colors.surface-1}"
    typography: "{typography.button}"
    padding: 7px 14px
    height: 32px
    rounded: "{rounded.md}"
  button-outline:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline-strong}"
    hoverBorderColor: "{colors.accent}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline-strong}"
    focusBorderColor: "{colors.accent}"
    focusRing: "0 0 0 3px {colors.accent-bg}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 8px 12px
    height: 34px
  badge-pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption-uppercase}"
    rounded: "{rounded.pill}"
    padding: 3px 10px
  badge-accent:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.accent-strong}"
    typography: "{typography.caption-uppercase}"
    rounded: "{rounded.pill}"
    padding: 3px 10px
  indicator-dot:
    size: 6px
    rounded: "{rounded.pill}"
    goodColor: "{colors.good}"
    badColor: "{colors.bad}"
    warnColor: "{colors.warn}"
    idleColor: "{colors.ink-tertiary}"
  audio-waveform-card:
    backgroundColor: "{colors.surface-2}"
    borderColor: "{colors.hairline-strong}"
    borderWidth: 1px
    rounded: "{rounded.xl}"
    padding: 16px
    accentGlow: "radial-gradient(circle at 10% 20%, {colors.accent-bg-strong}, transparent 60%)"
  voice-icon-circular:
    backgroundColor: "{colors.surface-2}"
    borderColor: "{colors.accent}"
    borderWidth: 1px
    rounded: "{rounded.pill}"
    size: 32px
  callout:
    backgroundColor: "{colors.surface-1}"
    borderLeft: "2px {colors.accent}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 10px 14px
  toast:
    backgroundColor: "{colors.surface-2}"
    borderColor: "{colors.hairline-strong}"
    leftRail: "2px {colors.accent}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 10px 14px
    shadow: "0 12px 28px rgba(0,0,0,0.4)"
  code-block:
    backgroundColor: "{colors.canvas-2}"
    textColor: "{colors.ink-muted}"
    borderColor: "{colors.hairline}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: 12px 14px
---

## Overview

The Nine Workbench is a developer console for the 9Router AI gateway. It reads
as a technical instrument — not a marketing site, not a consumer app. The base
canvas is **#08090a** (near-black, slightly cool) holding warm-off-white **#f7f8f8**
ink. A single soft-lavender **#8b90f0** accent marks the brand mark, active tab,
focus ring, and the "voice is speaking" beat — nothing else pulls chromatic
weight. There is no accent color salad, no terracotta warmth, no atmospheric
gradient field.

Type is **Inter** throughout at 400 / 500 / 600 with tight negative tracking on
display sizes (-0.64 to -0.1px). JetBrains Mono (or any ui-monospace) handles
code and model IDs. No licensed fonts. The system has a single serif moment
reserved for nothing — because there is no serif. The engineering vibe
depends on sans precision, not editorial warmth.

Cards live as charcoal panels (`#0f1113`) with 1px hairlines (`#1e2024`). The
TTS surfaces borrow the **audio-waveform-card** pattern: a slightly elevated
surface with a faint accent-colored radial glow, used when a voice is actively
speaking or selected. Voice rows use **voice-icon-circular** — 32px pill
accented with 1px lavender.

## Colors

### Canvas & Surface
- `canvas` **#08090a** — page background. Deepest tier.
- `canvas-2` **#0b0c0e` — code blocks, deeply inset surfaces.
- `surface-1` **#0f1113** — cards, dropdowns, modal backdrop.
- `surface-2` **#16181b** — elevated cards, audio-waveform-card.
- `surface-3` **#1b1e22** — hover state for surface-1.

### Hairlines
- `hairline` **#1e2024** — default 1px divider and card border.
- `hairline-strong` **#2a2d33** — card-elevated and input border.
- `hairline-soft` **#17191c** — dashed separators, very subtle rules.

### Text
- `ink` **#f7f8f8** — primary text, display.
- `ink-muted` **#c7cbd1** — secondary text, metadata.
- `ink-subtle` **#8a8f98** — tertiary labels, inactive nav.
- `ink-tertiary` **#5c6067** — placeholders, disabled idle dots.
- `ink-disabled` **#404348** — disabled input text.

### Accent (only one)
- `accent` **#8b90f0** — soft lavender. Active tab rail, focus ring, primary
  button fill, sidebar-item active left-border, "is speaking" glow, links.
- `accent-strong` **#a0a6ff** — hover state on primary button, pressed links.
- `accent-ink` **#0a0a10** — text on accent (near-black for contrast).
- `accent-bg` — 12% lavender tint for focus rings and subtle backgrounds.
- `accent-bg-strong` — 22% tint for audio-waveform-card glow.

### Semantic
- `good` **#34d399** · `good-bg` 12% — online status, success toasts.
- `warn` **#fbbf24` · `warn-bg` 12% — degraded service, warnings.
- `bad`  **#f87171` · `bad-bg` 14% — errors, destructive buttons.

## Typography

Inter 400/500/600 throughout. JetBrains Mono (or ui-monospace fallback) for
model IDs, code, and file paths. Display sizes pull tight negative tracking
(-0.1 to -0.64px) — the engineering-tool signature.

| Token | Size | Weight | LH | Tracking | Use |
|---|---|---|---|---|---|
| `display-lg` | 32px | 600 | 1.1 | -0.64 | Page H1 |
| `display-md` | 24px | 600 | 1.15 | -0.4  | Section heads |
| `title-lg`   | 18px | 600 | 1.3  | -0.18 | Card title |
| `title-md`   | 15px | 600 | 1.35 | -0.1  | Group header |
| `body-md`    | 14px | 400 | 1.55 | 0     | Default body |
| `body-strong`| 14px | 500 | 1.55 | 0     | Emphasized body |
| `body-sm`    | 13px | 400 | 1.5  | 0     | Compact body |
| `caption`    | 12px | 400 | 1.4  | 0.1   | Metadata, timestamps |
| `caption-uppercase` | 11px | 600 | 1.3 | 1.1 | `CAPS LOCK` section labels |
| `button`     | 13px | 500 | 1    | 0     | All buttons |
| `mono`       | 12px | 400 | 1.5  | 0     | Model IDs, file paths |

## Layout

- Base unit: 4px. Tokens: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64.
- App shell: **224px sidebar** on the left + fluid main column (max 1280px, 24px padding).
  Status indicators (upstream + idn-tts) live in the **sidebar footer**, not in a
  separate top-bar — the console keeps one persistent chrome zone, not two.
- Card gap inside bands: 16px. Bands: 32–48px separation.
- Chat wrap: 220px sessions sidebar + chat main panel.

## Elevation

There is no multi-tier shadow system. Depth comes from surface tier + hairline.

| Level | Treatment |
|---|---|
| Canvas | `#08090a`, flat |
| Card | `#0f1113` + 1px `hairline` |
| Card elevated | `#16181b` + 1px `hairline-strong` |
| Audio-waveform | `#16181b` + 1px `hairline-strong` + radial `accent-bg-strong` at 10% 20% |
| Toast / modal | `#16181b` + 1px `hairline-strong` + `0 12px 28px rgba(0,0,0,0.4)` |
| Hover | surface shifts up one tier (e.g. surface-1 → surface-3) |

## Shapes

| Token | Value | Use |
|---|---|---|
| `xs` 4  | tiny tags |
| `sm` 6  | compact rows, audio-row background |
| `md` 8  | buttons, inputs |
| `lg` 10 | default card |
| `xl` 14 | audio-waveform-card |
| `pill` | badges, voice icon circles, indicator dots |

Pill geometry is reserved for circular voice icons, status dots, and badges —
not for primary buttons. Primary buttons use `md` (8px) for the engineering
feel, not ElevenLabs' pill shape.

## Components

### App shell
224px sidebar on the left + fluid main (max 1280px, 24px padding). The sidebar
footer holds the upstream + idn-tts status dots and the current upstream URL.
No second top-bar; one chrome zone is enough for a single-user console.

### Sidebar
224px dark canvas, 1px right hairline. Section labels in caption-uppercase.
Items render as `sidebar-item` — padding 6×10, rounded md, 2px lavender left
border when active.

### Card
Default surface unit. `surface-1` + 1px `hairline`, rounded 10px, 16px padding.
Titles live in `title-lg`. Meta rows use `body-sm ink-subtle`.

### Audio-waveform-card
Used on TTS result rows and the "Indonesian TTS online" callout. Elevated
surface + faint accent radial gradient at top-left. Houses a play button, a
waveform glyph (CSS-drawn vertical bars), voice metadata, and an optional
download button.

### Voice-icon-circular
32px circle, `surface-2` fill, 1px `accent` border. Holds two-letter initials
of the speaker in `body-sm 500`.

### Button — primary
Lavender fill with near-black ink. 32px height, 7×14 padding, rounded md.
Hover: shifts to `accent-strong`. Used once per card/section for the canonical
action.

### Button — ghost
Transparent; hover lifts background to `surface-1`. For secondary and
tertiary actions. `ink-subtle` text → `ink` on hover.

### Text input
`surface-1` fill, 1px `hairline-strong` border. Focus shows a 3px lavender
ring (`accent-bg`) and the border shifts to accent. 34px height.

### Indicator dot
6px circle. Good = green, bad = red, warn = amber, idle = `ink-tertiary`.
Appears in the top bar (upstream + idn-tts), on result items, and in the
sidebar footer.

### Callout
10×14 surface-1 card with a 2px lavender left border. Used for non-destructive
status messages — e.g. "Indonesian TTS online", "9Router reconnecting".

### Toast
Bottom-right corner. `surface-2` + `hairline-strong` + 2px left rail in
`accent` (good: `good`, bad: `bad`, warn: `warn`). `0 12px 28px rgba(0,0,0,0.4)`
shadow.

### Modal
Centered, `surface-2` + 1px `hairline-strong` + shadow. 90vh max-height.
Backdrop: `rgba(0,0,0,0.65)` with 4px blur.

## Do's and Don'ts

### Do
- Use the single lavender accent for only the brand mark, active tab, focus
  ring, primary CTA, and "voice is speaking" glow.
- Use surface tiers (canvas → 1 → 2 → 3) for depth; don't add drop shadows
  except on floating elements (toasts, modals).
- Use JetBrains Mono for model IDs, file paths, and prompt fragments.
- Use 2px left borders for active nav and callout — not full backgrounds.
- Keep body text at `ink` or `ink-muted`; use `ink-subtle` for metadata only.

### Don't
- Don't introduce a second accent. Lavender is the only chromatic moment.
- Don't use saturated gradients (mint / peach / rose) — the ElevenLabs orb
  system is borrowed only for the TTS card radial glow, not as decoration
  elsewhere.
- Don't use serif display. Inter 600 with tight tracking carries display.
- Don't use warm beige, paper, or terracotta surfaces. This is a cool dark
  canvas.
- Don't put chromatic color on status text. Status is carried by the 6px
  indicator dot; the text stays in `ink` / `ink-muted`.
- Don't use pill geometry on buttons. Pills belong to badges and voice
  circles.

## Responsive

| Breakpoint | Width | Changes |
|---|---|---|
| Mobile | <720px | Sidebar collapses to hamburger; main fills. |
| Tablet | 720–1024 | Sidebar visible; top-bar compacts |
| Desktop | ≥1024 | Full layout |

Touch target: buttons 32px but with 4px vertical padding around them to
produce a 40px effective hit zone. Audio controls keep 40px minimum.

## Motion

Minimal. 120–180ms `ease-out` on hover color shifts. 200ms fade + 4px rise
on view transitions. Audio-waveform `accent` glow pulses softly when a
synthesis request is inflight (0.9–1.0 alpha over 1200ms). No parallax, no
long curves, no decorative motion on load.

## Agent Prompt Guide

Quick palette for a coding agent:

- background: `#08090a`
- surface: `#0f1113` / `#16181b`
- text: `#f7f8f8` / `#c7cbd1` / `#8a8f98`
- accent (only one): `#8b90f0`
- good/warn/bad dots: `#34d399` / `#fbbf24` / `#f87171`
- font: Inter 400/500/600 + JetBrains Mono for code
- radius: 8px for buttons/inputs, 10px for cards, 14px for audio-waveform
- spacing: 4/8/12/16/20/24/32 scale
- shadows: only for toasts and modals (`0 12px 28px rgba(0,0,0,0.4)`)
- primary button: fill `#8b90f0`, text `#0a0a10`, height 32px, radius 8px

Prompts:
- "Build a developer-console dashboard in the Nine Workbench dark palette."
- "Use the audio-waveform-card pattern for any TTS voice row — surface-2,
  radius 14, faint lavender radial glow at top-left."
- "Active nav items get a 2px lavender left border, not a full background."
