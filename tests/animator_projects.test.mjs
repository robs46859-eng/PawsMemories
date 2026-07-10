import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { createProject, getProject, listProjects, updateProject, deleteProject } from "../server/animator/projects.ts";
import { initializeWorkspace, resolveWithinWorkspace } from "../server/animator/paths.ts";

test("Projects - save/load round-trip with multi-actor project", () => {
  initializeWorkspace();
  const userA = "1234567890";
  const userB = "0987654321";
  
  const assetId = uuidv4();
  
  const projectInput = {
    name: "My Awesome Project",
    actors: [
      {
        actorId: uuidv4(),
        assetId: assetId,
        label: "Actor 1",
        transform: { position: [0,0,0], rotation: [0,0,0], scale: 1 },
        visible: true
      },
      {
        actorId: uuidv4(),
        assetId: assetId, // Same asset twice
        label: "Actor 2",
        transform: { position: [1,0,0], rotation: [0,0,0], scale: 1 },
        visible: true
      }
    ],
    recordSettings: { fps: 30 }
  };
  
  // Create project
  const project = createProject(userA, projectInput);
  assert.strictEqual(project.userPhone, userA);
  assert.strictEqual(project.actors.length, 2);
  assert.strictEqual(project.actors[0].assetId, project.actors[1].assetId);
  
  // Load project
  const loaded = getProject(project.id);
  assert.strictEqual(loaded.id, project.id);
  assert.strictEqual(loaded.name, "My Awesome Project");
  assert.deepStrictEqual(loaded.actors, project.actors);
  
  // User B cannot load User A's project via API paths, but getProject itself doesn't check ownership
  // The route checks ownership. We will test updateProject/deleteProject ownership check
  
  assert.throws(() => {
    updateProject(project.id, userB, { name: "Hacked" });
  }, /Forbidden/);
  
  assert.throws(() => {
    deleteProject(project.id, userB);
  }, /Forbidden/);
  
  // Rejects corrupt JSON
  const p = resolveWithinWorkspace(`projects/${project.id}.json`);
  fs.writeFileSync(p, "{ bad json }");
  
  assert.throws(() => {
    getProject(project.id);
  });
  
  // Cleanup
  try { fs.unlinkSync(p); } catch (e) {}
});
