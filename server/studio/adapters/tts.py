"""
Swappable TTS adapter.
Set STUDIO_TTS_PROVIDER=openai|elevenlabs|azure in .env
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import List, Optional
from ..config import get_settings

cfg = get_settings()


class TTSAdapter(ABC):
    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: str,
        emotion: str = "neutral",
        pacing: Optional[float] = None,
        emphasis: Optional[List[str]] = None,
    ) -> bytes:
        """Return raw WAV audio bytes."""
        ...


class OpenAITTSAdapter(TTSAdapter):
    async def synthesize(self, text, voice="alloy", emotion="neutral", pacing=None, emphasis=None) -> bytes:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=cfg.openai_api_key)
        speed = 1.0
        if emotion in ("excited", "energetic"):
            speed = 1.15
        elif emotion in ("slow", "dramatic"):
            speed = 0.85
        if pacing:
            speed = min(max(pacing / 150.0, 0.5), 1.5)
        response = await client.audio.speech.create(
            model="tts-1",
            voice=voice if voice in ("alloy", "echo", "fable", "onyx", "nova", "shimmer") else "alloy",
            input=text,
            speed=speed,
            response_format="wav",
        )
        return response.content


class ElevenLabsTTSAdapter(TTSAdapter):
    VOICE_ID_MAP = {"Rachel": "21m00Tcm4TlvDq8ikWAM"}

    async def synthesize(self, text, voice="Rachel", emotion="neutral", pacing=None, emphasis=None) -> bytes:
        import httpx
        voice_id = self.VOICE_ID_MAP.get(voice, voice if len(voice) >= 20 else cfg.elevenlabs_default_voice_id)
        stability = 0.5
        similarity_boost = 0.75
        if emotion == "excited":
            stability = 0.3
        elif emotion == "calm":
            stability = 0.8
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": cfg.elevenlabs_api_key},
                params={"output_format": "pcm_16000"},
                json={
                    "text": text,
                    "model_id": cfg.elevenlabs_model_id,
                    "voice_settings": {
                        "stability": stability,
                        "similarity_boost": similarity_boost,
                    },
                },
            )
            resp.raise_for_status()
            return resp.content


class AzureTTSAdapter(TTSAdapter):
    async def synthesize(self, text, voice="en-US-JennyNeural", emotion="neutral", pacing=None, emphasis=None) -> bytes:
        import httpx
        rate = "+0%"
        if pacing:
            diff = int((pacing / 150.0 - 1.0) * 100)
            rate = f"+{diff}%" if diff >= 0 else f"{diff}%"
        ssml = f"""<speak version='1.0' xml:lang='en-US'>
  <voice name='{voice}'>
    <prosody rate='{rate}'>{text}</prosody>
  </voice>
</speak>"""
        token_url = f"https://{cfg.azure_tts_region}.api.cognitive.microsoft.com/sts/v1.0/issuetoken"
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(token_url, headers={"Ocp-Apim-Subscription-Key": cfg.azure_tts_key})
            token_resp.raise_for_status()
            synth_resp = await client.post(
                f"https://{cfg.azure_tts_region}.tts.speech.microsoft.com/cognitiveservices/v1",
                headers={
                    "Authorization": f"Bearer {token_resp.text}",
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
                },
                content=ssml.encode(),
            )
            synth_resp.raise_for_status()
            return synth_resp.content


def get_tts_adapter() -> TTSAdapter:
    provider = cfg.tts_provider.lower()
    if provider == "elevenlabs":
        return ElevenLabsTTSAdapter()
    if provider == "azure":
        return AzureTTSAdapter()
    return OpenAITTSAdapter()


if __name__ == "__main__":
    pass
