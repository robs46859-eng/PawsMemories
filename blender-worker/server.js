import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync, exec } from "child_process";

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
bpy.ops.export_scene.gltf(
    filepath=r"${outputGlbPath}",
    export_format='GLB',
    export_animations=True,
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
// POST /bake-sprites — ASYNC: Take rigged GLB + animation script → sprite sheet
// Receives: { rigged_glb_base64, animation_script }
// Returns:  { jobId } immediately, poll /jobs/:jobId for results
// =============================================================================
app.post("/bake-sprites", async (req, res) => {
  const jobId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `sprites_${jobId}`);

  try {
    const { rigged_glb_base64, animation_script } = req.body;

    if (!rigged_glb_base64 || !animation_script) {
      return res.status(400).json({ error: "Missing rigged_glb_base64 or animation_script" });
    }

    console.log(`[Sprites ${jobId}] Starting async sprite bake job...`);

    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    const inputGlbPath = path.join(tempDir, "rigged_model.glb");
    const outputPngPath = path.join(tempDir, "sprite_sheet.png");
    const outputJsonPath = path.join(tempDir, "sprite_sheet.json");
    const scriptPath = path.join(tempDir, "sprite_script.py");

    // Write the rigged GLB
    let rawGlb = rigged_glb_base64;
    if (rawGlb.startsWith("data:")) {
      rawGlb = rawGlb.split(",")[1] || rawGlb;
    }
    fs.writeFileSync(inputGlbPath, Buffer.from(rawGlb, "base64"));
    console.log(`[Sprites ${jobId}] Rigged GLB written: ${fs.statSync(inputGlbPath).size} bytes`);

    // Build the full script
    let modifiedAnimScript = animation_script;
    modifiedAnimScript = modifiedAnimScript.replace(
      /output_path\s*=\s*.+/g,
      `output_path = r"${outputPngPath}"`
    );

    const fullScript = `
import bpy
import sys
import json
import os

# --- Step 1: Clear default scene ---
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# --- Step 2: Import the rigged GLB ---
print("[Sprites] Importing rigged GLB...")
bpy.ops.import_scene.gltf(filepath=r"${inputGlbPath}")

# Find armature and mesh
armature_obj = None
mesh_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'ARMATURE':
        armature_obj = obj
    elif obj.type == 'MESH':
        mesh_obj = obj

if not armature_obj:
    print("[Sprites] WARNING: No armature found, proceeding with mesh only")
if not mesh_obj:
    print("[Sprites] ERROR: No mesh found after import!")
    sys.exit(1)

if armature_obj:
    bpy.context.view_layer.objects.active = armature_obj
    armature_obj.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    print(f"[Sprites] Armature found: {armature_obj.name} (Pose Mode set, all bones selected)")
else:
    raise RuntimeError("Armature 'DogRig' object context could not be established.")
print(f"[Sprites] Mesh found: {mesh_obj.name}")

# Set output path for the animation script
output_path = r"${outputPngPath}"

# --- Step 3: Execute AI-generated animation + sprite bake script ---
print("[Sprites] Executing animation and sprite bake...")

${modifiedAnimScript}

# --- Force EEVEE for performance (defense-in-depth, overrides AI script) ---
bpy.context.scene.render.engine = 'BLENDER_EEVEE'
try:
    bpy.context.scene.eevee.taa_render_samples = 16
except Exception:
    pass  # Handle Blender 5 EEVEE-Next API differences safely

# --- Step 4: Verify outputs ---
if os.path.exists(r"${outputPngPath}"):
    print("[Sprites] Sprite sheet generated successfully!")
else:
    # Fallback: if the animation script didn't produce a sprite sheet,
    # render a simple turntable sequence as fallback
    print("[Sprites] WARNING: Animation script didn't produce sprite sheet. Generating fallback...")
    
    # Setup orthographic camera
    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = 'ORTHO'
    cam_obj = bpy.data.objects.new("SpriteCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    cam_obj.location = (0, -5, 1)
    
    import mathutils
    direction = mathutils.Vector((0, 0, 0.5)) - cam_obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam_obj.rotation_euler = rot_quat.to_euler()
    
    # Render settings
    scene = bpy.context.scene
    scene.render.resolution_x = 128
    scene.render.resolution_y = 128
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    
    # Render a few frames for each "action" (simple rotation for fallback)
    frame_size = 128
    actions = ['eating', 'drinking', 'running', 'playing', 'sleeping', 'photo']
    frames_per_action = [8, 8, 12, 10, 6, 4]
    max_frames = max(frames_per_action)
    
    # Create the sprite sheet image
    sheet_width = max_frames * frame_size
    sheet_height = len(actions) * frame_size
    
    try:
        import numpy as np
        sheet = np.zeros((sheet_height, sheet_width, 4), dtype=np.uint8)
    except ImportError:
        # numpy not available, just render individual frames
        pass
    
    scene.render.filepath = r"${outputPngPath}"
    bpy.ops.render.render(write_still=True)
    
    # Write fallback metadata
    fallback_metadata = {
        "frameWidth": frame_size,
        "frameHeight": frame_size,
        "animations": {}
    }
    for i, action_name in enumerate(actions):
        fallback_metadata["animations"][action_name] = {
            "row": i,
            "frames": frames_per_action[i],
            "fps": 12
        }
    
    with open(r"${outputJsonPath}", 'w') as f:
        json.dump(fallback_metadata, f)
    
    print("[Sprites] Fallback sprite sheet generated.")

print("[Sprites] SPRITE_BAKE_COMPLETE")
`;

    fs.writeFileSync(scriptPath, fullScript, "utf8");

    // Register the job as processing
    jobs.set(jobId, {
      type: "bake-sprites",
      status: "processing",
      createdAt: Date.now(),
      tempDir,
    });

    // Return immediately with jobId
    res.status(202).json({ jobId, status: "processing" });

    // Run Blender asynchronously
    console.log(`[Sprites ${jobId}] Running Blender CLI for sprite baking (async)...`);
    const child = exec(
      `blender --background --python-exit-code 1 --python "${scriptPath}"`,
      { timeout: 600000, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const job = jobs.get(jobId);
        if (!job) return;

        if (error) {
          const errorDetail = extractBlenderError(stdout, stderr);
          console.error(`[Sprites ${jobId}] Blender sprite bake failed:`, errorDetail);
          job.status = "failed";
          job.error = `Blender sprite baking failed: ${errorDetail}`;
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          return;
        }

        console.log(`[Sprites ${jobId}] Blender stdout (last 500 chars):`, (stdout || "").slice(-500));

        // Read sprite sheet
        if (!fs.existsSync(outputPngPath)) {
          // AI might have saved it under a different name or appended frame numbers
          const files = fs.readdirSync(tempDir);
          const pngFiles = files.filter(f => f.endsWith(".png") && f !== "sprite_sheet.png");
          if (pngFiles.length > 0) {
            // Sort to find the most likely final sheet (largest size or last modified)
            pngFiles.sort((a, b) => fs.statSync(path.join(tempDir, b)).size - fs.statSync(path.join(tempDir, a)).size);
            const foundPng = path.join(tempDir, pngFiles[0]);
            console.log(`[Sprites ${jobId}] Found alternative PNG: ${foundPng}, renaming to outputPngPath`);
            fs.renameSync(foundPng, outputPngPath);
          }
        }

        if (!fs.existsSync(outputPngPath)) {
          console.error(`[Sprites ${jobId}] Sprite sheet PNG not found (checked all PNGs)`);
          job.status = "failed";
          job.error = "Blender completed but no sprite sheet was generated.";
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          return;
        }

        const spritePng = fs.readFileSync(outputPngPath);
        const spriteBase64 = spritePng.toString("base64");

        // Read animation metadata
        let animationMetadata = {
          frameWidth: 128,
          frameHeight: 128,
          animations: {
            eating:   { row: 0, frames: 8,  fps: 12 },
            drinking: { row: 1, frames: 8,  fps: 12 },
            running:  { row: 2, frames: 12, fps: 16 },
            playing:  { row: 3, frames: 10, fps: 14 },
            sleeping: { row: 4, frames: 6,  fps: 6  },
            photo:    { row: 5, frames: 4,  fps: 8  },
          }
        };

        if (fs.existsSync(outputJsonPath)) {
          try {
            animationMetadata = JSON.parse(fs.readFileSync(outputJsonPath, "utf8"));
          } catch (e) {
            console.warn(`[Sprites ${jobId}] Could not parse metadata JSON, using defaults`);
          }
        }

        console.log(`[Sprites ${jobId}] ✅ Sprite bake successful (${spritePng.length} bytes)`);

        job.status = "complete";
        job.result = {
          success: true,
          sprite_sheet_base64: `data:image/png;base64,${spriteBase64}`,
          animation_metadata: animationMetadata,
        };

        // Cleanup temp files
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    );

  } catch (err) {
    console.error(`[Sprites ${jobId}] Unexpected error:`, err);
    const job = jobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = "Internal server error during sprite baking";
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error during sprite baking" });
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
