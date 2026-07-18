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

test("Animator and Video Creator source code is preserved (not deleted)", () => {
  // The component source files must remain intact even though they are gated
  // behind UnderConstructionLock in App.tsx.
  const builder = fs.readFileSync("src/animator/components/AnimatorScreen.tsx", "utf8");
  const videoCreator = fs.readFileSync("src/components/AnimationStudio.tsx", "utf8");
  assert.match(builder, /3D Animation Builder/);
  assert.match(builder, /Timeline[\s\S]*Dope Sheet[\s\S]*X-Sheet/);
  assert.match(builder, /workspaceTool/);
  assert.match(builder, /MousePointer2[\s\S]*Move3D[\s\S]*Bone/);
  assert.match(builder, /onOpenVideoCreator/);
  assert.match(videoCreator, /Video Creator/);
  assert.match(videoCreator, /Open 3D Animation Builder/);
});

test("Animator screen is gated with UnderConstructionLock in App.tsx", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  // Animator mode state and openAnimationStudio helper are retained
  assert.match(app, /useState<"simple" \| "pro">\("simple"\)/);
  assert.match(app, /const openAnimationStudio = \(\) => \{[\s\S]*setAnimatorMode\("simple"\)/);
  // But the ANIMATOR screen now renders UnderConstructionLock
  assert.match(app, /currentScreen === Screen\.ANIMATOR[\s\S]*UnderConstructionLock/);
  assert.match(app, /featureName="Animation Studio"/);
  // Fido's Styles is also gated
  assert.match(app, /currentScreen === Screen\.PAWLISHER[\s\S]*UnderConstructionLock/);
  assert.match(app, /featureName="Fido's Styles"/);
});
