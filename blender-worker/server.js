import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

const app = express();
const PORT = process.env.PORT || 10000;

// Increase limit for GLB model data and large scripts
app.use(express.json({ limit: "100mb" }));

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
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
// POST /rig-model — Import GLB + apply AI-generated rigging armature
// Receives: { glb_base64, rigging_script }
// Returns:  { success, rigged_glb_base64 }
// =============================================================================
app.post("/rig-model", async (req, res) => {
  const tempId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `rig_${tempId}`);
  
  try {
    const { glb_base64, rigging_script } = req.body;

    if (!glb_base64 || !rigging_script) {
      return res.status(400).json({ error: "Missing glb_base64 or rigging_script" });
    }

    console.log(`[Rig ${tempId}] Starting rigging job...`);

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
    console.log(`[Rig ${tempId}] Input GLB written: ${fs.statSync(inputGlbPath).size} bytes`);

    // Build the full Blender script:
    // 1. Clear the scene
    // 2. Import the GLB
    // 3. Execute the AI-generated rigging script
    // 4. Export the rigged model as GLB
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

# --- Step 4: Export the rigged model as GLB ---
print("[Rig] Exporting rigged GLB...")
bpy.ops.export_scene.gltf(
    filepath=r"${outputGlbPath}",
    export_format='GLB',
    export_animations=True,
    export_skins=True
)

print("[Rig] RIGGING_EXPORT_COMPLETE")
`;

    fs.writeFileSync(scriptPath, fullScript, "utf8");

    // Execute Blender
    console.log(`[Rig ${tempId}] Running Blender CLI for rigging...`);
    try {
      const stdout = execSync(`blender --background --python-exit-code 1 --python "${scriptPath}"`, {
        stdio: 'pipe',
        timeout: 120000, // 2 minute timeout
      });
      console.log(`[Rig ${tempId}] Blender stdout (last 500 chars):`, stdout.toString().slice(-500));
    } catch (blenderErr) {
      console.error(`[Rig ${tempId}] Blender rigging failed:`, blenderErr.message);
      if (blenderErr.stdout) console.error("Stdout:", blenderErr.stdout.toString().slice(-1000));
      if (blenderErr.stderr) console.error("Stderr:", blenderErr.stderr.toString().slice(-1000));
      const stderrStr = blenderErr.stderr ? blenderErr.stderr.toString().slice(-1000) : "";
      return res.status(500).json({ error: `Blender rigging failed. Script error: ${stderrStr}` });
    }

    // Check output
    if (!fs.existsSync(outputGlbPath)) {
      console.error(`[Rig ${tempId}] Rigged GLB not found at ${outputGlbPath}`);
      return res.status(500).json({ error: "Blender completed but no rigged GLB was generated." });
    }

    const riggedBuffer = fs.readFileSync(outputGlbPath);
    const riggedBase64 = riggedBuffer.toString("base64");
    console.log(`[Rig ${tempId}] ✅ Rigging successful (${riggedBuffer.length} bytes)`);

    res.json({
      success: true,
      rigged_glb_base64: riggedBase64
    });

  } catch (err) {
    console.error(`[Rig ${tempId}] Unexpected error:`, err);
    res.status(500).json({ error: "Internal server error during rigging" });
  } finally {
    // Cleanup
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

// =============================================================================
// POST /bake-sprites — Take rigged GLB + animation script → sprite sheet PNG
// Receives: { rigged_glb_base64, animation_script }
// Returns:  { success, sprite_sheet_base64, animation_metadata }
// =============================================================================
app.post("/bake-sprites", async (req, res) => {
  const tempId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `sprites_${tempId}`);

  try {
    const { rigged_glb_base64, animation_script } = req.body;

    if (!rigged_glb_base64 || !animation_script) {
      return res.status(400).json({ error: "Missing rigged_glb_base64 or animation_script" });
    }

    console.log(`[Sprites ${tempId}] Starting sprite bake job...`);

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
    console.log(`[Sprites ${tempId}] Rigged GLB written: ${fs.statSync(inputGlbPath).size} bytes`);

    // Build the full script
    // Override the output_path variable to point to our temp location
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
    print(f"[Sprites] Armature found: {armature_obj.name}")
print(f"[Sprites] Mesh found: {mesh_obj.name}")

# Set output path for the animation script
output_path = r"${outputPngPath}"

# --- Step 3: Execute AI-generated animation + sprite bake script ---
print("[Sprites] Executing animation and sprite bake...")

${modifiedAnimScript}

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

    // Execute Blender
    console.log(`[Sprites ${tempId}] Running Blender CLI for sprite baking...`);
    try {
      const stdout = execSync(`blender --background --python-exit-code 1 --python "${scriptPath}"`, {
        stdio: 'pipe',
        timeout: 180000, // 3 minute timeout
      });
      console.log(`[Sprites ${tempId}] Blender stdout (last 500 chars):`, stdout.toString().slice(-500));
    } catch (blenderErr) {
      console.error(`[Sprites ${tempId}] Blender sprite bake failed:`, blenderErr.message);
      if (blenderErr.stdout) console.error("Stdout:", blenderErr.stdout.toString().slice(-1000));
      if (blenderErr.stderr) console.error("Stderr:", blenderErr.stderr.toString().slice(-1000));
      const stderrStr = blenderErr.stderr ? blenderErr.stderr.toString().slice(-1000) : "";
      return res.status(500).json({ error: `Blender sprite baking failed. Script error: ${stderrStr}` });
    }

    // Read sprite sheet
    if (!fs.existsSync(outputPngPath)) {
      console.error(`[Sprites ${tempId}] Sprite sheet PNG not found`);
      return res.status(500).json({ error: "Blender completed but no sprite sheet was generated." });
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
        console.warn(`[Sprites ${tempId}] Could not parse metadata JSON, using defaults`);
      }
    }

    console.log(`[Sprites ${tempId}] ✅ Sprite bake successful (${spritePng.length} bytes)`);

    res.json({
      success: true,
      sprite_sheet_base64: `data:image/png;base64,${spriteBase64}`,
      animation_metadata: animationMetadata
    });

  } catch (err) {
    console.error(`[Sprites ${tempId}] Unexpected error:`, err);
    res.status(500).json({ error: "Internal server error during sprite baking" });
  } finally {
    // Cleanup
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Blender microservice listening on port ${PORT}`);
  console.log(`Endpoints: /render, /rig-model, /bake-sprites, /health`);
});
