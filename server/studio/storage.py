"""
S3-compatible storage helpers.
Compatible with AWS S3, Backblaze B2, Cloudflare R2, or any S3-API provider.
"""

from __future__ import annotations
import asyncio
from functools import lru_cache
from typing import Optional
import aioboto3
from .config import get_settings

cfg = get_settings()


@lru_cache(maxsize=1)
def _session() -> aioboto3.Session:
    return aioboto3.Session(
        aws_access_key_id=cfg.aws_access_key_id,
        aws_secret_access_key=cfg.aws_secret_access_key,
        region_name=cfg.aws_region,
    )


async def upload_file(
    key: str,
    data: bytes,
    content_type: str = "application/octet-stream",
    public: bool = False,
) -> str:
    """Upload bytes to S3 and return the public/presigned URL."""
    session = _session()
    kwargs: dict = {}
    if cfg.s3_endpoint_url:
        kwargs["endpoint_url"] = cfg.s3_endpoint_url

    async with session.client("s3", **kwargs) as s3:
        extra_args: dict = {"ContentType": content_type}
        if public:
            extra_args["ACL"] = "public-read"

        await s3.put_object(
            Bucket=cfg.s3_bucket,
            Key=key,
            Body=data,
            **extra_args,
        )

    s3_public_base = getattr(cfg, "s3_public_base_url", "") or ""
    if public or s3_public_base:
        base = s3_public_base.rstrip("/")
        return f"{base}/{key}"

    # Return a presigned URL valid for 7 days
    return await _presign(key, expires=604_800)


async def _presign(key: str, expires: int = 3600) -> str:
    session = _session()
    kwargs: dict = {}
    if cfg.s3_endpoint_url:
        kwargs["endpoint_url"] = cfg.s3_endpoint_url

    async with session.client("s3", **kwargs) as s3:
        url = await s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": cfg.s3_bucket, "Key": key},
            ExpiresIn=expires,
        )
    return url


async def download_file(key: str) -> bytes:
    session = _session()
    kwargs: dict = {}
    if cfg.s3_endpoint_url:
        kwargs["endpoint_url"] = cfg.s3_endpoint_url

    async with session.client("s3", **kwargs) as s3:
        resp = await s3.get_object(Bucket=cfg.s3_bucket, Key=key)
        return await resp["Body"].read()


async def file_exists(key: str) -> bool:
    session = _session()
    kwargs: dict = {}
    if cfg.s3_endpoint_url:
        kwargs["endpoint_url"] = cfg.s3_endpoint_url

    try:
        async with session.client("s3", **kwargs) as s3:
            await s3.head_object(Bucket=cfg.s3_bucket, Key=key)
        return True
    except Exception:
        return False


async def delete_file(key: str) -> None:
    session = _session()
    kwargs: dict = {}
    if cfg.s3_endpoint_url:
        kwargs["endpoint_url"] = cfg.s3_endpoint_url

    async with session.client("s3", **kwargs) as s3:
        await s3.delete_object(Bucket=cfg.s3_bucket, Key=key)
