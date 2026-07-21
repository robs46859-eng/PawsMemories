from __future__ import annotations

import hmac
import os
from functools import lru_cache

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from models import LookSpecV1, LooksRequest
from planner import OutlinesLooksPlanner

app = FastAPI(title="Hermes Outlines Looks Worker", docs_url=None, redoc_url=None)


def require_worker_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("HERMES_LOOKS_WORKER_TOKEN", "")
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


@lru_cache(maxsize=1)
def planner() -> OutlinesLooksPlanner:
    return OutlinesLooksPlanner.from_environment()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "schema": "pawsome.look-spec.v1"}


@app.post("/v1/looks/plan", response_model=LookSpecV1, dependencies=[Depends(require_worker_token)])
async def plan_looks(request: LooksRequest) -> LookSpecV1:
    try:
        return await run_in_threadpool(planner().plan, request)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
