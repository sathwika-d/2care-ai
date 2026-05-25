from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # App
    app_name: str = "MedVoice"
    environment: str = "development"
    debug: bool = True

    # Database
    database_url: str = "postgresql+asyncpg://medvoice:medvoice_secret@localhost:5432/medvoice_db"

    # Redis
    redis_url: str = "redis://localhost:6379"
    session_ttl_seconds: int = 1800  # 30 minutes

    # AI Services
    anthropic_api_key: str = ""
    deepgram_api_key: str = ""
    elevenlabs_api_key: str = ""

    # Claude
    claude_model: str = "claude-sonnet-4-20250514"
    max_tokens: int = 1024

    # Latency targets
    target_latency_ms: int = 450

    # STT confidence threshold for fallback
    stt_confidence_threshold: float = 0.80

    model_config = {"env_file": ".env", "case_sensitive": False}


settings = Settings()
