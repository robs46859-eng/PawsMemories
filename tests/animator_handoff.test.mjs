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

test("Video Creator is the Animate parent screen and contains the 3D Animation Builder", () => {
  const builder = fs.readFileSync("src/animator/components/AnimatorScreen.tsx", "utf8");
  const videoCreator = fs.readFileSync("src/components/AnimationStudio.tsx", "utf8");
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(builder, /3D Animation Builder/);
  assert.match(builder, /Timeline[\s\S]*Dope Sheet[\s\S]*X-Sheet/);
  assert.match(builder, /workspaceTool/);
  assert.match(builder, /MousePointer2[\s\S]*Move3D[\s\S]*Bone/);
  assert.match(builder, /onOpenVideoCreator/);
  assert.match(videoCreator, /Video Creator/);
  assert.match(videoCreator, /Open 3D Animation Builder/);
  assert.match(app, /useState<"simple" \| "pro">\("simple"\)/);
  assert.match(app, /const openAnimationStudio = \(\) => \{[\s\S]*setAnimatorMode\("simple"\)/);
  assert.match(app, /onOpenVideoCreator=\{\(\) => setAnimatorMode\("simple"\)\}/);
  assert.match(app, /onClose=\{openAnimationStudio\}/);
  const mobileNavigation = app.slice(app.indexOf("{MOBILE_NAV.map"));
  assert.match(mobileNavigation, /item\.screen === Screen\.ANIMATOR \? openAnimationStudio\(\)/);
});
