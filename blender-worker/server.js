import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

const app = express();
const PORT = process.env.PORT || 10000;

// Increase limit for potentially large python scripts (though text is small)
app.use(express.json({ limit: "5mb" }));

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

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
    // We use stdio: 'pipe' so we don't flood the server logs unless it errors out.
    console.log(`[Job ${tempId}] Running Blender CLI...`);
    try {
      execSync(`blender --background --python "${scriptPath}"`, { stdio: 'pipe' });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Blender microservice listening on port ${PORT}`);
});
