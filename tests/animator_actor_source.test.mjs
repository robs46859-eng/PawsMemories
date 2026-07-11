import test from "node:test";
import assert from "node:assert";
import { filterReadyAvatars, resolveAvatarGlbUrl } from "../src/animator/utils/avatarUtils.ts";

test("animator_actor_source", async (t) => {
  await t.test("resolveAvatarGlbUrl prefers rigged_model_url", () => {
    const url = resolveAvatarGlbUrl({
      id: "1", name: "A", generation_status: "done",
      model_url: "static.glb",
      rigged_model_url: "rigged.glb"
    });
    assert.strictEqual(url, "rigged.glb");
  });

  await t.test("resolveAvatarGlbUrl falls back to model_url if no rig", () => {
    const url = resolveAvatarGlbUrl({
      id: "2", name: "B", generation_status: "done",
      model_url: "static.glb"
    });
    assert.strictEqual(url, "static.glb");
  });

  await t.test("filterReadyAvatars excludes non-done avatars", () => {
    const filtered = filterReadyAvatars([
      { id: "1", name: "Done", generation_status: "done", model_url: "url1" },
      { id: "2", name: "Pending", generation_status: "pending", model_url: "url2" },
      { id: "3", name: "Failed", generation_status: "failed", model_url: "url3" },
      { id: "4", name: "NoModel", generation_status: "done" } // no model_url or rigged_model_url
    ]);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, "1");
  });
});
