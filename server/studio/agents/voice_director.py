"""
Voice Director AI

Defines: speaker, voice model, pronunciation, emotion, pacing,
emphasis, pauses, and lip-sync phoneme timing. Three editions per shot.
"""

from __future__ import annotations
import json
from typing import List, Optional
from uuid import uuid4

from openai import AsyncOpenAI
from ..schemas import (
    Cue, Edition, TrackType, SceneManifest, DirectorOutput, Shot,
    VoiceCueParams, PhonemeTiming,
)
from ..config import get_settings

cfg = get_settings()
client = AsyncOpenAI(api_key=cfg.openai_api_key)

VOICE_SYSTEM = """
You are the Voice Director AI for an animation production studio.
You design the complete vocal performance for every shot.

For EACH shot extract all dialogue from the original script and define:
- Speaker: which avatar/character ID is speaking
- Voice model: preferred TTS voice name or style
- Pronunciation overrides: phonetic corrections for unusual words
- Emotion: the emotional register (calm, excited, sad, angry, curious, warm, etc.)
- Pacing: words per minute (typical speech: 120-180 wpm)
- Emphasis: list of words that need stress
- Pauses: silence before / after the line in ms
- Lip-sync phoneme timing: approximate phoneme/viseme pairs with timestamps
  (the actual TTS worker will refine these, but provide best-estimate scaffold)

For shots with NO dialogue, return an empty cues list for that shot.

You produce THREE editions:
- conservative: natural, clear, neutral delivery — prioritizes intelligibility
- cinematic: emotionally rich, deliberate pacing, intentional pauses for effect
- experimental: unconventional delivery — whispering, overlapping, fragmented

Rules:
- track is always "voice".
- source_agent is always "voice_director".
- parameters must include: speaker_id, text (exact line from script), emotion,
  pacing, emphasis_words, pause_before_ms, pause_after_ms, pronunciation_overrides.
- Do NOT invent dialogue — only use lines that exist in the original script.
- Return ONLY valid JSON:
{
  "conservative": [cue, ...],
  "cinematic": [cue, ...],
  "experimental": [cue, ...]
}
"""


async def direct_shot(
    shot: Shot,
    script: str,
    style: str,
    voice_model: Optional[str],
    avatar_ids: List[str],
) -> tuple[List[Cue], List[Cue], List[Cue]]:
    speaker_hint = avatar_ids[0] if avatar_ids else "avatar_01"
    voice_hint = voice_model or "default"

    prompt = (
        f"Original script:\n{script}\n\n"
        f"Style preset: {style}\n"
        f"Voice model: {voice_hint}\n"
        f"Primary avatar/speaker: {speaker_hint}\n"
        f"Scene: {shot.scene_id} — Shot: {shot.shot_id}\n"
        f"Shot window: {shot.start_ms}ms – {shot.end_ms}ms\n"
        f"Shot description: {shot.description}\n\n"
        "Extract dialogue from the script for this shot and generate "
        "conservative, cinematic, and experimental voice cues."
    )

    response = await client.chat.completions.create(
        model=cfg.openai_model,
        messages=[
            {"role": "system", "content": VOICE_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.6,
    )

    raw = json.loads(response.choices[0].message.content)

    def parse(items, edition: Edition) -> List[Cue]:
        result = []
        for item in items:
            try:
                item.setdefault("cue_id", str(uuid4()))
                item["track"] = TrackType.voice.value
                item["source_agent"] = "voice_director"
                item["edition"] = edition.value
                item["scene_id"] = shot.scene_id
                item["shot_id"] = shot.shot_id
                # Ensure text field exists in params
                if "parameters" not in item:
                    item["parameters"] = {}
                if "text" not in item.get("parameters", {}):
                    item["parameters"]["text"] = item.get("instruction", "")
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
    voice_model: Optional[str],
    avatar_ids: List[str],
) -> DirectorOutput:
    import asyncio
    all_shots = [shot for scene in manifest.scenes for shot in scene.shots]
    tasks = [
        direct_shot(shot, manifest.original_script, style, voice_model, avatar_ids)
        for shot in all_shots
    ]
    results = await asyncio.gather(*tasks)

    conservative, cinematic, experimental = [], [], []
    for c, ci, e in results:
        conservative.extend(c)
        cinematic.extend(ci)
        experimental.extend(e)

    return DirectorOutput(
        director="voice_director",
        production_id=production_id,
        conservative=conservative,
        cinematic=cinematic,
        experimental=experimental,
    )
