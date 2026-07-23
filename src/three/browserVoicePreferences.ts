export const BROWSER_VOICE_PREFERENCE_KEY = "pawsome3d:randy-browser-voice:v1";

export interface BrowserVoicePreference {
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

export interface BrowserVoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  default?: boolean;
}

export const DEFAULT_BROWSER_VOICE_PREFERENCE: BrowserVoicePreference = {
  voiceURI: null,
  rate: 0.95,
  pitch: 1.1,
};

export function parseBrowserVoicePreference(raw: string | null): BrowserVoicePreference {
  if (!raw) return DEFAULT_BROWSER_VOICE_PREFERENCE;
  try {
    const value = JSON.parse(raw) as Partial<BrowserVoicePreference>;
    if (
      (value.voiceURI !== null && typeof value.voiceURI !== "string")
      || typeof value.rate !== "number"
      || value.rate < 0.5
      || value.rate > 2
      || typeof value.pitch !== "number"
      || value.pitch < 0
      || value.pitch > 2
    ) {
      return DEFAULT_BROWSER_VOICE_PREFERENCE;
    }
    return { voiceURI: value.voiceURI, rate: value.rate, pitch: value.pitch };
  } catch {
    return DEFAULT_BROWSER_VOICE_PREFERENCE;
  }
}

export function chooseBrowserVoice<T extends BrowserVoiceLike>(
  voices: readonly T[],
  preference: BrowserVoicePreference,
): T | null {
  if (preference.voiceURI) {
    const exact = voices.find((voice) => voice.voiceURI === preference.voiceURI);
    if (exact) return exact;
  }
  return voices.find(
    (voice) => voice.lang.toLowerCase().startsWith("en") && /samantha|karen|daniel|google/i.test(voice.name),
  )
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en") && voice.default)
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
    ?? voices[0]
    ?? null;
}
