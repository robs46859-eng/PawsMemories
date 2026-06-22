import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import Jimp from "jimp";
import * as templates from "./animation-templates.js";

const execPromise = promisify(exec);

// Extract the meaningful Python error from Blender's combined output
function extractBlenderError(stdout, stderr) {
  const combined = (stdout || "") + "\n" + (stderr || "");
  // Look for Python traceback in the output and capture everything after it
  const tracebackMatch = combined.match(/Traceback \(most recent call last\)[\s\S]+/m);
  if (tracebackMatch) {
    // Return last 1500 chars of traceback to get the full chain
    return tracebackMatch[0].slice(-1500);
  }
  // Look for lines containing ERROR or Error
  const errorLines = combined.split("\n").filter(l =>
    l.includes("ERROR") || l.includes("Error:") || l.includes("Exception:")
  ).filter(l =>
    !l.includes("mounted file-systems") && !l.includes("libEGL")
  );
  if (errorLines.length > 0) {
    return errorLines.join("\n").slice(-1500);
  }
  // Fallback: return tail of stdout (more useful than stderr for Blender)
  return (stdout || stderr || "Unknown error").slice(-1500);
}

const app = express();
const PORT = process.env.PORT || 10000;

// Increase limit for GLB model data and large scripts
app.use(express.json({ limit: "100mb" }));

// =============================================================================
// In-memory job store for async processing
// =============================================================================
const jobs = new Map();

// Auto-cleanup jobs older than 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > 15 * 60 * 1000) {
      // Cleanup temp dir if still around
      if (job.tempDir) {
        try { fs.rmSync(job.tempDir, { recursive: true, force: true }); } catch {}
      }
      jobs.delete(id);
    }
  }
}, 60000);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", activeJobs: jobs.size });
});

// =============================================================================
// GET /jobs/:jobId — Poll for job status and results
// =============================================================================
app.get("/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const response = {
    jobId: req.params.jobId,
    status: job.status,
    type: job.type,
    createdAt: job.createdAt,
  };

  if (job.status === "complete") {
    response.result = job.result;
  } else if (job.status === "failed") {
    response.error = job.error;
  }

  res.json(response);
});

// =============================================================================
// Original /render endpoint (unchanged, for legacy avatar generation via bpy)
// =============================================================================
app.post("/render", async (req, res) => {
  try {
    const { python_script } = req.body;
    
    if (!python_script) {
      return res.status(400).json({ error: "Missing python_script in request body" });
    }

    // Generate temp paths securely
    const tempId = crypto.randomUUID();
    const scriptPath = path.join(os.tmpdir(), `avatar_${tempId}.py`);
    const outputPath = path.join(os.tmpdir(), `avatar_${tempId}.png`);

    console.log(`[Job ${tempId}] Received render request`);

    // Override the output path in the script to point to our secure temp directory
    let modifiedScript = python_script;
    modifiedScript = modifiedScript.replace(/output_path\s*=\s*.+/g, `output_path = r"${outputPath}"`);

    // Write the python script to disk
    fs.writeFileSync(scriptPath, modifiedScript, 'utf8');

    // Execute blender in the background
    console.log(`[Job ${tempId}] Running Blender CLI...`);
    try {
      execSync(`blender --background --python-exit-code 1 --python "${scriptPath}"`, { stdio: 'pipe' });
    } catch (blenderErr) {
      console.error(`[Job ${tempId}] Blender execution failed:`, blenderErr.message);
      if (blenderErr.stdout) console.error("Stdout:", blenderErr.stdout.toString());
      if (blenderErr.stderr) console.error("Stderr:", blenderErr.stderr.toString());
      
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      return res.status(500).json({ error: "Blender rendering crashed. Check python script syntax." });
    }

    // Check if the output image was actually created
    if (!fs.existsSync(outputPath)) {
      console.error(`[Job ${tempId}] Expected output image not found at ${outputPath}`);
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      return res.status(500).json({ error: "Blender finished but no output image was generated." });
    }

    // Read the image and convert to base64
    const imageBuffer = fs.readFileSync(outputPath);
    const base64Data = imageBuffer.toString("base64");
    
    console.log(`[Job ${tempId}] Render successful, returning base64 (size: ${base64Data.length} chars)`);

    // Clean up temp files
    fs.unlinkSync(scriptPath);
    fs.unlinkSync(outputPath);

    // Return the generated image
    res.json({
      success: true,
      image_base64: `data:image/png;base64,${base64Data}`
    });

  } catch (err) {
    console.error("Unexpected error in /render:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =============================================================================
// POST /rig-model — ASYNC: Import GLB + apply AI-generated rigging armature
// Receives: { glb_base64, rigging_script }
// Returns:  { jobId } immediately, poll /jobs/:jobId for results
// =============================================================================
app.post("/rig-model", async (req, res) => {
  const jobId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `rig_${jobId}`);
  
  try {
    const { glb_base64, rigging_script } = req.body;

    if (!glb_base64 || !rigging_script) {
      return res.status(400).json({ error: "Missing glb_base64 or rigging_script" });
    }

    console.log(`[Rig ${jobId}] Starting async rigging job...`);

    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    const inputGlbPath = path.join(tempDir, "input.glb");
    const outputGlbPath = path.join(tempDir, "rigged_output.glb");
    const scriptPath = path.join(tempDir, "rig_script.py");

    // Write the input GLB file
    let rawGlb = glb_base64;
    if (rawGlb.startsWith("data:")) {
      rawGlb = rawGlb.split(",")[1] || rawGlb;
    }
    fs.writeFileSync(inputGlbPath, Buffer.from(rawGlb, "base64"));
    console.log(`[Rig ${jobId}] Input GLB written: ${fs.statSync(inputGlbPath).size} bytes`);

    // Build the full Blender script
    const fullScript = `
import bpy
import sys

# --- Step 1: Clear default scene ---
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# --- Step 2: Import the GLB mesh ---
print("[Rig] Importing GLB...")
bpy.ops.import_scene.gltf(filepath=r"${inputGlbPath}")

# Make sure the imported mesh is selected and active
mesh_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        mesh_obj = obj
        break

if not mesh_obj:
    print("[Rig] ERROR: No mesh found after import!")
    sys.exit(1)

bpy.context.view_layer.objects.active = mesh_obj
mesh_obj.select_set(True)
print(f"[Rig] Mesh found: {mesh_obj.name}")

# --- Step 3: Execute AI-generated rigging script ---
print("[Rig] Applying rigging armature...")

${rigging_script}

# --- Step 3.5: Safety cleanup to prevent glTF export crashes ---
print("[Rig] Verifying vertex weights to prevent export crashes...")
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        armature_mod = next((mod for mod in obj.modifiers if mod.type == 'ARMATURE'), None)
        if armature_mod and armature_mod.object:
            arm_obj = armature_mod.object
            if arm_obj.data.bones:
                bone_name = arm_obj.data.bones[0].name
                if bone_name not in obj.vertex_groups:
                    vg = obj.vertex_groups.new(name=bone_name)
                else:
                    vg = obj.vertex_groups[bone_name]
                # Guarantee at least one vertex is assigned to force a valid skin object
                # This bypasses the AttributeError: 'NoneType' has no attribute 'joints' in io_scene_gltf2
                if len(obj.data.vertices) > 0:
                    vg.add([0], 0.01, 'ADD')

# --- Step 4: Export the rigged model as GLB ---
print("[Rig] Exporting rigged GLB...")
try:
    bpy.ops.export_scene.gltf(
        filepath=r"${outputGlbPath}",
        export_format='GLB',
        export_animation=True, # Modern Blender 4+ / 5 API
        export_skins=True,
        export_def_bones=True
    )
except TypeError:
    bpy.ops.export_scene.gltf(
        filepath=r"${outputGlbPath}",
        export_format='GLB',
        export_animations=True, # Legacy Blender 3.4 API
        export_skins=True,
        export_def_bones=True
    )

print("[Rig] RIGGING_EXPORT_COMPLETE")
`;

    fs.writeFileSync(scriptPath, fullScript, "utf8");

    // Register the job as processing
    jobs.set(jobId, {
      type: "rig-model",
      status: "processing",
      createdAt: Date.now(),
      tempDir,
    });

    // Return immediately with jobId
    res.status(202).json({ jobId, status: "processing" });

    // Run Blender asynchronously
    console.log(`[Rig ${jobId}] Running Blender CLI for rigging (async)...`);
    const child = exec(
      `blender --background --python-exit-code 1 --python "${scriptPath}"`,
      { timeout: 300000, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const job = jobs.get(jobId);
        if (!job) return;

        if (error) {
          const errorDetail = extractBlenderError(stdout, stderr);
          console.error(`[Rig ${jobId}] Blender rigging failed:`, errorDetail);
          job.status = "failed";
          job.error = `Blender rigging failed: ${errorDetail}`;
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          return;
        }

        console.log(`[Rig ${jobId}] Blender stdout (last 500 chars):`, (stdout || "").slice(-500));

        // Check output
        if (!fs.existsSync(outputGlbPath)) {
          console.error(`[Rig ${jobId}] Rigged GLB not found at ${outputGlbPath}`);
          job.status = "failed";
          job.error = "Blender completed but no rigged GLB was generated.";
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          return;
        }

        const riggedBuffer = fs.readFileSync(outputGlbPath);
        const riggedBase64 = riggedBuffer.toString("base64");
        console.log(`[Rig ${jobId}] ✅ Rigging successful (${riggedBuffer.length} bytes)`);

        job.status = "complete";
        job.result = { success: true, rigged_glb_base64: riggedBase64 };

        // Cleanup temp files
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    );

  } catch (err) {
    console.error(`[Rig ${jobId}] Unexpected error:`, err);
    const job = jobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = "Internal server error during rigging";
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    // Only send error response if we haven't already sent the 202
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error during rigging" });
    }
  }
});

// =============================================================================
// POST /bake-sprites — ASYNC: Take rigged GLB, run modular templates → sprite sheet
// Receives: { rigged_glb_base64 }
// Returns:  { jobId } immediately, poll /jobs/:jobId for results
// =============================================================================
app.post("/bake-sprites", async (req, res) => {
  const jobId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `sprites_${jobId}`);

  try {
    const { rigged_glb_base64 } = req.body;

    if (!rigged_glb_base64) {
      return res.status(400).json({ error: "Missing rigged_glb_base64" });
    }

    console.log(`[Sprites ${jobId}] Starting modular sprite bake job...`);
    fs.mkdirSync(tempDir, { recursive: true });

    const inputGlbPath = path.join(tempDir, "rigged_model.glb");
    const outputPngPath = path.join(tempDir, "sprite_sheet.png");
    const outputJsonPath = path.join(tempDir, "sprite_sheet.json");

    let rawGlb = rigged_glb_base64;
    if (rawGlb.startsWith("data:")) {
      rawGlb = rawGlb.split(",")[1] || rawGlb;
    }
    fs.writeFileSync(inputGlbPath, Buffer.from(rawGlb, "base64"));

    jobs.set(jobId, {
      type: "bake-sprites",
      status: "processing",
      createdAt: Date.now(),
      tempDir,
    });
    res.status(202).json({ jobId, status: "processing" });

    // ASYNC BACKGROUND PROCESSING
    (async () => {
      try {
        const actions = [
          { name: "eating", frames: 4, fps: 8, scriptFn: templates.getEatingScript },
          { name: "drinking", frames: 4, fps: 8, scriptFn: templates.getDrinkingScript },
          { name: "running", frames: 6, fps: 12, scriptFn: templates.getRunningScript },
          { name: "playing", frames: 4, fps: 10, scriptFn: templates.getPlayingScript },
          { name: "sleeping", frames: 3, fps: 4, scriptFn: templates.getSleepingScript },
          { name: "photo", frames: 3, fps: 6, scriptFn: templates.getPhotoScript },
        ];

        let animationMetadata = {
          frameWidth: 128,
          frameHeight: 128,
          animations: {}
        };

        const frameSize = 128;
        const maxFrames = Math.max(...actions.map(a => a.frames));
        const sheetWidth = maxFrames * frameSize;
        const sheetHeight = actions.length * frameSize;

        // Initialize empty sprite sheet canvas
        const spriteSheet = new Jimp(sheetWidth, sheetHeight, 0x00000000);

        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          const scriptStr = action.scriptFn(inputGlbPath, tempDir, action.name);
          const scriptPath = path.join(tempDir, `${action.name}_script.py`);
          fs.writeFileSync(scriptPath, scriptStr);

          console.log(`[Sprites ${jobId}] Rendering action: ${action.name}`);
          try {
            await execPromise(`blender --background --python-exit-code 1 --python "${scriptPath}"`, { timeout: 300000 });
            
            // Stitch frames for this action
            for (let f = 0; f < action.frames; f++) {
              const framePath = path.join(tempDir, `${action.name}_${f.toString().padStart(4, '0')}.png`);
              if (fs.existsSync(framePath)) {
                const frameImg = await Jimp.read(framePath);
                spriteSheet.composite(frameImg, f * frameSize, i * frameSize);
              } else {
                console.warn(`[Sprites ${jobId}] Frame missing: ${framePath}`);
              }
            }
          } catch (err) {
            console.error(`[Sprites ${jobId}] Action ${action.name} failed:`, extractBlenderError(err.stdout, err.stderr));
            // Failed frames will remain blank (transparent) on the sheet
          }

          animationMetadata.animations[action.name] = {
            row: i,
            frames: action.frames,
            fps: action.fps
          };
        }

        console.log(`[Sprites ${jobId}] Writing final sprite sheet...`);
        await spriteSheet.writeAsync(outputPngPath);
        fs.writeFileSync(outputJsonPath, JSON.stringify(animationMetadata));

        const spritePng = fs.readFileSync(outputPngPath);
        const spriteBase64 = spritePng.toString("base64");

        const job = jobs.get(jobId);
        if (job) {
          job.status = "complete";
          job.result = {
            success: true,
            sprite_sheet_base64: `data:image/png;base64,${spriteBase64}`,
            animation_metadata: animationMetadata,
          };
        }
      } catch (err) {
        console.error(`[Sprites ${jobId}] Unexpected background error:`, err);
        const job = jobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = "Internal server error during sprite baking processing";
        }
      } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    })();

  } catch (err) {
    console.error(`[Sprites ${jobId}] Unexpected synchronous error:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error starting sprite baking" });
    }
  }
});

// =============================================================================
// Global error handler — catches request aborted, body-parser errors, etc.
// Prevents unhandled exceptions from crashing the process.
// =============================================================================
app.use((err, req, res, next) => {
  // Client disconnected before we finished reading the request body
  if (err.type === 'request.aborted' || err.message === 'request aborted') {
    console.warn(`[Server] Request aborted by client: ${req.method} ${req.url} (this is normal for slow uploads)`);
    if (!res.headersSent) {
      res.status(400).json({ error: "Request aborted by client" });
    }
    return;
  }

  // Body too large
  if (err.type === 'entity.too.large') {
    console.warn(`[Server] Request body too large: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(413).json({ error: "Request body too large" });
    }
    return;
  }

  // JSON parse error
  if (err.type === 'entity.parse.failed') {
    console.warn(`[Server] Invalid JSON in request: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(400).json({ error: "Invalid JSON in request body" });
    }
    return;
  }

  // Unknown error
  console.error(`[Server] Unhandled error on ${req.method} ${req.url}:`, err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Blender microservice listening on port ${PORT}`);
  console.log(`Endpoints: /render, /rig-model, /bake-sprites, /jobs/:jobId, /health`);
});
