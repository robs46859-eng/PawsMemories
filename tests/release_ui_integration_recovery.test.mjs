import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_MODEL_YAW_CORRECTION_DEGREES,
  modelViewerCameraOrbit,
} from "../src/three/modelPresentation.ts";

const viewer = fs.readFileSync("src/components/PetModelViewer.tsx", "utf8");
const furbin = fs.readFileSync("src/components/FurBinScreen.tsx", "utf8");
const dashboard = fs.readFileSync("src/components/AvatarDashboard.tsx", "utf8");
const wagsInbox = fs.readFileSync("src/components/WagsInboxScreen.tsx", "utf8");
const wagsAdmin = fs.readFileSync("src/components/WagsAdminPanel.tsx", "utf8");
const server = fs.readFileSync("server.ts", "utf8");

test("model geometry rotation is undone and the camera moves horizontally instead", () => {
  assert.equal(DEFAULT_MODEL_YAW_CORRECTION_DEGREES, 0);
  assert.equal(modelViewerCameraOrbit(90), "90deg 80deg 105%");
  assert.match(viewer, /camera-orbit=\{modelViewerCameraOrbit\(cameraAzimuthDegrees\)\}/);
  assert.doesNotMatch(viewer, /orientation=\{/);
});

test("model cards establish bounded paint layers and model actions stay visible", () => {
  assert.match(furbin, /isolate overflow-hidden/);
  assert.match(furbin, /relative isolate overflow-hidden/);
  assert.match(dashboard, /bottom-2 right-2 z-40/);
  assert.match(dashboard, /top-4 right-4 z-30/);
});

test("disabled Wags v2 is a JSON availability response rather than SPA HTML", () => {
  assert.match(server, /app\.get\(\"\/api\/wags-v2\/status\"/);
  assert.match(wagsInbox, /\/api\/wags-v2\/status/);
  assert.match(wagsInbox, /readJsonResponse/);
});

test("Wags replanning addresses the box being edited, not a stale subscription id", () => {
  assert.match(server, /\/api\/admin\/wags\/boxes\/:boxId\/replan/);
  assert.match(wagsAdmin, /boxes\/\$\{box\.id\}\/replan/);
});

test("Printful diagnostics return safe provider state and never expose the token", () => {
  assert.match(server, /\/api\/admin\/customizer\/diagnostics/);
  assert.match(server, /verifyPrintfulCatalogConnection/);
  const diagnosticBlock = server.slice(
    server.indexOf('"/api/admin/customizer/diagnostics"'),
    server.indexOf('"/api/admin/customizer/products"', server.indexOf('"/api/admin/customizer/diagnostics"')),
  );
  assert.doesNotMatch(diagnosticBlock, /PRINTFUL_API_KEY|Authorization/);
});

test("creation-backed models have the same remove and restore lifecycle as legacy avatars", () => {
  assert.match(server, /\/api\/models\/:sourceType\/:id/);
  assert.match(server, /sourceType === "creation"/);
  assert.match(furbin, /removeModelFromLibrary\(model\.source_type, model\.id\)/);
  assert.doesNotMatch(furbin, /model\.source_type === "avatar" && <button[^>]*handleRemoveModel/);
});
