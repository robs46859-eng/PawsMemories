import assert from "node:assert/strict";
import { test } from "node:test";
import { TriageSchema, classLabel, buildTriagePrompt, isClassMismatch } from "../server/imageTriage.ts";

// RD-5: the Phase 2 update widened subjectClass from 3 to 10 classes in a module
// shared with the legacy avatar pipeline. These contract tests pin the widened
// enum so a legacy unlock cannot regress silently.

const ALL_CLASSES = ["dog", "cat", "bird", "rabbit", "horse", "reptile", "small_animal", "other", "human", "object"];

const baseTriage = {
  classConfidence: 0.9,
  reason: "test",
  qualify: { score: 0.9 },
};

test("TriageSchema accepts every widened subject class", () => {
  for (const subjectClass of ALL_CLASSES) {
    const parsed = TriageSchema.safeParse({ ...baseTriage, subjectClass });
    assert.ok(parsed.success, `subjectClass '${subjectClass}' must parse: ${parsed.success ? "" : parsed.error.message}`);
  }
});

test("TriageSchema rejects unknown subject classes", () => {
  assert.ok(!TriageSchema.safeParse({ ...baseTriage, subjectClass: "dragon" }).success);
  assert.ok(!TriageSchema.safeParse({ ...baseTriage, subjectClass: "" }).success);
});

test("classLabel maps every widened class to a human label", () => {
  for (const subjectClass of ALL_CLASSES) {
    const label = classLabel(subjectClass);
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, `classLabel('${subjectClass}') must not be empty`);
  }
});

test("buildTriagePrompt works for every widened class", () => {
  for (const subjectClass of ALL_CLASSES) {
    const prompt = buildTriagePrompt(subjectClass);
    assert.ok(prompt.includes("STRICT JSON"), `prompt for '${subjectClass}' must carry the strict-JSON contract`);
  }
});

test("isClassMismatch honors confidence threshold across widened classes", () => {
  const detectedCat = TriageSchema.parse({ ...baseTriage, subjectClass: "cat", classConfidence: 0.95 });
  assert.equal(isClassMismatch(detectedCat, "dog"), true);
  assert.equal(isClassMismatch(detectedCat, "cat"), false);
  const lowConfidence = TriageSchema.parse({ ...baseTriage, subjectClass: "cat", classConfidence: 0.5 });
  assert.equal(isClassMismatch(lowConfidence, "dog"), false);
});
