import assert from "node:assert/strict";
import { test } from "node:test";
import { planPawprintCollage } from "../src/pawprints/collageEngine.ts";

const layouts = ["classic", "overlay", "split", "frame", "story", "filmstrip", "circles", "mosaic"];

test("Pawprints collage plans support one through twelve photos", () => {
  for (const layout of layouts) {
    for (let count = 1; count <= 12; count += 1) {
      const plan = planPawprintCollage(layout, count);
      assert.equal(plan.photos.length, count);
      for (const rect of [...plan.photos, plan.text]) {
        assert.ok(rect.x >= 0 && rect.y >= 0);
        assert.ok(rect.width > 0 && rect.height > 0);
        assert.ok(rect.x + rect.width <= 1.000001);
        assert.ok(rect.y + rect.height <= 1.000001);
      }
    }
  }
});

test("layout output is deterministic and bounded to twelve photos", () => {
  assert.deepEqual(planPawprintCollage("classic", 4), planPawprintCollage("classic", 4));
  assert.equal(planPawprintCollage("overlay", 100).photos.length, 12);
  assert.equal(planPawprintCollage("frame", 0).photos.length, 1);
});

test("every layout reserves a usable text region", () => {
  for (const layout of layouts) {
    const plan = planPawprintCollage(layout, 6);
    assert.ok(plan.text.width >= 0.3);
    assert.ok(plan.text.height >= 0.1);
  }
});
