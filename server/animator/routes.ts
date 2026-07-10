import express from "express";
import fs from "fs";
import { importAsset } from "./assets.ts";
import { inspectAsset } from "./gltf.ts";
import { enqueue, JobSpecSchema } from "./queue.ts";
import { readManifest } from "./manifest.ts";
import { resolveWithinWorkspace } from "./paths.ts";
import { createProject, getProject, listProjects, updateProject, deleteProject } from "./projects.ts";
import { uploadBase64Binary } from "../../storage.ts";

export const animatorRouter = express.Router();

function handleError(res: express.Response, e: any) {
  if (e.message === "ANIMATOR_UNAVAILABLE") {
    res.status(503).json({ code: "ANIMATOR_UNAVAILABLE", error: "Animator dependencies missing on server" });
  } else {
    res.status(500).json({ error: e.message });
  }
}

animatorRouter.post("/animator/assets", async (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const { modelUrl, base64Bytes, originalFilename } = req.body;
    
    let sourceBuffer: Buffer | undefined;
    if (base64Bytes) {
      sourceBuffer = Buffer.from(base64Bytes, 'base64');
    }

    const metadata = await importAsset({
      userPhone,
      sourceBuffer,
      sourceUrl: modelUrl,
      originalFilename: originalFilename || "model.glb"
    });
    
    res.json(metadata);
  } catch (e: any) {
    if (e.message === "ANIMATOR_UNAVAILABLE") return handleError(res, e);
    res.status(400).json({ error: e.message });
  }
});

animatorRouter.get("/animator/assets", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const originalsDir = resolveWithinWorkspace("originals");
    if (!fs.existsSync(originalsDir)) {
      return res.json([]);
    }
    const dirs = fs.readdirSync(originalsDir);
    const assets = [];
    for (const dir of dirs) {
      const metaPath = resolveWithinWorkspace(`originals/${dir}/metadata.json`);
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (meta.userPhone === userPhone) {
          assets.push(meta);
        }
      }
    }
    res.json(assets);
  } catch (e: any) {
    handleError(res, e);
  }
});

animatorRouter.get("/animator/assets/:id", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const metaPath = resolveWithinWorkspace(`originals/${req.params.id}/metadata.json`);
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: "Asset not found" });
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.userPhone && meta.userPhone !== userPhone) return res.status(403).json({ error: "Forbidden" });
    res.json(meta);
  } catch (e: any) {
    handleError(res, e);
  }
});

animatorRouter.get("/animator/assets/:id/inspect", async (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const metaPath = resolveWithinWorkspace(`originals/${req.params.id}/metadata.json`);
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: "Asset not found" });
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.userPhone && meta.userPhone !== userPhone) return res.status(403).json({ error: "Forbidden" });
    
    const safeOriginal = meta.originalFilename.replace(/[^a-zA-Z0-9_\-\.]/g, "");
    const absPath = resolveWithinWorkspace(`originals/${req.params.id}/${safeOriginal}`);
    
    const freshMeta = await inspectAsset(absPath, meta.originalFilename);
    freshMeta.id = req.params.id;
    freshMeta.userPhone = meta.userPhone;
    res.json(freshMeta);
  } catch (e: any) {
    handleError(res, e);
  }
});

animatorRouter.post("/animator/jobs", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    if (req.body.preset === "optimize") {
      return res.status(400).json({ error: "optimize preset not available yet" });
    }
    
    const rawSpec = {
      ...req.body,
      id: "00000000-0000-0000-0000-000000000000",
      userPhone,
      createdAt: new Date().toISOString()
    };
    
    JobSpecSchema.parse(rawSpec);
    
    // Check if asset belongs to user
    const metaPath = resolveWithinWorkspace(`originals/${req.body.assetId}/metadata.json`);
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.userPhone && meta.userPhone !== userPhone) return res.status(403).json({ error: "Forbidden" });
    }
    
    const job = enqueue({
      userPhone,
      assetId: req.body.assetId,
      type: req.body.type,
      preset: req.body.preset,
      params: req.body.params || {}
    });
    
    res.json({ jobId: job.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

animatorRouter.get("/animator/jobs/:id", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const dirs = ["pending", "running", "done", "failed"];
    for (const dir of dirs) {
      try {
        const p = resolveWithinWorkspace(`jobs/${dir}/${req.params.id}.json`);
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, "utf8");
          const job = JSON.parse(content);
          if (job.userPhone && job.userPhone !== userPhone) return res.status(403).json({ error: "Forbidden" });
          return res.json(job);
        }
      } catch (err) {}
    }
    res.status(404).json({ error: "Job not found" });
  } catch (e: any) {
    handleError(res, e);
  }
});

animatorRouter.get("/animator/jobs", (req: any, res) => {
  res.json([]);
});

animatorRouter.get("/animator/jobs/:id/manifest", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    // verify job ownership first
    let job: any;
    const dirs = ["pending", "running", "done", "failed"];
    for (const dir of dirs) {
      try {
        const p = resolveWithinWorkspace(`jobs/${dir}/${req.params.id}.json`);
        if (fs.existsSync(p)) {
          job = JSON.parse(fs.readFileSync(p, "utf8"));
          break;
        }
      } catch (err) {}
    }
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.userPhone && job.userPhone !== userPhone) return res.status(403).json({ error: "Forbidden" });
    
    const manifest = readManifest(req.params.id);
    res.json(manifest);
  } catch (e: any) {
    res.status(404).json({ error: "Manifest not found" });
  }
});

animatorRouter.get("/animator/outputs/:assetId", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const metaPath = resolveWithinWorkspace(`originals/${req.params.assetId}/metadata.json`);
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.userPhone && meta.userPhone !== userPhone) return res.status(403).json({ error: "Forbidden" });
    }
    
    const outDir = resolveWithinWorkspace(`outputs/${req.params.assetId}`);
    if (!fs.existsSync(outDir)) return res.json([]);
    const files = fs.readdirSync(outDir);
    res.json(files.map(f => ({
      path: `outputs/${req.params.assetId}/${f}`,
      url: `/animator-files/outputs/${req.params.assetId}/${f}`
    })));
  } catch (e: any) {
    handleError(res, e);
  }
});

animatorRouter.post("/animator/projects", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const project = createProject(userPhone, req.body);
    res.json(project);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

animatorRouter.get("/animator/projects", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const projects = listProjects(userPhone);
    res.json(projects);
  } catch (e: any) {
    handleError(res, e);
  }
});

animatorRouter.get("/animator/projects/:id", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const project = getProject(req.params.id);
    if (project.userPhone !== userPhone) return res.status(403).json({ error: "Forbidden" });
    res.json(project);
  } catch (e: any) {
    res.status(404).json({ error: "Project not found" });
  }
});

animatorRouter.put("/animator/projects/:id", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    const project = updateProject(req.params.id, userPhone, req.body);
    res.json(project);
  } catch (e: any) {
    if (e.message === "Forbidden") return res.status(403).json({ error: "Forbidden" });
    res.status(400).json({ error: e.message });
  }
});

animatorRouter.delete("/animator/projects/:id", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    deleteProject(req.params.id, userPhone);
    res.json({ success: true });
  } catch (e: any) {
    if (e.message === "Forbidden") return res.status(403).json({ error: "Forbidden" });
    res.status(400).json({ error: e.message });
  }
});

import multer from "multer";
import path from "path";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for webm
});

animatorRouter.post("/animator/recordings", upload.single("video"), async (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    if (!req.file) return res.status(400).json({ error: "No video file provided" });
    
    const outDir = resolveWithinWorkspace("recordings");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    // Derive the container from the uploaded blob's mime so a WebCodecs MP4
    // recording is stored as .mp4 and only the MediaRecorder fallback is .webm.
    const mime = (req.file.mimetype && req.file.mimetype.startsWith("video/"))
      ? req.file.mimetype
      : "video/mp4";
    const ext = mime.includes("webm") ? "webm" : "mp4";
    const filename = `recording_${Date.now()}_${userPhone.replace(/[^a-zA-Z0-9]/g, "")}.${ext}`;
    const absPath = path.join(outDir, filename);

    fs.writeFileSync(absPath, req.file.buffer);

    let url = `/animator-files/recordings/${filename}`;
    try {
      const base64Str = req.file.buffer.toString("base64");
      const bucketUrl = await uploadBase64Binary(base64Str, mime);
      if (bucketUrl) url = bucketUrl;
    } catch (uploadErr) {
      console.warn("Storage mirror failed, falling back to local URL", uploadErr);
    }
    
    res.json({ url });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

animatorRouter.post("/animator/screenshots", upload.single("image"), async (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    if (!req.file) return res.status(400).json({ error: "No image file provided" });
    
    const outDir = resolveWithinWorkspace("screenshots");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const filename = `screenshot_${Date.now()}_${userPhone.replace(/[^a-zA-Z0-9]/g, "")}.png`;
    const absPath = path.join(outDir, filename);
    
    fs.writeFileSync(absPath, req.file.buffer);
    
    let url = `/animator-files/screenshots/${filename}`;
    try {
      const base64Str = req.file.buffer.toString("base64");
      const bucketUrl = await uploadBase64Binary(base64Str, "image/png");
      if (bucketUrl) url = bucketUrl;
    } catch (uploadErr) {
      console.warn("Storage mirror failed, falling back to local URL", uploadErr);
    }
    
    res.json({ url });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
