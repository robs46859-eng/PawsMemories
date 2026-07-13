import crypto from "crypto";
import fs from "fs";
import { z } from "zod";
import { resolveWithinWorkspace } from "./paths.ts";
import { RhubarbError, runRhubarb } from "./lipsync.ts";
import type { VisemeTrack } from "../../src/animator/viseme/visemeRules.ts";

const SAMPLE_RATE = 16_000;
const MAX_PCM_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_SECONDS = 30;

export const SpeechPreviewSchema = z.object({
  text: z.string().trim().min(1).max(500),
  language: z.string().trim().min(2).max(16).optional().default("en"),
  voiceId: z.string().trim().min(1).max(128).optional(),
});

export type SpeechPreviewInput = z.infer<typeof SpeechPreviewSchema>;

export interface SpeechPreviewResult {
  audioBase64: string;
  mimeType: "audio/wav";
  track: VisemeTrack | null;
  tier: "B" | "A";
  degradedReason?: string;
}

function pcm16MonoToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function synthesizeElevenLabsWav(
  input: SpeechPreviewInput,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

  const voiceId = input.voiceId
    ?? process.env.ELEVENLABS_DEFAULT_VOICE_ID?.trim()
    ?? "21m00Tcm4TlvDq8ikWAM";
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";
  const response = await fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_16000`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({
        text: input.text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${detail}`);
  }

  const pcm = Buffer.from(await response.arrayBuffer());
  if (pcm.length === 0 || pcm.length > MAX_PCM_BYTES || pcm.length % 2 !== 0) {
    throw new Error("ElevenLabs returned invalid PCM audio");
  }
  if (pcm.length / (SAMPLE_RATE * 2) > MAX_PREVIEW_SECONDS) {
    throw new Error(`Voice preview exceeds the ${MAX_PREVIEW_SECONDS}-second limit`);
  }
  return pcm16MonoToWav(pcm);
}

export async function createSpeechPreview(
  rawInput: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<SpeechPreviewResult> {
  const input = SpeechPreviewSchema.parse(rawInput);
  const wav = await synthesizeElevenLabsWav(input, fetchImpl);
  const digest = crypto.createHash("sha256").update(wav).digest("hex").slice(0, 16);
  const nonce = crypto.randomBytes(6).toString("hex");
  const audioPath = resolveWithinWorkspace(`tmp/speech-preview-${digest}-${nonce}.wav`);
  fs.writeFileSync(audioPath, wav);

  try {
    const durationSec = (wav.length - 44) / (SAMPLE_RATE * 2);
    try {
      const result = await runRhubarb({
        audioPath,
        transcript: input.text,
        language: input.language,
        durationSec,
        fps: 30,
      });
      return { audioBase64: wav.toString("base64"), mimeType: "audio/wav", track: result.track, tier: "B" };
    } catch (error) {
      const reason = error instanceof RhubarbError ? `${error.code}: ${error.message}` : (error as Error).message;
      return {
        audioBase64: wav.toString("base64"),
        mimeType: "audio/wav",
        track: null,
        tier: "A",
        degradedReason: reason,
      };
    }
  } finally {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}
