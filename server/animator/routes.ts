import express from "express";
import fs from "fs";
import { importAsset } from "./assets.ts";
import { inspectAsset } from "./gltf.ts";
import { enqueue, JobSpecSchema } from "./queue.ts";
import { readManifest } from "./manifest.ts";
import { resolveWithinWorkspace } from "./paths.ts";

export const animatorRouter = express.Router();

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
    res.status(400).json({ error: e.message });
  }
});

animatorRouter.get("/animator/assets", (req: any, res) => {
  try {
    // List caller's assets
    // Since we don't have a DB yet, we can scan originals/ and read metadata.json
    // and filter by userPhone if we stored it in metadata. Wait, we didn't store userPhone in metadata.
    // For Phase 2, we just return all or empty if we can't filter.
    // Let's just return a placeholder or scan all metadata.
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
        assets.push(meta);
      }
    }
    res.json(assets);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

animatorRouter.get("/animator/assets/:id", (req: any, res) => {
  try {
    const metaPath = resolveWithinWorkspace(`originals/${req.params.id}/metadata.json`);
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: "Asset not found" });
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    res.json(meta);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

animatorRouter.get("/animator/assets/:id/inspect", async (req: any, res) => {
  try {
    const metaPath = resolveWithinWorkspace(`originals/${req.params.id}/metadata.json`);
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: "Asset not found" });
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    
    const safeOriginal = meta.originalFilename.replace(/[^a-zA-Z0-9_\-\.]/g, "");
    const absPath = resolveWithinWorkspace(`originals/${req.params.id}/${safeOriginal}`);
    
    const freshMeta = await inspectAsset(absPath, meta.originalFilename);
    freshMeta.id = req.params.id;
    res.json(freshMeta);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

animatorRouter.post("/animator/jobs", (req: any, res) => {
  try {
    const userPhone = req.user!.phone;
    if (req.body.preset === "optimize") {
      return res.status(400).json({ error: "optimize preset not available yet" });
    }
    
    // Create a mock spec for validation without id/createdAt
    const rawSpec = {
      ...req.body,
      id: "00000000-0000-0000-0000-000000000000",
      userPhone,
      createdAt: new Date().toISOString()
    };
    
    // Will throw if invalid
    JobSpecSchema.parse(rawSpec);
    
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
    const dirs = ["pending", "running", "done", "failed"];
    for (const dir of dirs) {
      try {
        const p = resolveWithinWorkspace(`jobs/${dir}/${req.params.id}.json`);
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, "utf8");
          return res.json(JSON.parse(content));
        }
      } catch (err) {} // ignore traversal errors if any
    }
    res.status(404).json({ error: "Job not found" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

animatorRouter.get("/animator/jobs", (req: any, res) => {
  // Mock listing for now
  res.json([]);
});

animatorRouter.get("/animator/jobs/:id/manifest", (req: any, res) => {
  try {
    const manifest = readManifest(req.params.id);
    res.json(manifest);
  } catch (e: any) {
    res.status(404).json({ error: "Manifest not found" });
  }
});

animatorRouter.get("/animator/outputs/:assetId", (req: any, res) => {
  try {
    const outDir = resolveWithinWorkspace(`outputs/${req.params.assetId}`);
    if (!fs.existsSync(outDir)) return res.json([]);
    const files = fs.readdirSync(outDir);
    // return files
    res.json(files.map(f => ({
      path: `outputs/${req.params.assetId}/${f}`,
      url: `/animator-files/outputs/${req.params.assetId}/${f}`
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
