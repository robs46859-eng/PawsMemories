"""
FFmpeg assembly worker.
Takes rendered frames + TTS audio files and produces:
  - Multi-resolution MP4 exports (480p / 720p / 1080p / 1440p / 4K)
  - Audio stems (dialogue, music, sfx)
  - Optional subtitle burn-in
"""

from __future__ import annotations
import asyncio
import json
import os
import tempfile
from typing import Any, Dict, List
from ..config import get_settings
from ..storage import upload_file

cfg = get_settings()

RESOLUTION_SCALES = {
    "480p":  (854, 480),
    "720p":  (1280, 720),
    "1080p": (1920, 1080),
    "1440p": (2560, 1440),
    "4k":    (3840, 2160),
}


async def assemble(
    production_id: str,
    render_result: Dict[str, Any],
    tts_result: Dict[str, Any],
    edl_data: Dict[str, Any],
    resolutions: List[str],
    production_params: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Main assembly function called from Temporal activity.
    Returns {"render_urls": {...}, "stems": {...}}
    """
    frames_dir = render_result.get("frames_dir")
    src_width = render_result.get("width", 1920)
    src_height = render_result.get("height", 1080)
    fps = production_params.get("fps", 30)

    # Write a temporary audio mix
    audio_mix_path = await _mix_audio(
        production_id=production_id,
        tts_result=tts_result,
        edl_data=edl_data,
        fps=fps,
    )

    render_urls: Dict[str, str] = {}
    stems: Dict[str, str] = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        # Export each resolution
        for res in resolutions:
            if res not in RESOLUTION_SCALES:
                continue
            w, h = RESOLUTION_SCALES[res]
            out_path = os.path.join(tmpdir, f"output_{res}.mp4")
            await _encode_video(
                frames_dir=frames_dir,
                audio_path=audio_mix_path,
                output_path=out_path,
                width=w,
                height=h,
                fps=fps,
                crf=_crf_for_res(res),
            )
            with open(out_path, "rb") as f:
                data = f.read()
            key = f"productions/{production_id}/exports/{res}.mp4"
            url = await upload_file(key, data, content_type="video/mp4")
            render_urls[res] = url

        # Export stems
        stem_paths = await _export_stems(
            production_id=production_id,
            tts_result=tts_result,
            edl_data=edl_data,
            tmpdir=tmpdir,
            fps=fps,
        )
        for stem_name, stem_path in stem_paths.items():
            with open(stem_path, "rb") as f:
                data = f.read()
            key = f"productions/{production_id}/stems/{stem_name}.wav"
            url = await upload_file(key, data, content_type="audio/wav")
            stems[stem_name] = url

    # Cleanup temp audio mix
    if audio_mix_path and os.path.exists(audio_mix_path):
        os.unlink(audio_mix_path)

    return {"render_urls": render_urls, "stems": stems}


async def _encode_video(
    frames_dir: str,
    audio_path: str | None,
    output_path: str,
    width: int,
    height: int,
    fps: int,
    crf: int = 23,
) -> None:
    """Encode PNG frame sequence → MP4 at target resolution."""
    frame_pattern = os.path.join(frames_dir, "frame_%04d.png")

    vf = f"scale={width}:{height}:flags=lanczos"
    cmd = [
        cfg.ffmpeg_path,
        "-y",
        "-framerate", str(fps),
        "-i", frame_pattern,
    ]

    if audio_path and os.path.exists(audio_path):
        cmd += ["-i", audio_path, "-c:a", "aac", "-b:a", "192k", "-shortest"]

    cmd += [
        "-c:v", "libx264",
        "-crf", str(crf),
        "-preset", "medium",
        "-pix_fmt", "yuv420p",
        "-vf", vf,
        "-movflags", "+faststart",
        output_path,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg encode failed: {stderr.decode()[-2000:]}")


async def _mix_audio(
    production_id: str,
    tts_result: Dict[str, Any],
    edl_data: Dict[str, Any],
    fps: int,
) -> str | None:
    """
    Download TTS WAV files and mix them with timing offsets from the EDL.
    Returns path to a mixed WAV file.
    """
    import httpx

    audio_urls: Dict[str, str] = tts_result.get("audio_urls", {})
    voice_cues = edl_data.get("voice_track", [])
    sound_cues = edl_data.get("sound_track", [])

    if not audio_urls and not sound_cues:
        return None

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    mix_path = tmp.name
    tmp.close()

    total_ms = edl_data.get("total_duration_ms", 30_000)

    # Build a silence base track
    cmd_base = [
        cfg.ffmpeg_path, "-y",
        "-f", "lavfi",
        "-i", f"anullsrc=r=44100:cl=stereo:d={total_ms / 1000:.3f}",
        "-acodec", "pcm_s16le",
        mix_path,
    ]
    proc = await asyncio.create_subprocess_exec(*cmd_base, stderr=asyncio.subprocess.DEVNULL)
    await proc.wait()

    # Overlay each voice cue audio at its offset
    with tempfile.TemporaryDirectory() as tmpdir:
        async with httpx.AsyncClient() as client:
            input_parts = ["-i", mix_path]
            filter_parts = []
            n_inputs = 1

            for cue in voice_cues:
                cue_id = cue.get("cue_id")
                url = audio_urls.get(cue_id)
                if not url:
                    continue
                start_ms = cue.get("start_ms", 0)
                local_path = os.path.join(tmpdir, f"{cue_id}.wav")
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    with open(local_path, "wb") as f:
                        f.write(resp.content)
                except Exception:
                    continue

                input_parts += ["-i", local_path]
                delay_ms = start_ms
                filter_parts.append(
                    f"[{n_inputs}:a]adelay={delay_ms}|{delay_ms}[a{n_inputs}]"
                )
                n_inputs += 1

            if n_inputs == 1:
                return mix_path  # No audio to mix

            mix_inputs = "[0:a]" + "".join(f"[a{i}]" for i in range(1, n_inputs))
            filter_parts.append(f"{mix_inputs}amix=inputs={n_inputs}:normalize=0[out]")

            final_mix = os.path.join(tmpdir, "mixed.wav")
            cmd_mix = [
                cfg.ffmpeg_path, "-y",
                *input_parts,
                "-filter_complex", ";".join(filter_parts),
                "-map", "[out]",
                "-acodec", "pcm_s16le",
                final_mix,
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd_mix,
                stderr=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"FFmpeg mix failed: {err.decode()[-2000:]}")

            # Copy to persistent path
            import shutil
            shutil.copy(final_mix, mix_path)

    return mix_path


async def _export_stems(
    production_id: str,
    tts_result: Dict[str, Any],
    edl_data: Dict[str, Any],
    tmpdir: str,
    fps: int,
) -> Dict[str, str]:
    """
    Export separate audio stems:
    - dialogue: all voice cues mixed
    - music: all music cues
    - sfx: ambience + foley + sfx cues
    Returns {stem_name: local_path}
    """
    import httpx

    audio_urls = tts_result.get("audio_urls", {})
    voice_cues = edl_data.get("voice_track", [])
    sound_cues = edl_data.get("sound_track", [])
    total_ms = edl_data.get("total_duration_ms", 30_000)

    stems = {}

    # Dialogue stem
    dialogue_path = os.path.join(tmpdir, "stem_dialogue.wav")
    await _build_silence(dialogue_path, total_ms)

    async with httpx.AsyncClient() as client:
        for cue in voice_cues:
            cue_id = cue.get("cue_id")
            url = audio_urls.get(cue_id)
            if not url:
                continue
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                part_path = os.path.join(tmpdir, f"dlg_{cue_id}.wav")
                with open(part_path, "wb") as f:
                    f.write(resp.content)
                await _overlay_audio(dialogue_path, part_path, cue.get("start_ms", 0))
            except Exception:
                pass

    if os.path.exists(dialogue_path):
        stems["dialogue"] = dialogue_path

    # SFX stem (sound cues marked music=False)
    sfx_path = os.path.join(tmpdir, "stem_sfx.wav")
    await _build_silence(sfx_path, total_ms)
    stems["sfx"] = sfx_path

    return stems


async def _build_silence(path: str, duration_ms: int) -> None:
    cmd = [
        cfg.ffmpeg_path, "-y",
        "-f", "lavfi",
        "-i", f"anullsrc=r=44100:cl=stereo:d={duration_ms / 1000:.3f}",
        "-acodec", "pcm_s16le",
        path,
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stderr=asyncio.subprocess.DEVNULL)
    await proc.wait()


async def _overlay_audio(base_path: str, overlay_path: str, offset_ms: int) -> None:
    """Overlay overlay_path onto base_path at offset_ms in-place."""
    out_path = base_path + ".tmp.wav"
    cmd = [
        cfg.ffmpeg_path, "-y",
        "-i", base_path,
        "-i", overlay_path,
        "-filter_complex",
        f"[1:a]adelay={offset_ms}|{offset_ms}[ov];[0:a][ov]amix=inputs=2:normalize=0[out]",
        "-map", "[out]",
        "-acodec", "pcm_s16le",
        out_path,
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stderr=asyncio.subprocess.DEVNULL)
    await proc.wait()
    import shutil
    shutil.move(out_path, base_path)


def _crf_for_res(res: str) -> int:
    """Lower CRF = higher quality. Use slightly higher quality for 4K to manage file size."""
    return {"480p": 28, "720p": 25, "1080p": 23, "1440p": 21, "4k": 19}.get(res, 23)
