"""
Visual Director AI

Defines: camera framing, character blocking, facial expressions, lighting,
environment, movement, transitions, and animation cues.
Produces three verbose timestamped editions for each scene/shot.
"""

from __future__ import annotations
import json
from typing import List
from uuid import uuid4

from openai import AsyncOpenAI
from ..schemas import Cue, Edition, TrackType, SceneManifest, DirectorOutput, Shot
from ..config import get_settings

cfg = get_settings()
client = AsyncOpenAI(api_key=cfg.openai_api_key)

VISUAL_SYSTEM = """
You are the Visual Director AI for an animation production studio.
You define the complete visual language for every shot.

For EACH shot you must define cues covering:
- Camera: framing (close_up, medium, wide, over_shoulder, dutch_angle, aerial, pov)
- Character blocking: position, posture, movement path
- Facial expression: specific emotion mapped to rig blend shapes
- Lighting: key/fill/rim setup, color temperature, intensity
- Environment: background, set dressing, time of day, weather
- Movement: character animation name or description
- Transitions: how to enter/exit this shot (cut, dissolve, wipe, smash_cut)
- Animation cues: specific rig animation clips to trigger

You produce THREE editions for every shot:
- conservative: safe, clear, effective — good default storytelling
- cinematic: visually rich, intentional aesthetics, deliberate pacing
- experimental: bold, unexpected, rule-breaking — high risk/reward

Rules:
- start_ms and end_ms must match the shot boundaries exactly.
- Every cue must carry all required fields: cue_id, scene_id, shot_id, track,
  start_ms, end_ms, source_agent, edition, instruction, intensity, parameters, confidence.
- track is always "visual".
- source_agent is always "visual_director".
- confidence reflects how well the instruction fits the style and script.
- Return ONLY valid JSON in this exact structure:
{
  "conservative": [cue, cue, ...],
  "cinematic": [cue, cue, ...],
  "experimental": [cue, cue, ...]
}
"""


def _build_shot_prompt(script: str, shot: Shot, style: str, avatar_ids: List[str]) -> str:
    avatars = ", ".join(avatar_ids) if avatar_ids else "default avatar"
    return (
        f"Original script:\n{script}\n\n"
        f"Avatars: {avatars}\n"
        f"Style preset: {style}\n"
        f"Scene: {shot.scene_id} — Shot: {shot.shot_id}\n"
        f"Shot window: {shot.start_ms}ms – {shot.end_ms}ms "
        f"({shot.end_ms - shot.start_ms}ms / {(shot.end_ms - shot.start_ms)/1000:.2f}s)\n"
        f"Shot description: {shot.description}\n\n"
        "Generate conservative, cinematic, and experimental visual cues for this shot."
    )


async def direct_shot(
    shot: Shot,
    script: str,
    style: str,
    avatar_ids: List[str],
) -> tuple[List[Cue], List[Cue], List[Cue]]:
    """Returns (conservative, cinematic, experimental) cue lists for one shot."""
    prompt = _build_shot_prompt(script, shot, style, avatar_ids)

    response = await client.chat.completions.create(
        model=cfg.openai_model,
        messages=[
            {"role": "system", "content": VISUAL_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    raw = json.loads(response.choices[0].message.content)

    def parse(items, edition: Edition) -> List[Cue]:
        result = []
        for item in items:
            try:
                item.setdefault("cue_id", str(uuid4()))
                item["track"] = TrackType.visual.value
                item["source_agent"] = "visual_director"
                item["edition"] = edition.value
                item["scene_id"] = shot.scene_id
                item["shot_id"] = shot.shot_id
                result.append(Cue(**item))
            except Exception as e:
                pass  # Skip malformed items
        return result

    return (
        parse(raw.get("conservative", []), Edition.conservative),
        parse(raw.get("cinematic", []), Edition.cinematic),
        parse(raw.get("experimental", []), Edition.experimental),
    )


async def run(
    production_id: str,
    manifest: SceneManifest,
    style: str,
    avatar_ids: List[str],
) -> DirectorOutput:
    """Run the Visual Director across all shots, returning three full editions."""
    conservative: List[Cue] = []
    cinematic: List[Cue] = []
    experimental: List[Cue] = []

    # Process shots — could be parallelized per scene for speed
    all_shots = [shot for scene in manifest.scenes for shot in scene.shots]

    import asyncio
    tasks = [
        direct_shot(shot, manifest.original_script, style, avatar_ids)
        for shot in all_shots
    ]
    results = await asyncio.gather(*tasks)

    for c, ci, e in results:
        conservative.extend(c)
        cinematic.extend(ci)
        experimental.extend(e)

    return DirectorOutput(
        director="visual_director",
        production_id=production_id,
        conservative=conservative,
        cinematic=cinematic,
        experimental=experimental,
    )
