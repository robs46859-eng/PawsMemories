import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { MIGRATIONS } from "../server/migrations/runner.ts";
import { RegisterFurBinItemRequestSchema } from "../server/fur-bin/schemas.ts";
import { inventoryFacialMorphs } from "../server/rig-pipeline/validation.ts";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("Phase 4-5 release contracts", async (t) => {
  await t.test("canonical foreign keys use BIGINT and bind owned asset versions", () => {
    const phase4 = MIGRATIONS.find((migration) => migration.version === 23);
    const phase5 = MIGRATIONS.find((migration) => migration.version === 24);
    assert.ok(phase4);
    assert.ok(phase5);
    const sql = [...phase4.statements, ...phase5.statements].join("\n");

    assert.doesNotMatch(sql, /(?:asset_id|version_id|model_build_job_id|accepted_artifact_id) INT UNSIGNED/);
    assert.match(sql, /FOREIGN KEY \(asset_id, current_version_id\) REFERENCES asset_versions\(asset_id, id\)/);
    assert.match(sql, /FOREIGN KEY \(asset_id, asset_version_id\) REFERENCES asset_versions\(asset_id, id\)/);
    assert.match(sql, /FOREIGN KEY \(model_build_job_id\) REFERENCES model_build_jobs\(id\)/);
  });

  await t.test("rig processing crosses an authenticated, measured worker boundary", () => {
    const source = read("server/rig-pipeline/service.ts");
    const worker = read("server/rig-pipeline/worker.ts");
    assert.match(source, /this\.worker\.process\(request\)/);
    assert.match(source, /verifyWorkerOutput\(request, result\)/);
    assert.match(worker, /x-worker-secret/);
    assert.match(worker, /RigWorkerResultSchema\.parse/);
    assert.doesNotMatch(source, /boneCount:\s*32/);
    assert.doesNotMatch(source, /\["viseme_a",\s*"viseme_b"/);

    const unverified = inventoryFacialMorphs(["viseme_a", "jaw_open"]);
    assert.equal(unverified.capability, "unsupported");
    assert.equal(unverified.deformationPass, false);
  });

  await t.test("rig acceptance UI submits the server manifest hash", () => {
    const source = read("src/components/create-flow/CreateRigReviewScreen.tsx");
    assert.match(source, /rigJob\.manifestHash/);
    assert.doesNotMatch(source, /"a"\.repeat\(64\)/);
  });

  await t.test("Fur Bin registration accepts canonical UUID/version identity only", () => {
    const valid = RegisterFurBinItemRequestSchema.parse({
      assetUuid: "123e4567-e89b-42d3-a456-426614174000",
      versionNumber: 1,
      title: "Measured model",
    });
    assert.equal(valid.versionNumber, 1);
    assert.throws(() => RegisterFurBinItemRequestSchema.parse({ assetId: 1, versionId: 1, title: "Unsafe" }));
  });

  await t.test("moderation and signed access do not use caller-supplied admin identity", () => {
    const routes = read("server/fur-bin/routes.ts");
    const service = read("server/fur-bin/service.ts");
    assert.match(routes, /checkAdmin\(moderatorId\)/);
    assert.match(service, /if \(!moderatorIsAdmin\)/);
    assert.match(service, /this\.signUrl\(asset, version, ownerId, false\)/);
    assert.doesNotMatch(service, /generateSignedUrlForVersion\(asset, version, ownerId, true\)/);
  });
});
