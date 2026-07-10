import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

export interface AudioSource {
  urlOrPath: string;
  volume: number;
  loop?: boolean;
}

/**
 * Uses ffmpeg to mix multiple audio sources (ambient, weather, voiceover) 
 * onto a silent video. Trims output to match video duration or MAX_CLIP_SECONDS.
 */
export async function muxAudioBed(
  videoPath: string, 
  audioSources: AudioSource[], 
  outputPath: string,
  maxDuration: number = 10
): Promise<void> {
  
  if (audioSources.length === 0) {
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  // Build the ffmpeg inputs
  let inputArgs = `-i "${videoPath}" `;
  for (const src of audioSources) {
    if (src.loop) inputArgs += `-stream_loop -1 `;
    inputArgs += `-i "${src.urlOrPath}" `;
  }

  // Build the amix filter
  // [1:a]volume=0.5[a1]; [2:a]volume=0.8[a2]; [a1][a2]amix=inputs=2[aout]
  let filterComplex = "";
  const audioLabels: string[] = [];
  
  for (let i = 0; i < audioSources.length; i++) {
    const src = audioSources[i];
    const label = `a${i}`;
    filterComplex += `[${i+1}:a]volume=${src.volume}[${label}]; `;
    audioLabels.push(`[${label}]`);
  }

  filterComplex += `${audioLabels.join("")}amix=inputs=${audioSources.length}:duration=first:dropout_transition=2[aout]`;

  // -t limits to maxDuration. -map 0:v maps the video. -map [aout] maps the mixed audio.
  // Using -c:v copy to avoid re-encoding the video track if possible, but webm/mp4 might need different flags
  // We'll re-encode audio to aac for mp4.
  const isMp4 = outputPath.endsWith(".mp4");
  const audioCodec = isMp4 ? "aac" : "libopus";
  
  const cmd = `ffmpeg -y ${inputArgs} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a ${audioCodec} -t ${maxDuration} "${outputPath}"`;

  try {
    await execAsync(cmd);
  } catch (err: any) {
    console.error("FFMPEG mux failed:", err.stderr || err.message);
    throw new Error("Failed to mux audio bed.");
  }
}
