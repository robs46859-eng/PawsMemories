import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { resolveWithinWorkspace } from "./paths.ts";

const SceneActorSchema = z.object({
  actorId: z.string(),
  assetId: z.string(),
  label: z.string(),
  transform: z.object({
    position: z.tuple([z.number(), z.number(), z.number()]),
    rotation: z.tuple([z.number(), z.number(), z.number()]),
    scale: z.number(),
  }),
  selectedClip: z.string().optional(),
  visible: z.boolean(),
});

const CameraBookmarkSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  target: z.tuple([z.number(), z.number(), z.number()]),
  fov: z.number(),
});

export const ProjectRecordSchema = z.object({
  id: z.string().uuid(),
  userPhone: z.string(),
  name: z.string(),
  actors: z.array(SceneActorSchema),
  activeActorId: z.string().nullable(),
  camera: CameraBookmarkSchema.optional(),
  recordSettings: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export function createProject(userPhone: string, partial: Partial<ProjectRecord>): ProjectRecord {
  const now = new Date().toISOString();
  const id = uuidv4();
  const name = partial.name || `Project — ${new Date().toLocaleDateString()}`;
  
  const record: ProjectRecord = {
    id,
    userPhone,
    name,
    actors: partial.actors || [],
    activeActorId: partial.activeActorId || null,
    camera: partial.camera,
    recordSettings: partial.recordSettings || {},
    createdAt: now,
    updatedAt: now,
  };

  ProjectRecordSchema.parse(record);
  
  const p = resolveWithinWorkspace(`projects/${id}.json`);
  fs.writeFileSync(p, JSON.stringify(record, null, 2));
  
  return record;
}

export function getProject(id: string): ProjectRecord {
  const p = resolveWithinWorkspace(`projects/${id}.json`);
  if (!fs.existsSync(p)) {
    throw new Error("Project not found");
  }
  const content = fs.readFileSync(p, "utf8");
  return JSON.parse(content) as ProjectRecord;
}

export function listProjects(userPhone: string): ProjectRecord[] {
  const dir = resolveWithinWorkspace("projects");
  if (!fs.existsSync(dir)) return [];
  
  const files = fs.readdirSync(dir);
  const projects: ProjectRecord[] = [];
  
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = resolveWithinWorkspace(`projects/${f}`);
      const content = fs.readFileSync(p, "utf8");
      const record = JSON.parse(content) as ProjectRecord;
      if (record.userPhone === userPhone) {
        projects.push(record);
      }
    } catch (err) {
      // ignore bad files
    }
  }
  
  // return newest first
  projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return projects;
}

export function updateProject(id: string, userPhone: string, updates: Partial<ProjectRecord>): ProjectRecord {
  const record = getProject(id);
  if (record.userPhone !== userPhone) {
    throw new Error("Forbidden");
  }
  
  const updated = {
    ...record,
    ...updates,
    id: record.id,
    userPhone: record.userPhone, // prevent override
    updatedAt: new Date().toISOString()
  };
  
  ProjectRecordSchema.parse(updated);
  
  const p = resolveWithinWorkspace(`projects/${id}.json`);
  fs.writeFileSync(p, JSON.stringify(updated, null, 2));
  
  return updated;
}

export function deleteProject(id: string, userPhone: string): void {
  const record = getProject(id);
  if (record.userPhone !== userPhone) {
    throw new Error("Forbidden");
  }
  const p = resolveWithinWorkspace(`projects/${id}.json`);
  fs.unlinkSync(p);
}
