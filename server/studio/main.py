"""
Studio AI Animation Pipeline — FastAPI service
Runs on port 8001 (proxied from Node/Express at /api/studio/*)

Endpoints:
  POST   /studio/productions              → start a new production
  GET    /studio/productions/{id}         → get production status
  POST   /studio/productions/{id}/approve → approve preview, kick off final render
  POST   /studio/productions/{id}/regen   → request scene regeneration
  GET    /studio/productions/{id}/cues    → get EDL cues (for editing)
  PATCH  /studio/productions/{id}/cues/{cue_id} → update a cue
  GET    /studio/productions/{id}/progress → SSE stream of real-time progress
  GET    /studio/productions/{id}/versions → version history
"""

from __future__ import annotations
import json
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import get_settings
from .db import get_db, close_pool
from .redis_client import subscribe_progress, get_last_progress, publish_progress
from .schemas import (
    ProductionStatus, VersionTag, Resolution,
    Cue, EDL,
)
from .workflows.production_workflow import ProductionWorkflow

cfg = get_settings()
app = FastAPI(title="Studio Pipeline", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup() -> None:
    pass


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_pool()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class CreateProductionRequest(BaseModel):
    user_id: str
    pet_id: Optional[str] = None
    original_script: str
    target_duration_ms: int = 30_000
    style: str = "cinematic"
    voice_model: Optional[str] = None
    avatar_asset_ids: List[str] = []
    aspect_ratio: str = "16:9"
    output_resolution: str = "1080p"
    credits_authorized: int = 0


class ApproveProductionRequest(BaseModel):
    resolutions: List[str] = ["1080p"]


class RegenRequest(BaseModel):
    scene_id: str
    edition: str = "cinematic"
    notes: str = ""


class CuePatchRequest(BaseModel):
    instruction: Optional[str] = None
    intensity: Optional[float] = None
    parameters: Optional[Dict[str, Any]] = None
    locked: Optional[bool] = None


# ---------------------------------------------------------------------------
# Temporal client helper
# ---------------------------------------------------------------------------

async def _get_temporal_client():
    from temporalio.client import Client
    return await Client.connect(cfg.temporal_address)


async def _get_workflow_handle(production_id: str):
    client = await _get_temporal_client()
    return client.get_workflow_handle(f"production-{production_id}")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/studio/productions")
async def create_production(req: CreateProductionRequest) -> Dict[str, Any]:
    """
    Start a new AI animation production.
    Launches a Temporal workflow and returns the production_id immediately.
    """
    # Credit check
    credit_cost = _estimate_credits(req)
    if req.credits_authorized < credit_cost:
        raise HTTPException(
            status_code=402,
            detail={"error": "insufficient_credits", "required": credit_cost, "authorized": req.credits_authorized},
        )

    production_id = str(uuid.uuid4())

    # Insert production record
    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO studio_productions
                (production_id, user_id, pet_id, original_script, target_duration_ms,
                 style, voice_model, aspect_ratio, output_resolution, status, credits_cost, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            """,
            (
                production_id, req.user_id, req.pet_id, req.original_script,
                req.target_duration_ms, req.style, req.voice_model,
                req.aspect_ratio, req.output_resolution,
                ProductionStatus.draft.value, credit_cost,
            ),
        )

    # Launch Temporal workflow
    client = await _get_temporal_client()
    await client.start_workflow(
        ProductionWorkflow.run,
        {
            "production_id": production_id,
            "user_id": req.user_id,
            "pet_id": req.pet_id,
            "original_script": req.original_script,
            "target_duration_ms": req.target_duration_ms,
            "style": req.style,
            "voice_model": req.voice_model,
            "avatar_asset_ids": req.avatar_asset_ids,
            "aspect_ratio": req.aspect_ratio,
            "output_resolution": req.output_resolution,
        },
        id=f"production-{production_id}",
        task_queue=cfg.temporal_task_queue,
    )

    return {
        "production_id": production_id,
        "status": ProductionStatus.draft.value,
        "credits_cost": credit_cost,
        "message": "Production started. Poll /studio/productions/{id} for status.",
    }


@app.get("/studio/productions/{production_id}")
async def get_production(production_id: str) -> Dict[str, Any]:
    """Get current production status and metadata."""
    async with get_db() as db:
        row = await db.fetchone(
            "SELECT * FROM studio_productions WHERE production_id = %s",
            (production_id,),
        )
    if not row:
        raise HTTPException(status_code=404, detail="Production not found")

    # Augment with last Redis progress
    progress = await get_last_progress(production_id)
    if progress:
        row["progress"] = progress

    return _serialize(row)


@app.post("/studio/productions/{production_id}/approve")
async def approve_production(production_id: str, req: ApproveProductionRequest) -> Dict[str, Any]:
    """
    Signal the Temporal workflow that the user has approved the preview.
    Triggers final TTS + render + export.
    """
    handle = await _get_workflow_handle(production_id)
    await handle.signal(ProductionWorkflow.approve, req.resolutions)

    async with get_db() as db:
        await db.execute(
            "UPDATE studio_productions SET status = %s, updated_at = NOW() WHERE production_id = %s",
            (ProductionStatus.final_rendering.value, production_id),
        )

    return {"production_id": production_id, "status": ProductionStatus.final_rendering.value}


@app.post("/studio/productions/{production_id}/regen")
async def request_regen(production_id: str, req: RegenRequest) -> Dict[str, Any]:
    """Request a single scene to be regenerated (during approval hold)."""
    handle = await _get_workflow_handle(production_id)
    await handle.signal(ProductionWorkflow.request_scene_regen, req.scene_id, req.edition, req.notes)
    return {"queued": True, "scene_id": req.scene_id}


@app.get("/studio/productions/{production_id}/cues")
async def get_cues(production_id: str, track: Optional[str] = None) -> Dict[str, Any]:
    """Get the current EDL cues for a production (from the latest editor_assembly version)."""
    async with get_db() as db:
        row = await db.fetchone(
            """
            SELECT data FROM studio_versions
            WHERE production_id = %s AND tag = 'editor_assembly'
            ORDER BY created_at DESC LIMIT 1
            """,
            (production_id,),
        )
    if not row:
        raise HTTPException(status_code=404, detail="No EDL found yet for this production")

    edl_data = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]

    if track:
        track_key = f"{track}_track"
        return {"cues": edl_data.get(track_key, []), "track": track}

    return {
        "visual_track": edl_data.get("visual_track", []),
        "sound_track": edl_data.get("sound_track", []),
        "voice_track": edl_data.get("voice_track", []),
    }


@app.patch("/studio/productions/{production_id}/cues/{cue_id}")
async def patch_cue(production_id: str, cue_id: str, req: CuePatchRequest) -> Dict[str, Any]:
    """
    Update a specific cue in the latest EDL.
    Saves a new user_revision version.
    """
    async with get_db() as db:
        row = await db.fetchone(
            """
            SELECT version_id, data FROM studio_versions
            WHERE production_id = %s AND tag IN ('editor_assembly', 'user_revision')
            ORDER BY created_at DESC LIMIT 1
            """,
            (production_id,),
        )
    if not row:
        raise HTTPException(status_code=404, detail="No EDL found")

    edl_data = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]

    updated = False
    for track_key in ("visual_track", "sound_track", "voice_track"):
        for cue in edl_data.get(track_key, []):
            if cue.get("cue_id") == cue_id:
                if req.instruction is not None:
                    cue["instruction"] = req.instruction
                if req.intensity is not None:
                    cue["intensity"] = req.intensity
                if req.parameters is not None:
                    cue.setdefault("parameters", {}).update(req.parameters)
                if req.locked is not None:
                    cue["locked"] = req.locked
                cue["parent_version_id"] = row["version_id"]
                updated = True
                break

    if not updated:
        raise HTTPException(status_code=404, detail=f"Cue {cue_id} not found")

    # Save new revision
    async with get_db() as db:
        new_version_id = str(uuid.uuid4())
        await db.execute(
            """
            INSERT INTO studio_versions (version_id, production_id, tag, data, created_at)
            VALUES (%s, %s, 'user_revision', %s, NOW())
            """,
            (new_version_id, production_id, json.dumps(edl_data)),
        )

    return {"updated": True, "cue_id": cue_id, "version_id": new_version_id}


@app.get("/studio/productions/{production_id}/progress")
async def progress_stream(production_id: str) -> StreamingResponse:
    """
    Server-Sent Events stream for real-time production progress.
    Clients connect with EventSource('/api/studio/productions/{id}/progress').
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        # Send last known state immediately
        last = await get_last_progress(production_id)
        if last:
            yield f"data: {json.dumps(last)}\n\n"

        async for event in subscribe_progress(production_id):
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("status") in ("done", "failed"):
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/studio/productions/{production_id}/versions")
async def get_versions(production_id: str) -> Dict[str, Any]:
    """Get all version snapshots for a production."""
    async with get_db() as db:
        rows = await db.fetchall(
            """
            SELECT version_id, tag, created_at
            FROM studio_versions
            WHERE production_id = %s
            ORDER BY created_at ASC
            """,
            (production_id,),
        )
    return {"versions": [_serialize(r) for r in rows]}


@app.get("/studio/productions/{production_id}/versions/{version_id}")
async def get_version_data(production_id: str, version_id: str) -> Dict[str, Any]:
    """Get full data for a specific version."""
    async with get_db() as db:
        row = await db.fetchone(
            "SELECT * FROM studio_versions WHERE version_id = %s AND production_id = %s",
            (version_id, production_id),
        )
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    result = _serialize(row)
    if isinstance(result.get("data"), str):
        result["data"] = json.loads(result["data"])
    return result


@app.get("/studio/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "studio-pipeline"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _estimate_credits(req: CreateProductionRequest) -> int:
    """Rough credit cost estimate: base + duration factor + resolution factor."""
    base = 50
    duration_factor = max(1, req.target_duration_ms // 10_000)  # per 10s
    res_costs = {"480p": 1, "720p": 2, "1080p": 3, "1440p": 5, "4k": 8}
    res_factor = res_costs.get(req.output_resolution, 3)
    return base * duration_factor * res_factor


def _serialize(row: dict) -> dict:
    """Make a DB row JSON-serializable."""
    import datetime
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime.datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out
