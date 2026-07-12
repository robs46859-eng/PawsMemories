"""
Temporal Production Workflow

Orchestrates the full animation pipeline:
1. Build scene manifest (Editor AI)
2. Run three directors in parallel (Visual, Sound, Voice)
3. Assemble EDL (Editor AI)
4. Render low-res preview (Blender)
5. [Human approval checkpoint]
6. Generate TTS + lip-sync per voice cue
7. Render full-res (Blender + FFmpeg)
8. Export multi-resolution outputs + stems
"""

from __future__ import annotations
import asyncio
from datetime import timedelta
from typing import Dict, Any, List

from temporalio import workflow, activity
from temporalio.common import RetryPolicy

from ..schemas import (
    ProductionStatus, VersionTag, Resolution,
    SceneManifest, DirectorOutput, EDL,
)


# ---------------------------------------------------------------------------
# Activity stubs (implementations are in activities.py)
# Each activity runs in a separate worker process for true parallelism.
# ---------------------------------------------------------------------------

@activity.defn
async def build_scene_manifest_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Call EditorAI.build_scene_manifest and return serialized SceneManifest."""
    ...

@activity.defn
async def run_visual_director_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Run VisualDirector.run and return serialized DirectorOutput."""
    ...

@activity.defn
async def run_sound_director_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Run SoundDirector.run and return serialized DirectorOutput."""
    ...

@activity.defn
async def run_voice_director_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Run VoiceDirector.run and return serialized DirectorOutput."""
    ...

@activity.defn
async def assemble_edl_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Call EditorAI.assemble_edl and return serialized EDL."""
    ...

@activity.defn
async def render_preview_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Run Blender headless low-res preview render. Returns {preview_url}."""
    ...

@activity.defn
async def generate_tts_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Generate TTS audio for all voice cues. Returns {cue_id: audio_url}."""
    ...

@activity.defn
async def generate_lipsync_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Generate phoneme/viseme timing for voice cues. Returns updated cue list."""
    ...

@activity.defn
async def render_final_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """Blender full-res render. Returns {scene_id: frame_dir}."""
    ...

@activity.defn
async def assemble_video_activity(params: Dict[str, Any]) -> Dict[str, Any]:
    """FFmpeg assembly, mixing, and multi-resolution export. Returns render_urls dict."""
    ...

@activity.defn
async def save_version_activity(params: Dict[str, Any]) -> None:
    """Persist an immutable version snapshot to MySQL."""
    ...

@activity.defn
async def update_production_status_activity(params: Dict[str, Any]) -> None:
    """Update production status in MySQL + publish Redis progress."""
    ...


# ---------------------------------------------------------------------------
# Shared retry policy for AI agent activities
# ---------------------------------------------------------------------------
AI_RETRY = RetryPolicy(
    maximum_attempts=3,
    initial_interval=timedelta(seconds=5),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
)

RENDER_RETRY = RetryPolicy(
    maximum_attempts=2,
    initial_interval=timedelta(seconds=10),
    backoff_coefficient=1.5,
)


# ---------------------------------------------------------------------------
# Main Production Workflow
# ---------------------------------------------------------------------------

@workflow.defn
class ProductionWorkflow:
    """
    Durable Temporal workflow for a single animation production.
    State is persisted — survives process restarts, API failures, long renders.
    """

    def __init__(self):
        self._approval_signal_received = False
        self._scene_regen_requests: List[Dict[str, Any]] = []

    @workflow.signal
    def approve(self, resolutions: List[str]) -> None:
        """User approved the preview — proceed with final render."""
        self._approval_signal_received = True
        self._approval_resolutions = resolutions

    @workflow.signal
    def request_scene_regen(self, scene_id: str, edition: str, notes: str) -> None:
        """Queue a scene regeneration request."""
        self._scene_regen_requests.append({
            "scene_id": scene_id,
            "edition": edition,
            "notes": notes,
        })

    @workflow.run
    async def run(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        params = {
            production_id, original_script, target_duration_ms,
            avatar_asset_ids, style, voice_model, aspect_ratio, output_resolution
        }
        """
        production_id = params["production_id"]
        self._approval_resolutions = [params.get("output_resolution", "1080p")]

        # ---- 1. Build scene manifest ----------------------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {"production_id": production_id, "status": ProductionStatus.directing, "phase": "manifest", "percent": 5},
            start_to_close_timeout=timedelta(seconds=30),
        )

        manifest_raw = await workflow.execute_activity(
            build_scene_manifest_activity,
            params,
            start_to_close_timeout=timedelta(minutes=3),
            retry_policy=AI_RETRY,
        )

        await workflow.execute_activity(
            save_version_activity,
            {"production_id": production_id, "tag": VersionTag.original, "data": params},
            start_to_close_timeout=timedelta(seconds=30),
        )

        # ---- 2. Run three directors in parallel --------------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {"production_id": production_id, "status": ProductionStatus.directing, "phase": "directors", "percent": 15},
            start_to_close_timeout=timedelta(seconds=30),
        )

        director_params = {**params, "manifest": manifest_raw}

        visual_raw, sound_raw, voice_raw = await asyncio.gather(
            workflow.execute_activity(
                run_visual_director_activity,
                director_params,
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=AI_RETRY,
            ),
            workflow.execute_activity(
                run_sound_director_activity,
                director_params,
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=AI_RETRY,
            ),
            workflow.execute_activity(
                run_voice_director_activity,
                director_params,
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=AI_RETRY,
            ),
        )

        # Save director versions
        for tag, data in [
            (VersionTag.director_v1, {"visual": visual_raw, "sound": sound_raw, "voice": voice_raw, "edition": "conservative"}),
            (VersionTag.director_v2, {"visual": visual_raw, "sound": sound_raw, "voice": voice_raw, "edition": "cinematic"}),
            (VersionTag.director_v3, {"visual": visual_raw, "sound": sound_raw, "voice": voice_raw, "edition": "experimental"}),
        ]:
            await workflow.execute_activity(
                save_version_activity,
                {"production_id": production_id, "tag": tag, "data": data},
                start_to_close_timeout=timedelta(seconds=30),
            )

        # ---- 3. Assemble EDL --------------------------------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {"production_id": production_id, "status": ProductionStatus.assembling, "phase": "edl", "percent": 45},
            start_to_close_timeout=timedelta(seconds=30),
        )

        edl_raw = await workflow.execute_activity(
            assemble_edl_activity,
            {
                "production_id": production_id,
                "manifest": manifest_raw,
                "director_outputs": {
                    "visual_director": visual_raw,
                    "sound_director": sound_raw,
                    "voice_director": voice_raw,
                },
                "style": params.get("style", "cinematic"),
            },
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=AI_RETRY,
        )

        await workflow.execute_activity(
            save_version_activity,
            {"production_id": production_id, "tag": VersionTag.editor_assembly, "data": edl_raw},
            start_to_close_timeout=timedelta(seconds=30),
        )

        # ---- 4. Preview render ------------------------------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {"production_id": production_id, "status": ProductionStatus.preview_rendering, "phase": "preview", "percent": 60},
            start_to_close_timeout=timedelta(seconds=30),
        )

        preview_result = await workflow.execute_activity(
            render_preview_activity,
            {"production_id": production_id, "edl": edl_raw, "manifest": manifest_raw, "params": params},
            start_to_close_timeout=timedelta(minutes=30),
            retry_policy=RENDER_RETRY,
        )

        # ---- 5. Wait for human approval (indefinite) --------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {
                "production_id": production_id,
                "status": ProductionStatus.awaiting_approval,
                "phase": "review",
                "percent": 70,
                "preview_url": preview_result.get("preview_url"),
            },
            start_to_close_timeout=timedelta(seconds=30),
        )

        # Block indefinitely until approve() signal arrives
        await workflow.wait_condition(lambda: self._approval_signal_received)

        # ---- 6. TTS + lip-sync ------------------------------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {"production_id": production_id, "status": ProductionStatus.final_rendering, "phase": "tts", "percent": 75},
            start_to_close_timeout=timedelta(seconds=30),
        )

        tts_result = await workflow.execute_activity(
            generate_tts_activity,
            {"production_id": production_id, "edl": edl_raw},
            start_to_close_timeout=timedelta(minutes=20),
            retry_policy=AI_RETRY,
        )

        lipsync_result = await workflow.execute_activity(
            generate_lipsync_activity,
            {"production_id": production_id, "tts_result": tts_result, "edl": edl_raw},
            start_to_close_timeout=timedelta(minutes=20),
            retry_policy=AI_RETRY,
        )

        # ---- 7. Full render ---------------------------------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {"production_id": production_id, "status": ProductionStatus.final_rendering, "phase": "render", "percent": 80},
            start_to_close_timeout=timedelta(seconds=30),
        )

        render_result = await workflow.execute_activity(
            render_final_activity,
            {
                "production_id": production_id,
                "edl": edl_raw,
                "manifest": manifest_raw,
                "lipsync": lipsync_result,
                "params": params,
            },
            start_to_close_timeout=timedelta(hours=2),
            retry_policy=RENDER_RETRY,
        )

        # ---- 8. FFmpeg assembly + export ------------------------------------
        await workflow.execute_activity(
            update_production_status_activity,
            {"production_id": production_id, "status": ProductionStatus.final_rendering, "phase": "assembly", "percent": 90},
            start_to_close_timeout=timedelta(seconds=30),
        )

        export_result = await workflow.execute_activity(
            assemble_video_activity,
            {
                "production_id": production_id,
                "render_result": render_result,
                "tts_result": tts_result,
                "edl": edl_raw,
                "resolutions": self._approval_resolutions,
                "params": params,
            },
            start_to_close_timeout=timedelta(hours=1),
            retry_policy=RENDER_RETRY,
        )

        await workflow.execute_activity(
            save_version_activity,
            {"production_id": production_id, "tag": VersionTag.final_master, "data": export_result},
            start_to_close_timeout=timedelta(seconds=30),
        )

        await workflow.execute_activity(
            update_production_status_activity,
            {
                "production_id": production_id,
                "status": ProductionStatus.done,
                "phase": "complete",
                "percent": 100,
                "render_urls": export_result.get("render_urls", {}),
            },
            start_to_close_timeout=timedelta(seconds=30),
        )

        return {
            "production_id": production_id,
            "status": "done",
            "render_urls": export_result.get("render_urls", {}),
            "stems": export_result.get("stems", {}),
        }
