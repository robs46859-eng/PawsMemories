#!/usr/bin/env node
/**
 * generate-hero-reel.mjs
 * ======================
 * Generates the hero slide-2 "appeal reel" — pet photo to hyper-realistic
 * animated video — using Google Veo, and writes it to public/hero/.
 *
 * WHY A SCRIPT AND NOT A BUILD STEP
 * ---------------------------------
 * Veo generation is slow (minutes), paid, and non-deterministic. Putting it in
 * the build would make every deploy cost money and produce a different hero.
 * This runs once, by hand, and the resulting mp4 is committed as a static asset.
 *
 * MODEL SELECTION
 * ---------------
 * There is no Veo 4. As of July 2026 the current generation is Veo 3.1
 * ("veo-3.1-generate-preview" and "veo-3.1-fast-generate-preview"), which is
 * what server.ts already targets for user-facing video jobs. The candidate list
 * below is tried in order so this script keeps working when Google renames or
 * promotes a model out of preview — a 404 on one entry falls through to the
 * next rather than failing the run.
 *
 * AUDIO
 * -----
 * Veo 3.1 generates native audio. The hero player is hard-muted (the brief calls
 * for no sound in the hero), so audio here is wasted cost and weight. We ask for
 * the quietest prompt we can and strip the audio track in post if ffmpeg is
 * available — see stripAudio() below.
 *
 * USAGE
 *   GEMINI_API_KEY=... node scripts/generate-hero-reel.mjs
 *   GEMINI_API_KEY=... node scripts/generate-hero-reel.mjs --image public/featured-models/tuck.jpg
 *
 * OUTPUT
 *   public/hero/appeal-reel.mp4     the clip the hero <video> loads
 *   public/hero/appeal-reel.jpg     poster frame (first frame, if ffmpeg present)
 */

import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error(
    "GEMINI_API_KEY is not set.\n" +
      "This script calls a paid Google API and cannot run without a key.\n" +
      "  GEMINI_API_KEY=your-key node scripts/generate-hero-reel.mjs",
  );
  process.exit(1);
}

const MODEL_CANDIDATES = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.0-generate-preview",
];

const OUT_DIR = path.join(process.cwd(), "public", "hero");
const OUT_MP4 = path.join(OUT_DIR, "appeal-reel.mp4");
const OUT_POSTER = path.join(OUT_DIR, "appeal-reel.jpg");

const imageArgIdx = process.argv.indexOf("--image");
const SOURCE_IMAGE =
  imageArgIdx > -1 && process.argv[imageArgIdx + 1]
    ? process.argv[imageArgIdx + 1]
    : "public/featured-models/tuck.jpg";

/** The hero is muted, so the prompt asks for motion only — no dialogue, no music. */
const PROMPT = [
  "A beloved family dog photographed in a warm home setting slowly comes to life:",
  "the head turns gently toward camera, ears lift, eyes blink, fur moves in a soft breeze.",
  "Photoreal, shallow depth of field, warm natural window light, gentle handheld camera drift.",
  "Calm and affectionate in tone. No text, no captions, no on-screen graphics.",
  "Ambient only — no dialogue, no music, no narration.",
].join(" ");

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the audio track. The hero player sets `muted`, but a muted player still
 * downloads the audio stream — pure waste on a landing page's critical path.
 */
function stripAudio(file) {
  const tmp = file.replace(/\.mp4$/, ".noaudio.mp4");
  execFileSync("ffmpeg", ["-y", "-i", file, "-c", "copy", "-an", tmp], { stdio: "ignore" });
  execFileSync("mv", [tmp, file]);
}

function writePoster(file, poster) {
  execFileSync("ffmpeg", ["-y", "-i", file, "-vframes", "1", "-q:v", "3", poster], {
    stdio: "ignore",
  });
}

async function generateWith(ai, model, imageBytes, mimeType) {
  console.log(`→ trying model ${model} ...`);
  let op = await ai.models.generateVideos({
    model,
    prompt: PROMPT,
    image: { imageBytes, mimeType },
    config: { aspectRatio: "16:9" },
  });

  // Poll. Note we re-assign from the SDK's own return value rather than
  // reconstructing a handle — passing a plain {name} object to
  // getVideosOperation() throws "operation._fromAPIResponse is not a function".
  // (Same trap that broke the server-side video pollers; see server.ts.)
  const startedAt = Date.now();
  while (!op.done) {
    if (Date.now() - startedAt > 15 * 60 * 1000) {
      throw new Error("Timed out after 15 minutes waiting for Veo.");
    }
    await new Promise((r) => setTimeout(r, 10_000));
    process.stdout.write(".");
    op = await ai.operations.getVideosOperation({ operation: op });
  }
  process.stdout.write("\n");

  const video = op.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("Veo returned no video in the completed operation.");

  if (video.uri) {
    const res = await fetch(video.uri, { headers: { "x-goog-api-key": API_KEY } });
    if (!res.ok) throw new Error(`Video download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (video.videoBytes || video.imageBytes) {
    return Buffer.from(video.videoBytes || video.imageBytes, "base64");
  }
  throw new Error("Veo returned neither a URI nor inline bytes.");
}

async function main() {
  if (!existsSync(SOURCE_IMAGE)) {
    console.error(`Source image not found: ${SOURCE_IMAGE}`);
    console.error("Pass one with --image <path>.");
    process.exit(1);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const imageBytes = (await fs.readFile(SOURCE_IMAGE)).toString("base64");
  const mimeType = mimeFor(SOURCE_IMAGE);
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  console.log(`Source image : ${SOURCE_IMAGE}`);
  console.log(`Output       : ${OUT_MP4}\n`);

  let buffer = null;
  const failures = [];
  for (const model of MODEL_CANDIDATES) {
    try {
      buffer = await generateWith(ai, model, imageBytes, mimeType);
      console.log(`✅ generated with ${model}`);
      break;
    } catch (err) {
      const msg = String(err?.message || err);
      failures.push(`${model}: ${msg}`);
      // Only fall through on "model doesn't exist / not available to you".
      // A quota or billing error will fail identically on every candidate, so
      // stop rather than burning three round-trips to print the same thing.
      if (!/not found|404|NOT_FOUND|unsupported|does not exist/i.test(msg)) {
        console.error(`\n✗ ${model} failed with a non-recoverable error:\n  ${msg}`);
        break;
      }
      console.warn(`  unavailable, trying next candidate`);
    }
  }

  if (!buffer) {
    console.error("\nCould not generate the hero reel. Attempts:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }

  await fs.writeFile(OUT_MP4, buffer);
  console.log(`Wrote ${OUT_MP4} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

  if (hasFfmpeg()) {
    stripAudio(OUT_MP4);
    writePoster(OUT_MP4, OUT_POSTER);
    const after = await fs.stat(OUT_MP4);
    console.log(`Stripped audio → ${(after.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Wrote poster ${OUT_POSTER}`);
  } else {
    console.warn(
      "\nffmpeg not found — skipped audio strip and poster extraction.\n" +
        "The hero still works (the player is muted and falls back to a still),\n" +
        "but you are shipping an unused audio track. Install ffmpeg and re-run.",
    );
  }
}

main().catch((err) => {
  console.error("\nFailed:", err?.message || err);
  process.exit(1);
});
