import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HUMAN_FULLBODY_SPEC,
  buildReferencePrompt,
  turnaroundViewsForType,
} from "../avatarPrompts.ts";
import {
  buildTriagePrompt,
  correctiveFromTriage,
  parseAndValidateTriage,
  triagePasses,
} from "../server/imageTriage.ts";

function makeTriage(subjectClass, humanFraming) {
  return parseAndValidateTriage(JSON.stringify({
    subjectClass,
    classConfidence: 0.99,
    qualify: {
      score: 0.99,
      subjectPresent: true,
      singleSubject: true,
      fullSubjectVisible: true,
      poseOk: true,
      cleanBackground: true,
      bakedShadowsOrHarshLight: false,
      watermarkOrText: false,
      ...(humanFraming ? { humanFraming } : {}),
    },
  }));
}

const completeHumanFraming = {
  headFullyVisible: true,
  leftFootFullyVisible: true,
  rightFootFullyVisible: true,
  safeMarginAboveHead: true,
  safeMarginBelowFeet: true,
  cropLocation: "none",
};

test("human source-image prompt requires head-through-feet framing and safe margins", () => {
  const prompt = buildReferencePrompt("human").toLowerCase();

  assert.ok(prompt.includes(HUMAN_FULLBODY_SPEC.toLowerCase()));
  assert.match(prompt, /pulled-back camera/);
  assert.match(prompt, /both complete feet/);
  assert.match(prompt, /safe margin/);
  assert.match(prompt, /above the head/);
  assert.match(prompt, /below both feet/);
  assert.match(prompt, /cropped at the knees or ankles is invalid/);
});

test("every human turnaround prompt preserves complete-body framing", () => {
  for (const { view, prompt } of turnaroundViewsForType("human")) {
    const lower = prompt.toLowerCase();
    assert.match(lower, /both complete feet/, `${view} must show both complete feet`);
    assert.match(lower, /safe margin/, `${view} must retain safe margins`);
    assert.match(lower, /knees or ankles/, `${view} must prohibit knee/ankle crops`);
  }
});

test("animal prompt and turnaround do not inherit the human-only framing contract", () => {
  assert.ok(!buildReferencePrompt("dog").includes(HUMAN_FULLBODY_SPEC));
  for (const { prompt } of turnaroundViewsForType("dog")) {
    assert.doesNotMatch(prompt, /knees or ankles|both complete feet/i);
  }
});

test("human triage prompt requires explicit edge and foot evidence", () => {
  const prompt = buildTriagePrompt("human");

  for (const field of [
    "headFullyVisible",
    "leftFootFullyVisible",
    "rightFootFullyVisible",
    "safeMarginAboveHead",
    "safeMarginBelowFeet",
    "cropLocation",
  ]) {
    assert.ok(prompt.includes(field), `missing human framing field ${field}`);
  }
  assert.match(prompt, /knee-up or ankle-cropped person is NEVER full-body/);
});

test("complete human framing passes", () => {
  assert.equal(triagePasses(makeTriage("human", completeHumanFraming)), true);
});

test("human framing fails closed when the framing assessment is omitted", () => {
  assert.equal(triagePasses(makeTriage("human")), false);
});

test("human references cropped at knees or ankles cannot pass", () => {
  for (const cropLocation of ["knees", "ankles"]) {
    const triage = makeTriage("human", {
      ...completeHumanFraming,
      leftFootFullyVisible: false,
      rightFootFullyVisible: false,
      safeMarginBelowFeet: false,
      cropLocation,
    });

    assert.equal(triagePasses(triage), false, `${cropLocation} crop must fail`);
    assert.match(correctiveFromTriage(triage), /complete person.*both complete feet/i);
    assert.match(correctiveFromTriage(triage), /never crop at the knees or ankles/i);
  }
});

test("human references with feet touching the frame edge cannot pass", () => {
  const triage = makeTriage("human", {
    ...completeHumanFraming,
    safeMarginBelowFeet: false,
    cropLocation: "other",
  });

  assert.equal(triagePasses(triage), false);
});

test("animal qualification remains independent of human framing fields", () => {
  assert.equal(triagePasses(makeTriage("dog")), true);
  assert.equal(triagePasses(makeTriage("dog", {
    ...completeHumanFraming,
    cropLocation: "ankles",
  })), true);
});
