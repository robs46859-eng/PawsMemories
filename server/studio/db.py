"""
Async MySQL connection pool for the Studio service.
Uses aiomysql for async/await compatibility.
"""

from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator
import aiomysql
from .config import get_settings

cfg = get_settings()

_pool: aiomysql.Pool | None = None
_pool_lock = asyncio.Lock()


async def get_pool() -> aiomysql.Pool:
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is None:
            _pool = await aiomysql.create_pool(
                host=cfg.db_host,
                port=cfg.db_port,
                user=cfg.db_user,
                password=cfg.db_pass,
                db=cfg.db_name,
                autocommit=True,
                minsize=2,
                maxsize=10,
                charset="utf8mb4",
            )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


class DB:
    """Thin async wrapper around an aiomysql connection."""

    def __init__(self, conn: aiomysql.Connection) -> None:
        self._conn = conn

    async def execute(self, sql: str, args: tuple = ()) -> int:
        async with self._conn.cursor() as cur:
            await cur.execute(sql, args)
            return cur.lastrowid or 0

    async def fetchone(self, sql: str, args: tuple = ()) -> dict | None:
        async with self._conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(sql, args)
            return await cur.fetchone()

    async def fetchall(self, sql: str, args: tuple = ()) -> list[dict]:
        async with self._conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(sql, args)
            return await cur.fetchall()

    async def executemany(self, sql: str, args_list: list[tuple]) -> None:
        async with self._conn.cursor() as cur:
            await cur.executemany(sql, args_list)


@asynccontextmanager
async def get_db() -> AsyncGenerator[DB, None]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield DB(conn)
