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

let _cachedScripts: VoiceoverScript[] | null = null;

// Rough estimate: ~2.5 words per second
export function estimateSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words / 2.5);
}

export function loadScripts(): VoiceoverScript[] {
  if (_cachedScripts) return _cachedScripts;
  
  const envDir = path.join(process.cwd(), "server", "animator", "scripts");
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
    
    // Create a couple of default CC0 scripts
    const defaultScripts: VoiceoverScript[] = [
      {
        id: "intro-basic",
        title: "Basic Intro",
        category: "Greetings",
        text: "Hi there! Welcome to my little corner of the world. It's so great to meet you!",
        estimatedSeconds: estimateSpeechSeconds("Hi there! Welcome to my little corner of the world. It's so great to meet you!"),
        suggestedClip: "idle"
      },
      {
        id: "play-fetch",
        title: "Play Fetch",
        category: "Play",
        text: "I love playing fetch! Throw the ball, throw the ball! I'm ready to run!",
        estimatedSeconds: estimateSpeechSeconds("I love playing fetch! Throw the ball, throw the ball! I'm ready to run!"),
        suggestedClip: "run"
      }
    ];
    
    for (const s of defaultScripts) {
      fs.writeFileSync(path.join(envDir, `${s.id}.json`), JSON.stringify(s, null, 2));
    }
  }
  
  const files = fs.readdirSync(envDir).filter(f => f.endsWith(".json"));
  const scripts: VoiceoverScript[] = [];
  
  for (const f of files) {
    const p = path.join(envDir, f);
    const content = fs.readFileSync(p, "utf8");
    try {
      const parsed = JSON.parse(content);
      const script = ScriptSchema.parse(parsed);
      
      // Enforce the 10s cap implicitly via estimates
      if (script.estimatedSeconds <= 10) {
        scripts.push(script);
      } else {
        console.warn(`Script ${script.id} exceeds 10s cap. Skipping.`);
      }
    } catch (err) {
      console.error(`Failed to parse script ${f}:`, err);
    }
  }
  
  _cachedScripts = scripts;
  return scripts;
}
