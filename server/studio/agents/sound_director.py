"""
Sound Director AI

Defines: music, ambience, Foley, effects, volume automation,
spatial positioning, silence. Three editions per shot.
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

SOUND_SYSTEM = """
You are the Sound Director AI for an animation production studio.
You design the complete sonic landscape for every shot.

For EACH shot you must define cues covering:
- Music: genre, tempo, instruments, mood, whether to fade in/out
- Ambience: environment sounds (room tone, outdoor, crowd, nature, etc.)
- Foley: footsteps, cloth, props — realistic physical sounds
- Sound effects (SFX): specific punctuation sounds tied to action moments
- Volume automation: envelope over time (db levels at key timestamps)
- Spatial positioning: where sounds sit in the stereo/surround field (pan, xyz)
- Silence: intentional quiet moments and their dramatic purpose

Sound types:  music | ambience | foley | sfx | silence

You produce THREE editions:
- conservative: clear, supportive, genre-appropriate score
- cinematic: rich layered design, intentional silence and swell
- experimental: atonal, unexpected, genre-bending, high-impact

Rules:
- track is always "sound".
- source_agent is always "sound_director".
- start_ms / end_ms must fall within the shot window.
- Multiple cues can overlap (music under foley, etc.).
- Use parameters: { sound_type, asset_key, volume_db, pan, fade_in_ms, fade_out_ms, loop, reverb }
- Return ONLY valid JSON:
{
  "conservative": [cue, ...],
  "cinematic": [cue, ...],
  "experimental": [cue, ...]
}
"""


async def direct_shot(shot: Shot, script: str, style: str) -> tuple[List[Cue], List[Cue], List[Cue]]:
    prompt = (
        f"Original script:\n{script}\n\n"
        f"Style preset: {style}\n"
        f"Scene: {shot.scene_id} — Shot: {shot.shot_id}\n"
        f"Shot window: {shot.start_ms}ms – {shot.end_ms}ms\n"
        f"Shot description: {shot.description}\n\n"
        "Generate conservative, cinematic, and experimental sound cues."
    )

    response = await client.chat.completions.create(
        model=cfg.openai_model,
        messages=[
            {"role": "system", "content": SOUND_SYSTEM},
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
                item["track"] = TrackType.sound.value
                item["source_agent"] = "sound_director"
                item["edition"] = edition.value
                item["scene_id"] = shot.scene_id
                item["shot_id"] = shot.shot_id
                result.append(Cue(**item))
            except Exception:
                pass
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
) -> DirectorOutput:
    import asyncio
    all_shots = [shot for scene in manifest.scenes for shot in scene.shots]
    tasks = [direct_shot(shot, manifest.original_script, style) for shot in all_shots]
    results = await asyncio.gather(*tasks)

    conservative, cinematic, experimental = [], [], []
    for c, ci, e in results:
        conservative.extend(c)
        cinematic.extend(ci)
        experimental.extend(e)

    return DirectorOutput(
        director="sound_director",
        production_id=production_id,
        conservative=conservative,
        cinematic=cinematic,
        experimental=experimental,
    )
