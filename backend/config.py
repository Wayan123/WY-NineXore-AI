"""Configuration loaded from .env and process environment."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All knobs live here. Read once at startup."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # upstream
    nineroute_url: str = Field(default="http://localhost:20128", alias="NINEROUTER_URL")
    nineroute_key: str = Field(default="", alias="NINEROUTER_KEY")

    # optional: local Indonesian TTS service (idn-tts/service.py)
    idn_tts_url: str = Field(default="http://localhost:21128", alias="IDN_TTS_URL")
    idn_tts_enabled: bool = Field(default=True, alias="IDN_TTS_ENABLED")

    # this app
    app_host: str = Field(default="127.0.0.1", alias="APP_HOST")
    app_port: int = Field(default=8765, alias="APP_PORT")
    data_dir: str = Field(default="./data", alias="DATA_DIR")
    request_timeout: float = Field(default=180.0, alias="REQUEST_TIMEOUT")

    # default models (empty = auto-pick from /v1/models/*)
    default_chat_model: str = Field(default="", alias="DEFAULT_CHAT_MODEL")
    default_image_model: str = Field(default="", alias="DEFAULT_IMAGE_MODEL")
    default_tts_model: str = Field(default="", alias="DEFAULT_TTS_MODEL")
    default_stt_model: str = Field(default="", alias="DEFAULT_STT_MODEL")
    default_embedding_model: str = Field(default="", alias="DEFAULT_EMBEDDING_MODEL")
    default_search_model: str = Field(default="", alias="DEFAULT_SEARCH_MODEL")
    default_fetch_model: str = Field(default="", alias="DEFAULT_FETCH_MODEL")

    # derived
    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir).expanduser().resolve()
        p.mkdir(parents=True, exist_ok=True)
        (p / "outputs").mkdir(parents=True, exist_ok=True)
        return p

    @property
    def db_path(self) -> Path:
        return self.data_path / "history.db"

    @property
    def outputs_path(self) -> Path:
        return self.data_path / "outputs"

    def auth_header(self) -> dict[str, str]:
        if self.nineroute_key.strip():
            return {"Authorization": f"Bearer {self.nineroute_key.strip()}"}
        return {}

    def public_view(self) -> dict:
        """Sanitised settings for the UI (no raw key)."""
        return {
            "nineroute_url": self.nineroute_url,
            "has_key": bool(self.nineroute_key.strip()),
            "app_host": self.app_host,
            "app_port": self.app_port,
            "idn_tts_url": self.idn_tts_url,
            "idn_tts_enabled": self.idn_tts_enabled,
            "defaults": {
                "chat": self.default_chat_model,
                "image": self.default_image_model,
                "tts": self.default_tts_model,
                "stt": self.default_stt_model,
                "embedding": self.default_embedding_model,
                "search": self.default_search_model,
                "fetch": self.default_fetch_model,
            },
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
