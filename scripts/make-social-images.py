#!/usr/bin/env python3
"""
Generate social-media-ready images for WY NineXore AI.

Outputs go to social-media/images/ (which is .gitignored). Uses only
what's already installed in the torch-gpu conda env (Pillow) plus a
handful of existing screenshots from docs/assets/.

Aspect ratios generated:
  - 1:1   1080x1080  Threads / Instagram feed
  - 9:16  1080x1920  TikTok / Reels / Stories
  - 16:9  1920x1080  YouTube thumbnail / LinkedIn / X banner

Design language mirrors the dashboard:
  canvas       #08090a
  canvas-2     #0b0c0e
  surface-1    #0f1113
  hairline     #1e2024
  ink          #f7f8f8
  ink-muted    #c7cbd1
  ink-subtle   #8a8f98
  accent       #8b90f0
  accent-soft  rgba(139,144,240,0.12)
"""

from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT  = ROOT / "social-media" / "images"
SHOTS = ROOT / "docs" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

# ---- palette --------------------------------------------------------------
CANVAS   = (8, 9, 10)
CANVAS_2 = (11, 12, 14)
SURFACE  = (15, 17, 19)
SURFACE2 = (22, 24, 27)
HAIRLINE = (30, 32, 36)
INK      = (247, 248, 248)
INK_MUTED= (199, 203, 209)
INK_SUB  = (138, 143, 152)
INK_TERT = (116, 122, 131)
ACCENT   = (139, 144, 240)
ACCENT_B = (160, 166, 255)
ACCENT_D = (110, 115, 210)
GOOD     = (52, 211, 153)
WARN     = (251, 191, 36)

# ---- fonts ----------------------------------------------------------------
FONT_PATHS = {
    "sans": [
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    "sans_b": [
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "sans_bb": [
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "mono": [
        "/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ],
    "mono_b": [
        "/usr/share/fonts/truetype/ubuntu/UbuntuMono-B.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    ],
}

def _font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    for p in FONT_PATHS[kind]:
        if Path(p).exists():
            return ImageFont.truetype(p, size=size)
    return ImageFont.load_default()

# ---- helpers --------------------------------------------------------------
def rounded_rect(draw: ImageDraw.ImageDraw, xy, radius: int, fill=None, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

def canvas_img(w: int, h: int, bg=CANVAS) -> Image.Image:
    # Subtle gradient from canvas -> canvas-2 vertical
    base = Image.new("RGB", (w, h), bg)
    grad = Image.new("RGB", (1, h), bg)
    gd = ImageDraw.Draw(grad)
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(CANVAS[0]   * (1 - t * 0.25) + CANVAS_2[0] * (t * 0.25))
        g = int(CANVAS[1]   * (1 - t * 0.25) + CANVAS_2[1] * (t * 0.25))
        b = int(CANVAS[2]   * (1 - t * 0.25) + CANVAS_2[2] * (t * 0.25))
        gd.point((0, y), fill=(r, g, b))
    base.paste(grad.resize((w, h)))
    return base

def accent_glow(img: Image.Image, cx: int, cy: int, radius: int, alpha: int = 48):
    """Soft radial glow of the accent colour."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # draw several circles fading out
    for i in range(12, 0, -1):
        r = int(radius * (i / 12))
        a = int(alpha * (i / 12) ** 2)
        d.ellipse((cx - r, cy - r, cx + r, cy + r),
                  fill=ACCENT + (a,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.35))
    img.paste(layer, (0, 0), layer)

def draw_logo(draw: ImageDraw.ImageDraw, x: int, y: int, size: int = 36, color=ACCENT):
    """Mini bar-chart logo matching the brand mark in the sidebar."""
    # 5 vertical bars with varying heights, centred at (x,y)
    bar_w = max(size // 12, 3)
    gap   = max(size // 10, 3)
    total_w = bar_w * 5 + gap * 4
    heights = [0.15, 0.40, 0.80, 0.55, 0.30]
    start_x = x - total_w // 2
    for i, h_frac in enumerate(heights):
        bh = int(size * h_frac)
        bx = start_x + i * (bar_w + gap)
        draw.rounded_rectangle(
            (bx, y + size // 2 - bh, bx + bar_w, y + size // 2),
            radius=bar_w // 2, fill=color,
        )

def text_w(draw, s, font):
    bbox = draw.textbbox((0, 0), s, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]

def centered_text(draw, cx, y, text, font, fill=INK):
    tw, _ = text_w(draw, text, font)
    draw.text((cx - tw // 2, y), text, font=font, fill=fill)

def tag(draw, x, y, text, font, fg=ACCENT, bg=None, pad_x=14, pad_y=6, radius=18):
    tw, th = text_w(draw, text, font)
    w = tw + pad_x * 2
    h = th + pad_y * 2
    if bg is None:
        bg_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        bd = ImageDraw.Draw(bg_img)
        bd.rounded_rectangle((0, 0, w, h), radius=radius,
                             fill=ACCENT + (30,), outline=ACCENT + (100,), width=1)
        # paste onto main via draw's image
        base = draw._image if hasattr(draw, "_image") else None
        if base is not None:
            base.paste(bg_img, (x, y), bg_img)
    else:
        draw.rounded_rectangle((x, y, x + w, y + h), radius=radius, fill=bg)
    draw.text((x + pad_x, y + pad_y - 1), text, font=font, fill=fg)
    return w, h

def paste_screenshot(img: Image.Image, path: Path, box: tuple[int, int, int, int], radius: int = 16):
    """Paste a screenshot with rounded corners into box=(x,y,w,h)."""
    if not path.exists():
        return
    shot = Image.open(path).convert("RGB")
    x, y, w, h = box
    # cover-fit
    sw, sh = shot.size
    ratio = max(w / sw, h / sh)
    nw, nh = int(sw * ratio), int(sh * ratio)
    shot = shot.resize((nw, nh), Image.LANCZOS)
    shot = shot.crop(((nw - w) // 2, (nh - h) // 2, (nw - w) // 2 + w, (nh - h) // 2 + h))
    # rounded mask
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    img.paste(shot, (x, y), mask)
    # hairline border
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x, y, x + w, y + h), radius=radius,
                        outline=HAIRLINE, width=2)

# =========================================================================
# 1. SQUARE MAIN (1080x1080) — launch hero
# =========================================================================
def make_square_main() -> Path:
    W = H = 1080
    img = canvas_img(W, H)
    accent_glow(img, W // 2, 200, 380, alpha=70)
    accent_glow(img, 100, H - 120, 260, alpha=40)

    d = ImageDraw.Draw(img)

    # top badge
    f_tag = _font("sans_b", 22)
    tag(d, 80, 80, "open-source · local · offline-capable", f_tag)

    # logo + brand
    draw_logo(d, 540, 235, size=96)
    f_brand = _font("sans_bb", 78)
    centered_text(d, 540, 305, "WY NineXore AI", f_brand, fill=INK)
    f_sub = _font("sans", 32)
    centered_text(d, 540, 405, "console developer untuk 9Router", f_sub, fill=INK_SUB)

    # feature bullets (centered list, 4 rows)
    f_feat = _font("sans_b", 30)
    f_note = _font("sans", 22)
    rows = [
        ("Chat multi-provider",        "OpenAI · Claude · DeepSeek · NIM · Groq"),
        ("Whisper STT offline",        "tiny · medium · large-v3 (auto-download)"),
        ("TTS Bahasa Indonesia",       "Coqui VITS · 83 suara lokal"),
        ("Vision, OCR, search, embed", "semua di satu dashboard"),
    ]
    y = 510
    for title, note in rows:
        # bullet dot
        d.ellipse((140, y + 14, 160, y + 34), fill=ACCENT)
        d.text((185, y),   title, font=f_feat, fill=INK)
        d.text((185, y+42), note,  font=f_note, fill=INK_SUB)
        y += 96

    # footer URL
    f_url = _font("mono_b", 30)
    centered_text(d, W // 2, H - 90, "github.com/Wayan123/WY-NineXore-AI", f_url, fill=ACCENT_B)
    f_brand_mini = _font("sans", 20)
    centered_text(d, W // 2, H - 48, "dark canvas · single accent · built on 9Router", f_brand_mini, fill=INK_TERT)

    out = OUT / "1-square-main.png"
    img.save(out, "PNG", optimize=True)
    return out

# =========================================================================
# 2. VERTICAL HERO (1080x1920) — TikTok / Reels cover
# =========================================================================
def make_vertical_hero() -> Path:
    W, H = 1080, 1920
    img = canvas_img(W, H)
    accent_glow(img, W // 2, 300, 500, alpha=80)
    accent_glow(img, 200, 1500, 380, alpha=50)

    d = ImageDraw.Draw(img)

    # top hook
    f_hook_s = _font("sans_b", 42)
    f_hook   = _font("sans_bb", 96)
    centered_text(d, W // 2, 180, "POV: kamu punya", f_hook_s, fill=INK_SUB)
    centered_text(d, W // 2, 240, "console AI sendiri", f_hook, fill=INK)
    centered_text(d, W // 2, 360, "di laptop kamu.", f_hook, fill=ACCENT_B)

    # screenshot embed (use home.jpg)
    shot_box = (100, 560, 880, 520)
    paste_screenshot(img, SHOTS / "home.jpg", shot_box, radius=22)
    # outer glow behind shot
    accent_glow(img, W // 2, 820, 320, alpha=30)

    # subtext
    f_sub = _font("sans", 34)
    centered_text(d, W // 2, 1140, "11 panel · dark + light theme", f_sub, fill=INK_MUTED)

    # big feature stack — accent square instead of emoji to stay font-portable
    f_feat_t = _font("sans_bb", 58)
    f_feat_s = _font("sans", 28)
    feats = [
        ("Whisper offline",      "tiny · medium · large-v3"),
        ("TTS Bahasa Indonesia", "83 suara lokal · gak keluar mesin"),
        ("Chat multi-provider",  "OpenAI, Claude, DeepSeek, NIM, Groq"),
    ]
    y = 1230
    for title, note in feats:
        # coloured square marker
        d.rounded_rectangle((90, y + 20, 130, y + 60), radius=10,
                            fill=ACCENT, outline=ACCENT_B, width=2)
        d.text((160, y),     title, font=f_feat_t, fill=INK)
        d.text((160, y + 68), note,  font=f_feat_s, fill=INK_SUB)
        y += 160

    # CTA pill
    f_cta = _font("sans_bb", 42)
    cta = "github.com/Wayan123/WY-NineXore-AI"
    tw, th = text_w(d, cta, f_cta)
    px = (W - tw - 60) // 2
    py = H - 170
    rounded_rect(d, (px, py, px + tw + 60, py + th + 40), radius=60,
                 fill=ACCENT, outline=ACCENT_B, width=3)
    d.text((px + 30, py + 20), cta, font=f_cta, fill=(8, 8, 16))

    f_foot = _font("sans", 22)
    centered_text(d, W // 2, H - 60, "open source · built on 9Router", f_foot, fill=INK_TERT)

    out = OUT / "2-vertical-hero.png"
    img.save(out, "PNG", optimize=True)
    return out

# =========================================================================
# 3. LANDSCAPE HERO (1920x1080) — YouTube thumb / LinkedIn banner
# =========================================================================
def make_landscape_hero() -> Path:
    W, H = 1920, 1080
    img = canvas_img(W, H)
    accent_glow(img, 1500, 300, 520, alpha=60)
    accent_glow(img, 250, 900, 340, alpha=40)

    d = ImageDraw.Draw(img)

    # left column: text
    draw_logo(d, 160, 200, size=80)
    f_brand = _font("sans_bb", 96)
    d.text((220, 160), "WY NineXore AI", font=f_brand, fill=INK)
    f_sub = _font("sans", 42)
    d.text((80, 290), "console developer untuk 9Router", font=f_sub, fill=INK_SUB)

    f_pitch = _font("sans_bb", 52)
    lines = [
        "Chat · Image · TTS · STT",
        "Vision · Search · Embed",
        "semua lokal, 1 dashboard.",
    ]
    y = 420
    for line in lines:
        color = ACCENT_B if "lokal" in line else INK
        d.text((80, y), line, font=f_pitch, fill=color)
        y += 78

    # feature tags row
    f_tag = _font("sans_b", 26)
    tags = ["whisper-large-v3", "coqui-vits-83-voices", "dark+light+system", "fastapi+vanillajs"]
    x = 80
    for t in tags:
        tw, _ = tag(d, x, 740, t, f_tag)
        x += tw + 14

    # CTA URL
    f_url = _font("mono_b", 38)
    d.text((80, 840), "github.com/Wayan123/WY-NineXore-AI", font=f_url, fill=ACCENT_B)
    f_url_sub = _font("sans", 26)
    d.text((80, 900), "clone · ./run.sh · selesai", font=f_url_sub, fill=INK_TERT)

    # right column: dashboard preview stack (home + chat overlay)
    paste_screenshot(img, SHOTS / "home.jpg", (1050, 150, 780, 450), radius=16)
    paste_screenshot(img, SHOTS / "tts.jpg",   (1180, 520, 700, 420), radius=16)

    out = OUT / "3-landscape-hero.png"
    img.save(out, "PNG", optimize=True)
    return out

# =========================================================================
# 4. SQUARE FEATURES (1080x1080) — grid of 4 panels
# =========================================================================
def make_square_features() -> Path:
    W = H = 1080
    img = canvas_img(W, H)
    accent_glow(img, W // 2, 100, 300, alpha=50)
    d = ImageDraw.Draw(img)

    # title
    f_title = _font("sans_bb", 58)
    centered_text(d, W // 2, 70, "11 panel. 1 dashboard.", f_title, fill=INK)
    f_sub = _font("sans", 26)
    centered_text(d, W // 2, 150, "semua AI tool yang kamu butuhin di satu tempat", f_sub, fill=INK_SUB)

    # 2x2 grid of screenshots
    shots = [
        ("chat",    "chat.jpg",    "Chat multi-provider"),
        ("speak",   "tts.jpg",     "TTS 83 suara Indonesia"),
        ("stt",     "stt.jpg",     "Whisper offline (3 varian)"),
        ("vision",  "vision.jpg",  "Vision / OCR"),
    ]
    grid_y = 220
    cell_w = (W - 80 - 30) // 2  # left/right pad 40 + gap 30
    cell_h = 340
    gap = 30
    pad = 40

    f_cap = _font("sans_b", 24)
    for i, (_, file, cap) in enumerate(shots):
        cx = i % 2
        cy = i // 2
        x = pad + cx * (cell_w + gap)
        y = grid_y + cy * (cell_h + gap)
        paste_screenshot(img, SHOTS / file, (x, y, cell_w, cell_h - 50), radius=14)
        # caption strip underneath
        d.text((x + 6, y + cell_h - 40), cap, font=f_cap, fill=INK_MUTED)

    # footer CTA
    f_url = _font("mono_b", 26)
    centered_text(d, W // 2, H - 60,
                  "github.com/Wayan123/WY-NineXore-AI",
                  f_url, fill=ACCENT_B)

    out = OUT / "4-square-features.png"
    img.save(out, "PNG", optimize=True)
    return out

# =========================================================================
# 5. VERTICAL "3 STEPS" (1080x1920)
# =========================================================================
def make_vertical_steps() -> Path:
    W, H = 1080, 1920
    img = canvas_img(W, H)
    accent_glow(img, W // 2, 200, 420, alpha=70)
    d = ImageDraw.Draw(img)

    f_kicker = _font("sans_b", 40)
    centered_text(d, W // 2, 160, "3 LANGKAH", f_kicker, fill=ACCENT_B)
    f_title = _font("sans_bb", 110)
    centered_text(d, W // 2, 220, "Jalanin di", f_title, fill=INK)
    centered_text(d, W // 2, 340, "Laptop Kamu", f_title, fill=INK)

    # step cards
    steps = [
        ("1",
         "git clone",
         "github.com/Wayan123/\nWY-NineXore-AI"),
        ("2",
         "cp .env.example .env",
         "isi NINEROUTER_KEY\ndari 9Router instance kamu"),
        ("3",
         "./run.sh",
         "dashboard jalan di\nhttp://127.0.0.1:8765"),
    ]
    f_num = _font("sans_bb", 110)
    f_cmd = _font("mono_b", 44)
    f_note = _font("sans", 28)
    y = 610
    for num, cmd, note in steps:
        # card bg
        rounded_rect(d, (80, y, W - 80, y + 320), radius=24,
                     fill=SURFACE, outline=HAIRLINE, width=2)
        # number badge
        rounded_rect(d, (120, y + 30, 240, y + 150), radius=60,
                     fill=ACCENT, outline=ACCENT_B, width=2)
        bbox = d.textbbox((0, 0), num, font=f_num)
        nw = bbox[2] - bbox[0]; nh = bbox[3] - bbox[1]
        d.text((120 + (120 - nw) // 2, y + 30 + (120 - nh) // 2 - 10),
               num, font=f_num, fill=(10, 10, 24))
        # command
        d.text((290, y + 50), cmd, font=f_cmd, fill=INK)
        # note (multi-line)
        for i, ln in enumerate(note.split("\n")):
            d.text((290, y + 140 + i * 42), ln, font=f_note, fill=INK_SUB)
        y += 360

    # footer
    f_foot = _font("sans_b", 34)
    centered_text(d, W // 2, H - 160, "Selesai. Open-source. Gratis.", f_foot, fill=INK)
    f_foot_2 = _font("mono_b", 30)
    centered_text(d, W // 2, H - 100, "github.com/Wayan123/WY-NineXore-AI", f_foot_2, fill=ACCENT_B)
    f_foot_3 = _font("sans", 22)
    centered_text(d, W // 2, H - 58, "★ kalau suka  ·  fork  ·  issues welcome", f_foot_3, fill=INK_TERT)

    out = OUT / "5-vertical-steps.png"
    img.save(out, "PNG", optimize=True)
    return out

# =========================================================================
# 6. SQUARE WHISPER (1080x1080) — feature focus: 3 Whisper variants
# =========================================================================
def make_square_whisper() -> Path:
    W = H = 1080
    img = canvas_img(W, H)
    accent_glow(img, W // 2, 140, 300, alpha=60)
    d = ImageDraw.Draw(img)

    f_kicker = _font("sans_b", 28)
    centered_text(d, W // 2, 80, "TRANSCRIBE · OFFLINE · BAHASA INDONESIA", f_kicker, fill=ACCENT_B)
    f_title = _font("sans_bb", 68)
    centered_text(d, W // 2, 125, "Whisper tanpa cloud.", f_title, fill=INK)
    f_title2 = _font("sans_bb", 68)
    centered_text(d, W // 2, 205, "Pilih sesuai hardware.", f_title2, fill=INK)

    variants = [
        ("tiny",     "~150 MB",  "39 M params", "CPU-friendly · laptop low-spec",  GOOD),
        ("medium",   "~1.5 GB",  "769 M params", "Balanced · CPU atau GPU",         WARN),
        ("large-v3", "~2.9 GB",  "1550 M params", "Akurasi terbaik · butuh GPU",     ACCENT_B),
    ]
    f_var = _font("mono_b", 44)
    f_size = _font("sans_b", 28)
    f_note = _font("sans", 24)
    y = 340
    for name, size, params, note, color in variants:
        # card
        rounded_rect(d, (80, y, W - 80, y + 170), radius=20,
                     fill=SURFACE, outline=HAIRLINE, width=2)
        # colored bar on left
        d.rectangle((80, y, 94, y + 170), fill=color)
        # variant name
        d.text((120, y + 28), f"whisper-{name}", font=f_var, fill=INK)
        # size badge
        f_badge = _font("sans_b", 22)
        tw, _ = text_w(d, size, f_badge)
        bx = W - 80 - 32 - tw
        rounded_rect(d, (bx - 14, y + 32, bx + tw + 14, y + 68),
                     radius=18, fill=None, outline=color, width=2)
        d.text((bx, y + 38), size, font=f_badge, fill=color)
        # params + note
        d.text((120, y + 90), params, font=f_size, fill=INK_MUTED)
        d.text((120, y + 125), note, font=f_note, fill=INK_SUB)
        y += 190

    f_foot = _font("sans_b", 28)
    centered_text(d, W // 2, H - 110, "Auto-download. Progress di UI. Data tetap lokal.",
                  f_foot, fill=INK_MUTED)
    f_url = _font("mono_b", 24)
    centered_text(d, W // 2, H - 60, "github.com/Wayan123/WY-NineXore-AI",
                  f_url, fill=ACCENT_B)

    out = OUT / "6-square-whisper.png"
    img.save(out, "PNG", optimize=True)
    return out


# =========================================================================
# run all
# =========================================================================
def main():
    generators = [
        make_square_main,
        make_vertical_hero,
        make_landscape_hero,
        make_square_features,
        make_vertical_steps,
        make_square_whisper,
    ]
    print(f"Output: {OUT}")
    print()
    for g in generators:
        try:
            path = g()
            size = path.stat().st_size
            img = Image.open(path)
            print(f"  ✓ {path.name:30s} {img.size[0]}x{img.size[1]}   {size/1024:.1f} KB")
        except Exception as e:
            print(f"  ✗ {g.__name__}: {e}")
            import traceback; traceback.print_exc()

if __name__ == "__main__":
    main()
