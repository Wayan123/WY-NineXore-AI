"""ffmpeg helpers for the short-video pipeline.

Two operations:

1. ``compose_scene_clip(image_path, audio_path, out_path, fps=30)``
   Loop a still image while audio plays. Audio length defines the clip
   length. Encoded as h264 / aac mp4 with sane defaults so the result is
   web-playable everywhere.

2. ``concat_clips(clip_paths, out_path)``
   Stitch multiple mp4 clips into one final video. Uses the demuxer
   concat strategy with a temp filelist, which avoids re-encoding when
   the source clips share codec/timebase (they do, since we built them
   in step 1).

Both functions raise ``FfmpegError`` on a non-zero exit code so the
caller can surface a useful error to the user.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Iterable

logger = logging.getLogger("video.ffmpeg")


class FfmpegError(RuntimeError):
    """Raised when an ffmpeg invocation exits non-zero."""


def _ffmpeg_bin() -> str:
    bin_ = shutil.which("ffmpeg")
    if not bin_:
        raise FfmpegError(
            "ffmpeg not found on PATH. Install it: 'sudo apt install ffmpeg' "
            "(Ubuntu/Debian) or 'brew install ffmpeg' (macOS)."
        )
    return bin_


def _run(args: list[str], *, label: str) -> None:
    """Run ffmpeg, raising FfmpegError on failure."""
    logger.debug("ffmpeg [%s]: %s", label, " ".join(args))
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, check=False
        )
    except FileNotFoundError as e:
        raise FfmpegError(str(e)) from e
    if result.returncode != 0:
        # Tail the last 600 chars of stderr to keep error messages tractable.
        tail = (result.stderr or "")[-600:].strip()
        raise FfmpegError(f"ffmpeg [{label}] failed (rc={result.returncode}): {tail}")


def is_ffmpeg_available() -> bool:
    """Cheap availability probe used by the pipeline status endpoint."""
    return shutil.which("ffmpeg") is not None


def compose_scene_clip(
    image_path: Path,
    audio_path: Path,
    out_path: Path,
    *,
    width: int,
    height: int,
    fps: int = 30,
) -> Path:
    """Build a single mp4 from a still image + audio.

    The image is looped, scaled and padded to `width x height` (so a
    square source image works in 9:16 or 16:9 layouts without distortion),
    audio length defines the clip length (``-shortest``).
    """
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    if not audio_path.is_file():
        raise FileNotFoundError(audio_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Scale-and-pad keeps the source aspect intact and centers it on a
    # black background. The end-of-frame fade is purely cosmetic so the
    # transition into the next clip is gentler than a hard cut.
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"setsar=1,format=yuv420p,fps={fps}"
    )

    args = [
        _ffmpeg_bin(),
        "-y",
        "-loop", "1",
        "-framerate", str(fps),
        "-i", str(image_path),
        "-i", str(audio_path),
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "stillimage",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ac", "2",
        "-ar", "44100",
        "-shortest",
        "-movflags", "+faststart",
        str(out_path),
    ]
    _run(args, label=f"scene→{out_path.name}")
    return out_path


def concat_clips(clip_paths: Iterable[Path], out_path: Path) -> Path:
    """Concatenate per-scene clips into one final mp4 without re-encoding.

    Uses ffmpeg's demuxer-concat protocol via a temp filelist. The source
    clips must share codec/timebase, which is true when they all came
    from compose_scene_clip with identical w/h/fps.
    """
    paths = [Path(p) for p in clip_paths]
    if not paths:
        raise ValueError("concat_clips: no inputs given")
    for p in paths:
        if not p.is_file():
            raise FileNotFoundError(p)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    listfile = out_path.parent / (out_path.stem + ".filelist.txt")
    listfile.write_text(
        "\n".join(f"file {str(p.resolve()).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))!r}"
                  for p in paths) + "\n",
        encoding="utf-8",
    )

    args = [
        _ffmpeg_bin(),
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(listfile),
        "-c", "copy",
        "-movflags", "+faststart",
        str(out_path),
    ]
    try:
        _run(args, label=f"concat→{out_path.name}")
    finally:
        try:
            listfile.unlink(missing_ok=True)
        except Exception:
            pass
    return out_path


# --- aspect-ratio helpers --------------------------------------------------

ASPECT_PRESETS: dict[str, tuple[int, int]] = {
    "1:1":  (1024, 1024),
    "16:9": (1280, 720),
    "9:16": (720, 1280),
    "4:5":  (1024, 1280),
    "5:4":  (1280, 1024),
}

DEFAULT_ASPECT = "1:1"


def resolve_aspect(aspect: str | None) -> tuple[int, int]:
    """Map an aspect string ('9:16') to (width, height). Falls back to 1:1."""
    if not aspect:
        return ASPECT_PRESETS[DEFAULT_ASPECT]
    return ASPECT_PRESETS.get(aspect, ASPECT_PRESETS[DEFAULT_ASPECT])
