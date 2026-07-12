"""
Redis client for real-time production progress pub/sub.
Channel pattern: studio:progress:{production_id}
"""

from __future__ import annotations
import json
from typing import Any, AsyncGenerator
import redis.asyncio as aioredis
from .config import get_settings

cfg = get_settings()

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            cfg.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis


def _channel(production_id: str) -> str:
    return f"studio:progress:{production_id}"


async def publish_progress(production_id: str, payload: dict[str, Any]) -> None:
    """Publish a progress update; safe to call even if Redis is not configured."""
    if not cfg.redis_url:
        return
    try:
        r = _get_redis()
        await r.publish(_channel(production_id), json.dumps(payload))
        # Also store last state for late subscribers
        await r.setex(
            f"studio:last_progress:{production_id}",
            ex=3600,  # 1 hour TTL
            value=json.dumps(payload),
        )
    except Exception:
        pass  # Redis is optional — don't break the workflow


async def get_last_progress(production_id: str) -> dict[str, Any] | None:
    if not cfg.redis_url:
        return None
    try:
        r = _get_redis()
        raw = await r.get(f"studio:last_progress:{production_id}")
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def subscribe_progress(production_id: str) -> AsyncGenerator[dict[str, Any], None]:
    """
    Async generator that yields progress events.
    Used by the SSE endpoint.
    """
    if not cfg.redis_url:
        return

    r = aioredis.from_url(cfg.redis_url, encoding="utf-8", decode_responses=True)
    try:
        pubsub = r.pubsub()
        await pubsub.subscribe(_channel(production_id))
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    yield json.loads(message["data"])
                except Exception:
                    pass
    finally:
        await r.aclose()
