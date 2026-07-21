import fs from "fs";
import path from "path";
import { z } from "zod";

export const ScriptSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  text: z.string(),
  estimatedSeconds: z.number(),
  suggestedClip: z.string().optional(),
});

export type VoiceoverScript = z.infer<typeof ScriptSchema>;

const OPENERS = [
  "Hi, friend!", "Hello from my favorite spot!", "Welcome to my little story!",
  "Guess what happened today!", "I have something joyful to share!", "Come adventure with me!",
  "Thanks for stopping by!", "This moment is worth remembering!", "Ready for some fun?",
  "Here is a tiny piece of my day!", "I saved this smile for you!", "Let me show you something wonderful!",
] as const;

const MOMENTS = [
  { id: "home", title: "Cozy Home", category: "Memories", text: "Home feels warmer when we are together.", clip: "idle" },
  { id: "fetch", title: "Fetch Time", category: "Play", text: "Throw my favorite toy and watch me race the wind.", clip: "run" },
  { id: "treat", title: "Treat Please", category: "Training", text: "I can sit, wave, and look extra adorable for a treat.", clip: "beg" },
  { id: "walk", title: "Walk Adventure", category: "Adventure", text: "Every walk is a brand-new map full of amazing smells.", clip: "walk" },
  { id: "friend", title: "Best Friend", category: "Love", text: "You are my favorite person and my safest place.", clip: "tail_wave" },
  { id: "birthday", title: "Birthday Wish", category: "Celebration", text: "Today calls for happy dances, snacks, and one more candle.", clip: "shake" },
  { id: "brave", title: "Brave Heart", category: "Encouragement", text: "Small paws can carry a very brave heart through big days.", clip: "walk" },
  { id: "silly", title: "Silly Moment", category: "Comedy", text: "I meant to look graceful, but this is much more fun.", clip: "roll_over" },
  { id: "thank-you", title: "Thank You", category: "Gratitude", text: "Thank you for every cuddle, adventure, and shared snack.", clip: "paw_offer" },
  { id: "goodnight", title: "Goodnight", category: "Memories", text: "Goodnight, dream softly, and save a cozy spot for me.", clip: "lie" },
] as const;

// 120 distinct scripts, generated from authored phrases rather than one stale reply.
const BUILT_IN_SCRIPTS: VoiceoverScript[] = OPENERS.flatMap((opener, openerIndex) =>
  MOMENTS.map((moment) => {
    const text = `${opener} ${moment.text}`;
    return ScriptSchema.parse({
      id: `${moment.id}-${openerIndex + 1}`,
      title: `${moment.title} ${openerIndex + 1}`,
      category: moment.category,
      text,
      estimatedSeconds: estimateSpeechSeconds(text),
      suggestedClip: moment.clip,
    });
  })
);

let cachedScripts: VoiceoverScript[] | null = null;

// Rough estimate: ~2.5 words per second.
export function estimateSpeechSeconds(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.split(/\s+/).length / 2.5);
}

export function loadScripts(): VoiceoverScript[] {
  if (cachedScripts) return cachedScripts;

  const scripts = new Map(BUILT_IN_SCRIPTS.map((script) => [script.id, script]));
  const scriptsDir = path.join(process.cwd(), "server", "animator", "scripts");
  if (fs.existsSync(scriptsDir)) {
    for (const file of fs.readdirSync(scriptsDir).filter((name) => name.endsWith(".json"))) {
      try {
        const script = ScriptSchema.parse(JSON.parse(fs.readFileSync(path.join(scriptsDir, file), "utf8")));
        if (script.estimatedSeconds <= 10) scripts.set(script.id, script);
      } catch (error) {
        console.warn(`[Animator] Ignoring invalid voice script ${file}:`, error);
      }
    }
  }

  cachedScripts = [...scripts.values()];
  return cachedScripts;
}

export function getVoiceoverScripts(seed = "default", limit = loadScripts().length): VoiceoverScript[] {
  const scripts = [...loadScripts()];
  let state = [...seed].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  for (let i = scripts.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state || 1, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [scripts[i], scripts[j]] = [scripts[j], scripts[i]];
  }
  return scripts.slice(0, Math.max(1, Math.min(limit, scripts.length)));
}
