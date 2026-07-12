"""Environment configuration for the Studio service."""

import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class StudioSettings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8001
    debug: bool = False

    # Node server shared secret (validates proxied requests)
    studio_internal_secret: str = os.getenv("STUDIO_INTERNAL_SECRET", "change-me-in-prod")

    # OpenAI
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    openai_editor_model: str = os.getenv("OPENAI_EDITOR_MODEL", "gpt-4o")

    # Temporal
    temporal_address: str = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")
    temporal_namespace: str = os.getenv("TEMPORAL_NAMESPACE", "studio")
    temporal_task_queue: str = "studio-production"

    # TTS
    tts_provider: str = os.getenv("STUDIO_TTS_PROVIDER", "elevenlabs")
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "")
    elevenlabs_model_id: str = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
    elevenlabs_default_voice_id: str = os.getenv("ELEVENLABS_DEFAULT_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    azure_tts_key: str = os.getenv("AZURE_TTS_KEY", "")
    azure_tts_region: str = os.getenv("AZURE_TTS_REGION", "eastus")

    # Lip sync
    lipsync_provider: str = os.getenv("STUDIO_LIPSYNC_PROVIDER", "rhubarb")
    rhubarb_path: str = os.getenv("RHUBARB_PATH", "/usr/local/bin/rhubarb")

    # Rendering
    blender_path: str = os.getenv("STUDIO_BLENDER_PATH", "/usr/bin/blender")
    ffmpeg_path: str = os.getenv("STUDIO_FFMPEG_PATH", "/usr/bin/ffmpeg")
    render_output_dir: str = os.getenv("STUDIO_RENDER_OUTPUT_DIR", "/tmp/pawsmemories/renders")
    preview_width: int = int(os.getenv("STUDIO_PREVIEW_WIDTH", "640"))
    preview_height: int = int(os.getenv("STUDIO_PREVIEW_HEIGHT", "360"))
    worker_concurrency: int = int(os.getenv("STUDIO_WORKER_CONCURRENCY", "2"))

    # S3 / Object storage
    s3_bucket: str = os.getenv("STUDIO_S3_BUCKET", os.getenv("S3_BUCKET", "pawsmemories-studio"))
    aws_access_key_id: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    aws_secret_access_key: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    aws_region: str = os.getenv("AWS_REGION", "us-east-1")
    s3_endpoint_url: str = os.getenv("S3_ENDPOINT_URL", "")  # For S3-compatible (e.g. Cloudflare R2)
    s3_public_base_url: str = os.getenv("S3_PUBLIC_BASE_URL", "")  # CDN base if bucket is public

    # MySQL (shared with Node server)
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: int = int(os.getenv("DB_PORT", "3306"))
    db_user: str = os.getenv("DB_USER", "root")
    db_pass: str = os.getenv("DB_PASS", "")
    db_name: str = os.getenv("DB_NAME", "pawsmemories")

    # Redis
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> StudioSettings:
    return StudioSettings()
