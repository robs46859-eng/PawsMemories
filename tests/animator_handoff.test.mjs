import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("Animator entry points hand off GLB URLs instead of avatar database ids", () => {
  const pawlisher = fs.readFileSync("src/components/FidosStylesScreen.tsx", "utf8");
  const models = fs.readFileSync("src/components/AvatarDashboard.tsx", "utf8");
  assert.match(pawlisher, /onGoToAnimator\?\.\(modelUrl\)/);
  assert.doesNotMatch(pawlisher, /onGoToAnimator\?\.\(String\(selected\.id\)\)/);
  assert.match(models, /onGoToAnimator\?\.\(glbUrl\)/);
  assert.doesNotMatch(models, /onGoToAnimator\?\.\(String\(avatar\.id\)\)/);
});

test("Scene controller wrapper is memoized so initial asset loading cannot loop", () => {
  const source = fs.readFileSync("src/animator/controller/useSceneController.ts", "utf8");
  assert.match(source, /const wrappedController = useMemo/);
});
