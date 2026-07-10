import test from "node:test";
import assert from "node:assert";
import path from "path";
import crypto from "crypto";

// We have to mock or just use the local file since we might need ts-node/tsx to load it.
// The test command uses tsx --test so we can import the .ts files directly!
import { resolveWithinWorkspace, buildOutputName } from "../server/animator/paths.ts";

test("animator_paths - resolveWithinWorkspace", async (t) => {
  const root = path.resolve("/tmp/animator_test_workspace");

  await t.test("allows valid files", () => {
    const res = resolveWithinWorkspace("valid.glb", root);
    assert.strictEqual(res, path.join(root, "valid.glb"));
  });

  await t.test("rejects path traversal", () => {
    assert.throws(() => resolveWithinWorkspace("../outside.glb", root), /Path traversal detected/);
    assert.throws(() => resolveWithinWorkspace("foo/../../outside.glb", root), /Path traversal detected/);
  });

  await t.test("allows valid extensions", () => {
    assert.doesNotThrow(() => resolveWithinWorkspace("model.glb", root));
    assert.doesNotThrow(() => resolveWithinWorkspace("model.gltf", root));
    assert.doesNotThrow(() => resolveWithinWorkspace("video.mp4", root));
    assert.doesNotThrow(() => resolveWithinWorkspace("shot.png", root));
  });

  await t.test("rejects invalid extensions", () => {
    assert.throws(() => resolveWithinWorkspace("model.exe", root), /Extension \.exe not allowed/);
    assert.throws(() => resolveWithinWorkspace("script.sh", root), /Extension \.sh not allowed/);
  });
});

test("animator_paths - buildOutputName", async (t) => {
  await t.test("generates stable, deterministic name", () => {
    const input = Buffer.from("hello world");
    const name1 = buildOutputName("my-file.glb", "pack", { q: 1 }, input);
    const name2 = buildOutputName("my-file.glb", "pack", { q: 1 }, input);
    assert.strictEqual(name1, name2);
    
    // Check format
    const parts = name1.split(".");
    assert.strictEqual(parts[0], "my-file");
    assert.strictEqual(parts[1], "pack");
    assert.strictEqual(parts[2].length, 6);
    assert.strictEqual(parts[3], "glb");
  });

  await t.test("sanitizes original filename", () => {
    const input = Buffer.from("hello");
    const name = buildOutputName("bad/\\file\0name.glb", "unpack", {}, input);
    assert.ok(name.startsWith("badfilename.unpack."));
    assert.ok(name.endsWith(".gltf"));
  });
});
