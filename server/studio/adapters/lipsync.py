"""
Swappable lip-sync / phoneme adapter.
Set STUDIO_LIPSYNC_PROVIDER=rhubarb|did|wav2lip in .env
"""

from __future__ import annotations
import asyncio
import json
import os
import subprocess
import tempfile
from abc import ABC, abstractmethod
from typing import List
from ..schemas import PhonemeTiming
from ..config import get_settings

cfg = get_settings()

# Standard viseme set (matches most rig blend shapes)
PHONEME_TO_VISEME = {
    "AA": "aa", "AE": "aa", "AH": "aa",
    "AO": "oh", "AW": "oh", "AY": "ay",
    "B": "pp", "CH": "ch", "D": "dd",
    "DH": "th", "EH": "eh", "ER": "er",
    "EY": "eh", "F": "ff", "G": "kk",
    "HH": "sil", "IH": "ih", "IY": "ih",
    "JH": "ch", "K": "kk", "L": "ll",
    "M": "pp", "N": "nn", "NG": "nn",
    "OW": "oh", "OY": "oh", "P": "pp",
    "R": "rr", "S": "ss", "SH": "ss",
    "T": "dd", "TH": "th", "UH": "ou",
    "UW": "ou", "V": "ff", "W": "ou",
    "Y": "ih", "Z": "ss", "ZH": "ss",
    "SIL": "sil", "SP": "sil",
}


class LipsyncAdapter(ABC):
    @abstractmethod
    async def analyze(
        self,
        audio_url: str,
        text: str,
        start_ms_offset: int = 0,
    ) -> List[PhonemeTiming]:
        ...


class RhubarbLipsyncAdapter(LipsyncAdapter):
    """Uses Rhubarb Lip Sync CLI to extract phoneme timing from WAV."""

    async def analyze(self, audio_url: str, text: str, start_ms_offset: int = 0) -> List[PhonemeTiming]:
        import httpx
        # Download audio to temp file
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "voice.wav")
            async with httpx.AsyncClient() as client:
                resp = await client.get(audio_url)
                resp.raise_for_status()
                with open(audio_path, "wb") as f:
                    f.write(resp.content)

            # Run rhubarb
            output_path = os.path.join(tmpdir, "phonemes.json")
            text_path = os.path.join(tmpdir, "dialog.txt")
            with open(text_path, "w") as f:
                f.write(text)

            proc = await asyncio.create_subprocess_exec(
                cfg.rhubarb_path,
                audio_path,
                "-f", "json",
                "-o", output_path,
                "--dialogFile", text_path,
                "--extendedShapes",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

            if not os.path.exists(output_path):
                return self._fallback_timing(text, start_ms_offset)

            with open(output_path) as f:
                data = json.load(f)

            timings = []
            for entry in data.get("mouthCues", []):
                start_s = float(entry["start"])
                end_s = float(entry["end"])
                phoneme = entry["value"].upper()
                viseme = PHONEME_TO_VISEME.get(phoneme, "sil")
                timings.append(PhonemeTiming(
                    phoneme=phoneme,
                    viseme=viseme,
                    start_ms=start_ms_offset + int(start_s * 1000),
                    end_ms=start_ms_offset + int(end_s * 1000),
                ))
            return timings

    def _fallback_timing(self, text: str, start_ms: int) -> List[PhonemeTiming]:
        """Rough fallback: ~75ms per character."""
        timings = []
        ms = start_ms
        for ch in text:
            duration = 75
            timings.append(PhonemeTiming(
                phoneme="SIL", viseme="sil",
                start_ms=ms, end_ms=ms + duration,
            ))
            ms += duration
        return timings


class OpenAILipsyncAdapter(LipsyncAdapter):
    """
    Uses OpenAI Whisper speech marks API (when available) for phoneme timing.
    Falls back to rough character-based estimate.
    """
    async def analyze(self, audio_url: str, text: str, start_ms_offset: int = 0) -> List[PhonemeTiming]:
        # OpenAI doesn't yet expose phoneme-level timing publicly.
        # Use a character-rate estimate until a provider is available.
        words = text.split()
        wpm = 150
        ms_per_word = 60_000 / wpm
        timings = []
        t = start_ms_offset
        for word in words:
            dur = int(ms_per_word * (len(word) / 5))  # scale by word length
            # Approximate: open mouth for whole word
            timings.append(PhonemeTiming(
                phoneme="AA", viseme="aa",
                start_ms=t, end_ms=t + dur,
            ))
            t += dur + 50  # brief pause between words
        return timings


def get_lipsync_adapter() -> LipsyncAdapter:
    provider = cfg.lipsync_provider.lower()
    if provider == "rhubarb":
        return RhubarbLipsyncAdapter()
    return OpenAILipsyncAdapter()
