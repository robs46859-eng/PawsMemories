"""
Editor AI — the controlling agent.

Responsibilities:
1. Parse and preserve the original script untouched
2. Build a structured SceneManifest with millisecond-accurate timing
3. Dispatch Visual, Sound, and Voice Directors concurrently
4. Receive their three-edition outputs and build the locked EDL
5. Validate timing collisions and produce a final edit_manifest
"""

from __future__ import annotations
import asyncio
import json
import time
from typing import Any, Dict, List, Optional
from uuid import uuid4

from openai import AsyncOpenAI
from ..schemas import (
    Cue, Edition, TrackType, Scene, Shot, SceneManifest,
    DirectorOutput, EDL, EditConflict, VersionTag, ProductionStatus,
)
from ..config import get_settings

cfg = get_settings()
client = AsyncOpenAI(api_key=cfg.openai_api_key)


# ---------------------------------------------------------------------------
# Scene Manifest Builder
# ---------------------------------------------------------------------------

MANIFEST_SYSTEM = """
You are the Editor AI for a professional animation studio.
Your job is to parse a script and break it into scenes and shots with
millisecond-accurate timing.

Rules:
- NEVER modify the original script text — preserve it exactly.
- Distribute the target_duration_ms proportionally across scenes based on content density.
- Each scene must have at least one shot.
- Shot IDs follow the pattern: {scene_id}_sh{N:02d}
- Return ONLY valid JSON matching the SceneManifest schema.

SceneManifest schema:
{
  "scenes": [
    {
      "scene_id": "s01",
      "start_ms": 0,
      "end_ms": 5000,
      "description": "...",
      "shots": [
        {"shot_id": "s01_sh01", "scene_id": "s01", "start_ms": 0, "end_ms": 2500, "description": "..."}
      ]
    }
  ]
}
"""

async def build_scene_manifest(
    production_id: str,
    original_script: str,
    target_duration_ms: int,
    style: str,
) -> SceneManifest:
    """Ask the Editor AI to parse the script into a scene/shot structure."""
    prompt = (
        f"Script:\n{original_script}\n\n"
        f"Target duration: {target_duration_ms}ms ({target_duration_ms/1000:.1f}s)\n"
        f"Style: {style}\n\n"
        "Return the SceneManifest JSON."
    )

    response = await client.chat.completions.create(
        model=cfg.openai_editor_model,
        messages=[
            {"role": "system", "content": MANIFEST_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

    raw = json.loads(response.choices[0].message.content)
    scenes = [
        Scene(
            scene_id=s["scene_id"],
            start_ms=s["start_ms"],
            end_ms=s["end_ms"],
            description=s["description"],
            shots=[
                Shot(
                    shot_id=sh["shot_id"],
                    scene_id=s["scene_id"],
                    start_ms=sh["start_ms"],
                    end_ms=sh["end_ms"],
                    description=sh["description"],
                )
                for sh in s.get("shots", [])
            ],
        )
        for s in raw.get("scenes", [])
    ]

    return SceneManifest(
        production_id=production_id,
        original_script=original_script,
        total_duration_ms=target_duration_ms,
        scenes=scenes,
    )


# ---------------------------------------------------------------------------
# EDL Assembly
# ---------------------------------------------------------------------------

EDL_SYSTEM = """
You are the Editor AI assembling the locked Edit Decision List.

You receive outputs from three specialist directors (Visual, Sound, Voice),
each providing three editions: conservative, cinematic, experimental.

Your task:
1. Select the best cues from across editions for each moment in time.
2. You may mix editions — e.g. use conservative voice with cinematic visuals.
3. Resolve any timing collisions by adjusting start_ms / end_ms or dropping lower-confidence cues.
4. Flag any conflicts you resolved in the conflicts_resolved array.
5. Ensure voice_track cues cover all dialogue from the original script.
6. Ensure the total timeline matches total_duration_ms.

Return ONLY valid JSON in this format:
{
  "visual_track": [...cues...],
  "sound_track": [...cues...],
  "voice_track": [...cues...],
  "conflicts_resolved": [
    {"description": "...", "affected_cue_ids": ["..."], "resolution": "..."}
  ]
}
"""

async def assemble_edl(
    production_id: str,
    manifest: SceneManifest,
    director_outputs: Dict[str, DirectorOutput],
    style: str,
) -> EDL:
    """Ask the Editor AI to merge all director editions into a locked EDL."""

    # Serialize director outputs compactly for the prompt
    directors_json = {
        name: {
            "conservative": [c.model_dump() for c in out.conservative],
            "cinematic": [c.model_dump() for c in out.cinematic],
            "experimental": [c.model_dump() for c in out.experimental],
        }
        for name, out in director_outputs.items()
    }

    prompt = (
        f"Production ID: {production_id}\n"
        f"Total duration: {manifest.total_duration_ms}ms\n"
        f"Style: {style}\n"
        f"Original script (DO NOT MODIFY):\n{manifest.original_script}\n\n"
        f"Director outputs:\n{json.dumps(directors_json, indent=2)}\n\n"
        "Assemble the locked EDL JSON."
    )

    response = await client.chat.completions.create(
        model=cfg.openai_editor_model,
        messages=[
            {"role": "system", "content": EDL_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
    )

    raw = json.loads(response.choices[0].message.content)
    version_id = str(uuid4())

    def parse_cues(items: List[Dict], track: TrackType) -> List[Cue]:
        result = []
        for item in items:
            try:
                item["track"] = track.value
                item.setdefault("edition", Edition.cinematic.value)
                result.append(Cue(**item))
            except Exception:
                pass  # Skip malformed cues
        return result

    return EDL(
        production_id=production_id,
        version_id=version_id,
        visual_track=parse_cues(raw.get("visual_track", []), TrackType.visual),
        sound_track=parse_cues(raw.get("sound_track", []), TrackType.sound),
        voice_track=parse_cues(raw.get("voice_track", []), TrackType.voice),
        conflicts_resolved=[
            EditConflict(**c) for c in raw.get("conflicts_resolved", [])
        ],
        total_duration_ms=manifest.total_duration_ms,
        locked=True,
    )


# ---------------------------------------------------------------------------
# Collision Validator
# ---------------------------------------------------------------------------

def validate_edl_timing(edl: EDL) -> List[str]:
    """Return a list of collision warnings. Empty list = clean."""
    warnings: List[str] = []

    def check_track(cues: List[Cue], track_name: str):
        sorted_cues = sorted(cues, key=lambda c: c.start_ms)
        for i in range(len(sorted_cues) - 1):
            a, b = sorted_cues[i], sorted_cues[i + 1]
            overlap = a.end_ms - b.start_ms
            if overlap > 50:  # >50ms overlap is a hard collision
                warnings.append(
                    f"{track_name}: collision between {a.cue_id} "
                    f"(ends {a.end_ms}ms) and {b.cue_id} (starts {b.start_ms}ms) "
                    f"— {overlap}ms overlap"
                )

    check_track(edl.visual_track, "visual")
    check_track(edl.sound_track, "sound")
    check_track(edl.voice_track, "voice")
    return warnings


# ---------------------------------------------------------------------------
# Apply user style instruction ("less dramatic", "faster pacing")
# ---------------------------------------------------------------------------

STYLE_CHANGE_SYSTEM = """
You are the Editor AI. The user has requested a broad style change to the
locked Edit Decision List. Apply the instruction to the relevant cues.

Rules:
- Only modify parameters, intensity, instruction, or edition fields.
- Do not add or remove cues — only adjust existing ones.
- Preserve scene_id, shot_id, start_ms, end_ms, cue_id, track, source_agent.
- Return the full modified EDL JSON in the same format as input.
"""

async def apply_style_change(edl: EDL, instruction: str) -> EDL:
    """Rewrite the EDL cues to match a broad style instruction."""
    prompt = (
        f"Style change instruction: '{instruction}'\n\n"
        f"Current EDL:\n{edl.model_dump_json(indent=2)}\n\n"
        "Return the modified EDL JSON."
    )

    response = await client.chat.completions.create(
        model=cfg.openai_editor_model,
        messages=[
            {"role": "system", "content": STYLE_CHANGE_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )

    raw = json.loads(response.choices[0].message.content)

    def parse_cues(items, track: TrackType) -> List[Cue]:
        result = []
        for item in items:
            try:
                item["track"] = track.value
                result.append(Cue(**item))
            except Exception:
                pass
        return result

    return EDL(
        production_id=edl.production_id,
        version_id=str(uuid4()),
        visual_track=parse_cues(raw.get("visual_track", []), TrackType.visual),
        sound_track=parse_cues(raw.get("sound_track", []), TrackType.sound),
        voice_track=parse_cues(raw.get("voice_track", []), TrackType.voice),
        conflicts_resolved=[
            EditConflict(**c) for c in raw.get("conflicts_resolved", [])
        ],
        total_duration_ms=edl.total_duration_ms,
        locked=False,  # Needs re-approval after style change
    )
