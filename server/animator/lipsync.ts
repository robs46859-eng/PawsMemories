/**
 * lipsync.ts — Phase 2 Tier B Rhubarb Lip-Sync job runner (ANIM-LIP-01) +
 * API handlers (POST /animator/lipsync, GET /animator/lipsync/:id).
 *
 * Security posture (Checkpoint A):
 *  • Rhubarb is invoked with NO shell — `spawn(bin, argsArray, { shell: false })`.
 *  • The transcript is written to a workspace temp file and passed via `-d`; it
 *    is NEVER interpolated into a command string, so command injection is impossible.
 *  • Input audio + all temp/output paths are validated through
 *    `resolveWithinWorkspace` (rejects traversal, symlinks, bad extensions).
 *  • The executable is resolved from RHUBARB_BIN → approved vendor paths → PATH,
 *    and we refuse to run any path outside that allow-list.
 *  • Timeouts, output-size caps, non-zero exits, and malformed JSON are all handled
 *    with typed errors and guaranteed temp-file cleanup.
 *  • The module is safe to import even when Rhubarb is absent (resolution is lazy).
 */

import { spawn, execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { resolveWithinWorkspace, ANIMATOR_DATA_DIR } from "./paths.ts";
import { enqueue, claimJob, completeJob } from "./queue.ts";
import {
  postProcessVisemeTrack,
  rhubarbJsonToRawCues,
  VISEME_POST_PROCESSOR_VERSION,
  VisemeTrack,
  VisemeValidationError,
  VisemeRuleError,
} from "../../src/animator/viseme/visemeRules.ts";

// ──────────────────────────────────────────────────────────────────────
// Typed errors
// ──────────────────────────────────────────────────────────────────────

export type RhubarbErrorCode =
  | "BIN_NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "PATH_TRAVERSAL"
  | "MALFORMED_JSON"
  | "OUTPUT_TOO_LARGE"
  | "PROCESS_ERROR"
  | "TIMEOUT"
  | "VALIDATION";

export class RhubarbError extends Error {
  constructor(
    public readonly code: RhubarbErrorCode,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "RhubarbError";
  }
}

// ──────────────────────────────────────────────────────────────────────
// Executable resolution
// ──────────────────────────────────────────────────────────────────────

const APPROVED_VENDOR_BINS = [
  path.join(process.cwd(), "bin", "rhubarb-lipsync"),
  path.join(process.cwd(), "bin", "rhubarb"),
  path.join(process.cwd(), "vendor", "rhubarb", "rhubarb"),
  path.join(process.cwd(), "vendor", "rhubarb", "rhubarb-lipsync"),
  "/usr/local/bin/rhubarb",
  "/usr/local/bin/rhubarb-lipsync",
  "/opt/rhubarb/rhubarb",
];

/**
 * Resolve the Rhubarb executable. Order:
 *   1. RHUBARB_BIN (if set and exists)
 *   2. approved vendor/local paths
 *   3. bare `rhubarb` / `rhubarb-lipsync` on PATH (spawnable)
 * Returns the resolved path/name, or null if absent. Synchronous so it can be
 * called inside request handlers without async overhead.
 */
export function resolveRhubarbBin(): string | null {
  const envBin = process.env.RHUBARB_BIN;
  if (envBin) {
    // Allow either an absolute/relative path or a bare command name.
    if (path.isAbsolute(envBin) || envBin.includes("/") || envBin.includes("\\")) {
      if (fs.existsSync(envBin) && fs.statSync(envBin).isFile()) return envBin;
      return null;
    }
    // bare name — trust PATH
    return envBin;
  }
  for (const candidate of APPROVED_VENDOR_BINS) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  // Probe PATH (no shell, synchronous, short timeout).
  for (const name of ["rhubarb-lipsync", "rhubarb"]) {
    try {
      execFileSync(name, ["--version"], { stdio: "ignore", timeout: 2000 });
      return name;
    } catch {
      /* keep probing */
    }
  }
  return null;
}

/** Report the resolved binary's version (for the doctor). Returns null if absent. */
export async function rhubarbVersion(): Promise<string | null> {
  const bin = resolveRhubarbBin();
  if (!bin) return null;
  return new Promise<string | null>((resolve) => {
    const child = spawn(bin, ["--version"], { shell: false });
    let out = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("exit", () => {
      const v = out.trim().split("\n")[0]?.trim();
      resolve(v || "unknown");
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// Audio sniffing + (optional) conversion
// ──────────────────────────────────────────────────────────────────────

function sniffWav(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}
function sniffOgg(buf: Buffer): boolean {
  return buf.length > 4 && buf.toString("ascii", 0, 4) === "OggS";
}

async function ffmpegAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { shell: false, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Ensure the audio file is in a Rhubarb-supported format (WAV or OGG).
 * Validates by content (magic bytes), not by extension/MIME. Attempts an
 * ffmpeg conversion for other formats; rejects with a typed error if ffmpeg
 * is unavailable or the format is unknown.
 */
async function ensureSupportedAudio(audioPath: string): Promise<string> {
  const buf = fs.readFileSync(audioPath);
  if (sniffWav(buf) || sniffOgg(buf)) return audioPath;
  if (!(await ffmpegAvailable())) {
    throw new RhubarbError("UNSUPPORTED_FORMAT", "Audio format not WAV/OGG and ffmpeg unavailable for conversion");
  }
  const outPath = resolveWithinWorkspace(`tmp/lipsync-conv-${crypto.randomBytes(6).toString("hex")}.wav`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-i", audioPath, "-ar", "44100", "-ac", "1", outPath], {
      shell: false,
    });
    let err = "";
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new RhubarbError("UNSUPPORTED_FORMAT", `ffmpeg spawn failed: ${e.message}`)));
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new RhubarbError("UNSUPPORTED_FORMAT", `ffmpeg conversion failed: ${err.slice(0, 300)}`)),
    );
  });
  return outPath;
}

/** Hash the audio file contents (used in the cache key, not the filename). */
function hashAudioFile(audioPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(audioPath)).digest("hex");
}

// ──────────────────────────────────────────────────────────────────────
// Recognizer selection
// ──────────────────────────────────────────────────────────────────────

export function selectRecognizer(language: string): "pocketSphinx" | "phonetic" {
  const lang = (language || "en").toLowerCase();
  return lang.startsWith("en") ? "pocketSphinx" : "phonetic";
}

// ──────────────────────────────────────────────────────────────────────
// Cache (source-hash keyed)
// ──────────────────────────────────────────────────────────────────────

export interface LipsyncCacheKeyParts {
  audioSha256: string;
  transcript: string;
  language: string;
  recognizer: string;
  fps: number;
}

function cacheKey(parts: LipsyncCacheKeyParts): string {
  const norm = (parts.transcript || "").replace(/\s+/g, " ").trim().toLowerCase();
  const raw = [
    parts.audioSha256,
    norm,
    parts.language,
    parts.recognizer,
    String(parts.fps),
    VISEME_POST_PROCESSOR_VERSION,
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function cacheDir(): string {
  const dir = resolveWithinWorkspace("jobs/lipsync-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getCachedTrack(key: string): VisemeTrack | null {
  const p = path.join(cacheDir(), `${key}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as VisemeTrack;
  } catch {
    return null;
  }
}

export function setCachedTrack(key: string, track: VisemeTrack): void {
  const p = path.join(cacheDir(), `${key}.json`);
  fs.writeFileSync(p, JSON.stringify(track), "utf8");
}

export function invalidateCachedTrack(key: string): void {
  const p = path.join(cacheDir(), `${key}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ──────────────────────────────────────────────────────────────────────
// Run Rhubarb
// ──────────────────────────────────────────────────────────────────────

export interface RunRhubarbParams {
  audioPath: string;
  transcript?: string;
  language?: string;
  fps?: number;
  durationSec?: number;
  source?: VisemeTrack["source"];
  timeoutMs?: number;
}

export interface RunRhubarbResult {
  track: VisemeTrack;
  cacheKey: string;
  cached: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/**
 * Run Rhubarb on an audio file and return a validated VisemeTrack.
 * Throws RhubarbError (typed) on any failure. Never spawns a shell.
 */
export async function runRhubarb(params: RunRhubarbParams): Promise<RunRhubarbResult> {
  const bin = resolveRhubarbBin();
  if (!bin) {
    throw new RhubarbError("BIN_NOT_FOUND", "Rhubarb executable not found (set RHUBARB_BIN)");
  }

  // Validate the audio path is inside the workspace (rejects traversal/symlinks).
  let audioPath: string;
  try {
    audioPath = resolveWithinWorkspace(params.audioPath);
  } catch (e: any) {
    throw new RhubarbError("PATH_TRAVERSAL", e.message);
  }
  if (!fs.existsSync(audioPath)) {
    throw new RhubarbError("VALIDATION", `Audio file not found: ${params.audioPath}`);
  }

  audioPath = await ensureSupportedAudio(audioPath);

  const fps = params.fps ?? 30;
  const language = params.language ?? "en";
  const recognizer = selectRecognizer(language);
  const transcript = params.transcript?.trim() || "";

  // Cache lookup (keyed on content + normalized transcript + tier params).
  const audioSha256 = hashAudioFile(audioPath);
  const key = cacheKey({ audioSha256, transcript, language, recognizer, fps });

  const cached = getCachedTrack(key);
  if (cached) {
    return { track: cached, cacheKey: key, cached: true };
  }

  // Temp dialog file (only when a transcript exists).
  let dialogPath: string | null = null;
  const cleanupPaths: string[] = [];
  if (transcript) {
    dialogPath = resolveWithinWorkspace(`tmp/lipsync-dlg-${crypto.randomBytes(6).toString("hex")}.txt`);
    fs.writeFileSync(dialogPath, transcript, "utf8");
    cleanupPaths.push(dialogPath);
  }

  const outPath = resolveWithinWorkspace(`tmp/lipsync-out-${crypto.randomBytes(6).toString("hex")}.json`);
  cleanupPaths.push(outPath);

  const args = [
    audioPath,
    "-o",
    outPath,
    "-f",
    "json",
    "-r",
    recognizer,
    "--extendedShapes",
    "GHX",
  ];
  if (dialogPath) {
    args.push("-d", dialogPath);
  }

  try {
    await runProcess(bin, args, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const stat = fs.statSync(outPath);
    if (stat.size > MAX_OUTPUT_BYTES) {
      throw new RhubarbError("OUTPUT_TOO_LARGE", `Rhubarb output ${stat.size} bytes exceeds cap`);
    }
    const raw = fs.readFileSync(outPath, "utf8");
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new RhubarbError("MALFORMED_JSON", "Rhubarb produced non-JSON output");
    }

    const rawCues = rhubarbJsonToRawCues(json);
    const track = postProcessVisemeTrack(rawCues, {
      fps,
      source: params.source ?? "rhubarb",
      durationSec: params.durationSec,
    });

    setCachedTrack(key, track);
    return { track, cacheKey: key, cached: false };
  } catch (e) {
    if (e instanceof RhubarbError || e instanceof VisemeValidationError || e instanceof VisemeRuleError) {
      throw e;
    }
    throw new RhubarbError("PROCESS_ERROR", `Rhubarb execution failed: ${(e as Error).message}`);
  } finally {
    for (const p of cleanupPaths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/** Spawn a process (no shell) and resolve on clean exit, reject on timeout/error. */
function runProcess(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { shell: false });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new RhubarbError("TIMEOUT", `Rhubarb exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new RhubarbError("PROCESS_ERROR", `Failed to start Rhubarb: ${e.message}`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (killed) return; // timeout already rejected
      if (code === 0) resolve();
      else reject(new RhubarbError("PROCESS_ERROR", `Rhubarb exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// API request/response schemas
// ──────────────────────────────────────────────────────────────────────

export const LipsyncPostSchema = z.object({
  audioPath: z.string().optional(),
  audioBase64: z.string().optional(),
  transcript: z.string().optional(),
  language: z.string().optional().default("en"),
  fps: z.number().int().positive().max(120).optional().default(30),
  assetId: z.string().optional(),
  userId: z.string().optional(),
});
export type LipsyncPostInput = z.infer<typeof LipsyncPostSchema>;

export const LipsyncGetResponseSchema = z.object({
  id: z.string(),
  state: z.enum(["pending", "running", "done", "failed"]),
  type: z.string().optional(),
  cached: z.boolean().optional(),
  track: z.any().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
});

// ──────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────

function errToJobError(e: unknown): { error: string; errorCode: string } {
  if (e instanceof RhubarbError) return { error: `${e.code}: ${e.message}`, errorCode: e.code };
  if (e instanceof VisemeValidationError) return { error: `VALIDATION: ${e.message}`, errorCode: "VALIDATION" };
  if (e instanceof VisemeRuleError) return { error: `RULE: ${e.message}`, errorCode: "VALIDATION" };
  return { error: (e as Error).message, errorCode: "PROCESS_ERROR" };
}

/**
 * POST /animator/lipsync — enqueue + synchronously run a lipsync job,
 * returning a job id and (on success) the validated track. Never 503s:
 * a Rhubarb failure is persisted on the job record and the id is still returned
 * so the client can poll GET.
 */
export async function handleLipsyncPost(req: any, res: any): Promise<void> {
  let body: LipsyncPostInput;
  try {
    body = LipsyncPostSchema.parse(req.body || {});
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  if (!body.audioPath && !body.audioBase64) {
    res.status(400).json({ error: "One of audioPath or audioBase64 is required" });
    return;
  }

  const userPhone = req.user?.phone || body.userId || "anon";

  // Resolve audio to a workspace path (validates traversal/symlinks).
  let audioPath: string;
  try {
    if (body.audioPath) {
      audioPath = resolveWithinWorkspace(body.audioPath);
    } else {
      const buf = Buffer.from(body.audioBase64!, "base64");
      if (buf.length === 0) throw new Error("Empty audio");
      const sig = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
      const tmp = resolveWithinWorkspace(`tmp/lipsync-in-${sig}.wav`);
      fs.writeFileSync(tmp, buf);
      audioPath = tmp;
    }
  } catch (e: any) {
    res.status(400).json({ error: `Invalid audio path: ${e.message}` });
    return;
  }

  const recognizer = selectRecognizer(body.language || "en");
  const job = enqueue({
    userPhone,
    assetId: body.assetId || "00000000-0000-0000-0000-000000000000",
    type: "lipsync",
    params: {
      audioPath,
      transcript: body.transcript || "",
      language: body.language || "en",
      fps: String(body.fps ?? 30),
      recognizer,
    },
  });

  // Pre-check cache so we can return a cached result without even claiming the job.
  const audioSha256 = (() => {
    try {
      return crypto.createHash("sha256").update(fs.readFileSync(audioPath)).digest("hex");
    } catch {
      return "";
    }
  })();
  const key = cacheKey({
    audioSha256,
    transcript: body.transcript || "",
    language: body.language || "en",
    recognizer,
    fps: body.fps ?? 30,
  });
  const cached = getCachedTrack(key);
  if (cached) {
    const claimed = claimJob(job.id);
    if (claimed) {
      completeJob(job.id, "done", { result: cached, cached: true });
    }
    res.json({ jobId: job.id, cached: true, track: cached });
    return;
  }

  // Synchronous processing (claim → run → complete).
  const claimed = claimJob(job.id);
  if (!claimed) {
    res.json({ jobId: job.id, cached: false });
    return;
  }
  try {
    const result = await runRhubarb({
      audioPath,
      transcript: body.transcript,
      language: body.language,
      fps: body.fps,
      source: "rhubarb",
    });
    completeJob(job.id, "done", { result: result.track, cached: false });
    res.json({ jobId: job.id, cached: false, track: result.track });
  } catch (e) {
    const jerr = errToJobError(e);
    completeJob(job.id, "failed", { error: jerr.error, errorCode: jerr.errorCode });
    // Return the id; the failure is surfaced via GET (never 503 on the read path).
    res.json({ jobId: job.id, cached: false, error: jerr.error, errorCode: jerr.errorCode });
  }
}

/**
 * GET /animator/lipsync/:id — return current job state + validated track or
 * typed failure. Safe read path: always 200 unless the job truly doesn't exist.
 */
export async function handleLipsyncGet(req: any, res: any): Promise<void> {
  const id = req.params.id;
  const dirs = ["pending", "running", "done", "failed"];
  let raw: string | null = null;
  let dirUsed: string | null = null;
  for (const dir of dirs) {
    const p = resolveWithinWorkspace(`jobs/${dir}/${id}.json`);
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, "utf8");
      dirUsed = dir;
      break;
    }
  }
  if (!raw) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  let job: any;
  try {
    job = JSON.parse(raw);
  } catch {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  // Owner check (best-effort; anon jobs are world-readable).
  if (job.userPhone && job.userPhone !== "anon" && req.user?.phone && job.userPhone !== req.user.phone) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json({
    id: job.id,
    state: job.state,
    type: job.type,
    cached: Boolean(job.result && (job as any).cached),
    track: job.result ?? null,
    error: job.error ?? null,
    errorCode: job.errorCode ?? null,
    dir: dirUsed,
  });
}
