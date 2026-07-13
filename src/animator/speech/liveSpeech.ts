import type * as THREE from "three";
import { authedFetch } from "../../api.ts";
import { speak, type LipSyncTier } from "./speak.ts";
import type { LipSyncPlayer } from "../viseme/LipSyncPlayer.ts";
import type { VisemeTrack } from "../viseme/visemeRules.ts";

interface PreviewResponse {
  audioBase64: string;
  mimeType: string;
  track: VisemeTrack | null;
  tier: LipSyncTier;
  degradedReason?: string;
}

export interface LiveSpeechHandle {
  tier: LipSyncTier;
  cancel(): void;
}

export async function playLiveActorSpeech(options: {
  root: THREE.Object3D;
  text: string;
  language?: string;
  signal?: AbortSignal;
  onPlayer(player: LipSyncPlayer | null): void;
  onTier?(tier: LipSyncTier): void;
  onEnd?(): void;
}): Promise<LiveSpeechHandle> {
  const response = await authedFetch("/api/animator/speech-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: options.text, language: options.language ?? "en" }),
    signal: options.signal,
  });
  const data = await response.json().catch(() => ({})) as Partial<PreviewResponse> & { error?: string };
  if (!response.ok || !data.audioBase64 || !data.mimeType) {
    throw new Error(data.error || "Voice preview could not be generated");
  }

  const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
  let playPromise: Promise<void> | null = null;
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    options.onPlayer(null);
    options.onEnd?.();
  };
  audio.addEventListener("ended", finish, { once: true });

  const result = await speak({
    root: options.root,
    transcript: options.text,
    resolveViseme: async () => data.track ?? null,
    playAudio: () => {
      playPromise = audio.play();
      return () => audio.currentTime;
    },
    onTier: options.onTier,
  });
  if (!result.player || !playPromise) throw new Error("Voice preview audio did not start");

  try {
    await playPromise;
  } catch (error) {
    result.player.dispose();
    throw error;
  }
  options.onPlayer(result.player);

  return {
    tier: result.tier,
    cancel() {
      if (ended) return;
      audio.pause();
      audio.currentTime = 0;
      result.player?.dispose();
      finish();
    },
  };
}
