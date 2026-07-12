"""
Temporal Activity implementations.
Each function here is the actual implementation called by the workflow stubs.
Activities run in worker processes — they can be retried independently.
"""

from __future__ import annotations
import asyncio
import json
import subprocess
import os
import tempfile
from typing import Any, Dict, List
from uuid import uuid4

from temporalio import activity

from ..agents import editor, visual_director, sound_director, voice_director
from ..schemas import (
    SceneManifest, DirectorOutput, EDL, ProductionStatus, VersionTag,
)
from ..config import get_settings
from ..db import get_db
from ..redis_client import publish_progress
from ..adapters.tts import get_tts_adapter
from ..adapters.lipsync import get_lipsync_adapter
from ..storage import upload_file

cfg = get_settings()


# ---------------------------------------------------------------------------
# Agent activities
# ---------------------------------------------------------------------------

@activity.defn
async def build_scene_manifest_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    manifest = await editor.build_scene_manifest(
        production_id=params["production_id"],
        original_script=params["original_script"],
        target_duration_ms=params["target_duration_ms"],
        style=params.get("style", "cinematic"),
    )
    return manifest.model_dump()


@activity.defn
async def run_visual_director_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    manifest = SceneManifest(**params["manifest"])
    output = await visual_director.run(
        production_id=params["production_id"],
        manifest=manifest,
        style=params.get("style", "cinematic"),
        avatar_ids=params.get("avatar_asset_ids", []),
    )
    return output.model_dump()


@activity.defn
async def run_sound_director_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    manifest = SceneManifest(**params["manifest"])
    output = await sound_director.run(
        production_id=params["production_id"],
        manifest=manifest,
        style=params.get("style", "cinematic"),
    )
    return output.model_dump()


@activity.defn
async def run_voice_director_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    manifest = SceneManifest(**params["manifest"])
    output = await voice_director.run(
        production_id=params["production_id"],
        manifest=manifest,
        style=params.get("style", "cinematic"),
        voice_model=params.get("voice_model"),
        avatar_ids=params.get("avatar_asset_ids", []),
    )
    return output.model_dump()


@activity.defn
async def assemble_edl_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    manifest = SceneManifest(**params["manifest"])
    director_outputs = {
        name: DirectorOutput(**data)
        for name, data in params["director_outputs"].items()
    }
    edl = await editor.assemble_edl(
        production_id=params["production_id"],
        manifest=manifest,
        director_outputs=director_outputs,
        style=params.get("style", "cinematic"),
    )
    # Validate timing
    warnings = editor.validate_edl_timing(edl)
    if warnings:
        activity.logger.warning(f"EDL timing warnings: {warnings}")
    return edl.model_dump()


# ---------------------------------------------------------------------------
# TTS and Lip-sync activities
# ---------------------------------------------------------------------------

@activity.defn
async def generate_tts_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Generate TTS audio for every voice cue in the EDL."""
    edl = EDL(**params["edl"])
    tts = get_tts_adapter()
    results: Dict[str, str] = {}  # cue_id -> audio_url

    for cue in edl.voice_track:
        text = cue.parameters.get("text", "")
        if not text:
            continue
        voice_model = cue.parameters.get("voice_model") or cfg.tts_provider
        emotion = cue.parameters.get("emotion", "neutral")

        try:
            audio_bytes = await tts.synthesize(
                text=text,
                voice=voice_model,
                emotion=emotion,
                pacing=cue.parameters.get("pacing"),
                emphasis=cue.parameters.get("emphasis_words", []),
            )
            key = f"productions/{params['production_id']}/tts/{cue.cue_id}.wav"
            url = await upload_file(key, audio_bytes, content_type="audio/wav")
            results[cue.cue_id] = url
        except Exception as e:
            activity.logger.error(f"TTS failed for cue {cue.cue_id}: {e}")

    return {"audio_urls": results}


@activity.defn
async def generate_lipsync_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Generate phoneme/viseme timing for each voice cue."""
    edl = EDL(**params["edl"])
    tts_result = params["tts_result"]
    lipsync = get_lipsync_adapter()
    updated_cues = []

    for cue in edl.voice_track:
        audio_url = tts_result["audio_urls"].get(cue.cue_id)
        if not audio_url:
            updated_cues.append(cue.model_dump())
            continue
        try:
            phoneme_timings = await lipsync.analyze(
                audio_url=audio_url,
                text=cue.parameters.get("text", ""),
                start_ms_offset=cue.start_ms,
            )
            cue_dict = cue.model_dump()
            cue_dict["parameters"]["phoneme_timing"] = [p.model_dump() for p in phoneme_timings]
            updated_cues.append(cue_dict)
        except Exception as e:
            activity.logger.error(f"Lipsync failed for cue {cue.cue_id}: {e}")
            updated_cues.append(cue.model_dump())

    return {"updated_voice_cues": updated_cues}


# ---------------------------------------------------------------------------
# Rendering activities
# ---------------------------------------------------------------------------

@activity.defn
async def render_preview_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Low-resolution Blender preview render."""
    production_id = params["production_id"]
    edl_data = params["edl"]
    manifest_data = params["manifest"]

    out_dir = os.path.join(cfg.render_output_dir, production_id, "preview")
    os.makedirs(out_dir, exist_ok=True)

    # Write EDL and manifest to temp files for Blender script to read
    edl_path = os.path.join(out_dir, "edl.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(edl_path, "w") as f:
        json.dump(edl_data, f)
    with open(manifest_path, "w") as f:
        json.dump(manifest_data, f)

    script_path = os.path.join(os.path.dirname(__file__), "..", "workers", "blender_render_script.py")
    output_path = os.path.join(out_dir, "preview.mp4")

    cmd = [
        cfg.blender_path, "--background",
        "--python", script_path,
        "--",
        "--edl", edl_path,
        "--manifest", manifest_path,
        "--output", output_path,
        "--width", str(cfg.preview_width),
        "--height", str(cfg.preview_height),
        "--fps", "24",
        "--preview",
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        raise RuntimeError(f"Blender preview render failed: {stderr.decode()}")

    # Upload preview to S3
    with open(output_path, "rb") as f:
        preview_bytes = f.read()
    key = f"productions/{production_id}/preview/preview.mp4"
    preview_url = await upload_file(key, preview_bytes, content_type="video/mp4")

    return {"preview_url": preview_url}


@activity.defn
async def render_final_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Full-resolution Blender render (per scene)."""
    production_id = params["production_id"]
    edl_data = params["edl"]
    manifest_data = params["manifest"]
    lipsync_data = params.get("lipsync", {})

    out_dir = os.path.join(cfg.render_output_dir, production_id, "render")
    os.makedirs(out_dir, exist_ok=True)

    edl_path = os.path.join(out_dir, "edl.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    lipsync_path = os.path.join(out_dir, "lipsync.json")

    with open(edl_path, "w") as f:
        json.dump(edl_data, f)
    with open(manifest_path, "w") as f:
        json.dump(manifest_data, f)
    with open(lipsync_path, "w") as f:
        json.dump(lipsync_data, f)

    resolution = params.get("params", {}).get("output_resolution", "1080p")
    width, height = _resolution_to_dims(resolution)
    frames_dir = os.path.join(out_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    script_path = os.path.join(os.path.dirname(__file__), "..", "workers", "blender_render_script.py")

    cmd = [
        cfg.blender_path, "--background",
        "--python", script_path,
        "--",
        "--edl", edl_path,
        "--manifest", manifest_path,
        "--lipsync", lipsync_path,
        "--output", frames_dir,
        "--width", str(width),
        "--height", str(height),
        "--fps", "30",
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        raise RuntimeError(f"Blender final render failed: {stderr.decode()}")

    return {"frames_dir": frames_dir, "width": width, "height": height}


@activity.defn
async def assemble_video_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """FFmpeg assembly: combine frames + audio, export multiple resolutions + stems."""
    from ..workers.ffmpeg_worker import assemble

    result = await assemble(
        production_id=params["production_id"],
        render_result=params["render_result"],
        tts_result=params["tts_result"],
        edl_data=params["edl"],
        resolutions=params.get("resolutions", ["1080p"]),
        production_params=params.get("params", {}),
    )
    return result


# ---------------------------------------------------------------------------
# Persistence activities
# ---------------------------------------------------------------------------

@activity.defn
async def save_version_activity(params: Dict[str, Any]) -> None:
    production_id = params["production_id"]
    tag = params["tag"]
    data = params["data"]

    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO studio_versions (version_id, production_id, tag, data, created_at)
            VALUES (UUID(), %s, %s, %s, NOW())
            """,
            (production_id, tag, json.dumps(data)),
        )


@activity.defn
async def update_production_status_activity(params: Dict[str, Any]) -> None:
    production_id = params["production_id"]
    status = params["status"]
    phase = params.get("phase", "")
    percent = params.get("percent", 0)
    message = params.get("message", phase)

    updates = {"status": status, "updated_at": "NOW()"}
    if "preview_url" in params:
        updates["preview_url"] = params["preview_url"]
    if "render_urls" in params:
        updates["render_urls"] = json.dumps(params["render_urls"])

    set_clause = ", ".join(
        f"{k} = %s" if k != "updated_at" else f"{k} = {v}"
        for k, v in updates.items()
    )
    values = [v for k, v in updates.items() if k != "updated_at"]
    values.append(production_id)

    async with get_db() as db:
        await db.execute(
            f"UPDATE studio_productions SET {set_clause} WHERE production_id = %s",
            values,
        )

    # Publish progress to Redis
    await publish_progress(production_id, {
        "status": status,
        "phase": phase,
        "percent": percent,
        "message": message,
    })


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolution_to_dims(res: str) -> tuple[int, int]:
    mapping = {
        "480p": (854, 480),
        "720p": (1280, 720),
        "1080p": (1920, 1080),
        "1440p": (2560, 1440),
        "4k": (3840, 2160),
    }
    return mapping.get(res, (1920, 1080))
