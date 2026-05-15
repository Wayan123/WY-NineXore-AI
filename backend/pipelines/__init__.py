"""Video pipeline package — short-video automation that mirrors the
Pixelle-Video flow (topic → script → image per scene → TTS per scene →
ffmpeg compose) using WY NineXore AI's existing primitives.
"""
from .video import VideoJob, VideoJobStore, run_video_job  # noqa: F401
from .ffmpeg import is_ffmpeg_available, ASPECT_PRESETS, DEFAULT_ASPECT  # noqa: F401
