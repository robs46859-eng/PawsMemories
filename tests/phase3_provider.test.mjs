import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FakeModelBuildProvider, TripoModelBuildAdapter } from "../server/model-builds/provider.ts";

describe("Phase 3 Provider Port and Adapter Test Suite", () => {
  it("FakeModelBuildProvider should return valid GLB bytes", async () => {
    const fake = new FakeModelBuildProvider();
    const startRes = await fake.start({
      frontUrl: "https://api.tripo3d.ai/fake/front.png",
      leftUrl: "https://api.tripo3d.ai/fake/left.png",
      rightUrl: "https://api.tripo3d.ai/fake/right.png",
      rearUrl: "https://api.tripo3d.ai/fake/rear.png",
      threeQuarterUrl: "https://api.tripo3d.ai/fake/tq.png",
    }, "config123");

    assert.ok(startRes.providerTaskHandle.startsWith("fake:"));
    assert.equal(startRes.provider, "fake");

    // Poll 1
    const poll1 = await fake.poll(startRes.providerTaskHandle);
    assert.equal(poll1.done, false);

    // Poll 2
    const poll2 = await fake.poll(startRes.providerTaskHandle);
    assert.equal(poll2.done, true);
    assert.ok(poll2.glbUrl);

    // Download
    const bytes = await fake.download(poll2.glbUrl);
    assert.ok(bytes.length >= 12);
    assert.equal(bytes.readUInt32LE(0), 0x46546C67); // "glTF"
  });

  it("TripoModelBuildAdapter download should reject URLs outside allowlist", async () => {
    const adapter = new TripoModelBuildAdapter();
    await assert.rejects(
      async () => {
        await adapter.download("https://evil.com/malicious.glb");
      },
      (err) => err.message.includes("Blocked download URL"),
    );
  });

  it("TripoModelBuildAdapter download should reject non-HTTPS URLs", async () => {
    const adapter = new TripoModelBuildAdapter();
    await assert.rejects(
      async () => {
        await adapter.download("http://api.tripo3d.ai/fake.glb");
      },
      (err) => err.message.includes("Blocked download URL"),
    );
  });
});
