import assert from "node:assert/strict";
import { test } from "node:test";

const {
  parseAndValidateTriage,
  triagePasses,
  correctiveFromTriage,
  friendlyQualifyError,
  isClassMismatch,
  classLabel,
  triageReferenceImage,
  QUALIFY_PASS_SCORE,
} = await import("../server/imageTriage.ts");

/** Minimal valid triage object (schema defaults fill the rest). */
function makeTriage(over = {}) {
  const base = {
    subjectClass: "dog",
    classConfidence: 0.9,
    qualify: {
      score: 0.85,
      subjectPresent: true,
      singleSubject: true,
      fullSubjectVisible: true,
      poseOk: true,
      cleanBackground: true,
      bakedShadowsOrHarshLight: false,
      watermarkOrText: false,
    },
  };
  return { ...base, ...over, qualify: { ...base.qualify, ...(over.qualify || {}) } };
}

test("parseAndValidateTriage parses clean JSON", () => {
  const t = parseAndValidateTriage(JSON.stringify(makeTriage()));
  assert.equal(t.subjectClass, "dog");
  assert.equal(t.qualify.score, 0.85);
  // Defaults applied for omitted anatomy fields.
  assert.equal(t.bodyType, "static");
  assert.deepEqual(t.coatColors, []);
});

test("parseAndValidateTriage strips markdown code fences", () => {
  const fenced = "```json\n" + JSON.stringify(makeTriage({ subjectClass: "human" })) + "\n```";
  const t = parseAndValidateTriage(fenced);
  assert.equal(t.subjectClass, "human");
});

test("parseAndValidateTriage throws on garbage", () => {
  assert.throws(() => parseAndValidateTriage("not json at all"));
});

test("parseAndValidateTriage rejects an out-of-vocab subjectClass", () => {
  const bad = JSON.stringify(makeTriage({ subjectClass: "alien" }));
  assert.throws(() => parseAndValidateTriage(bad));
});

test("triagePasses: passes on a clean high-score image", () => {
  assert.equal(triagePasses(parseAndValidateTriage(JSON.stringify(makeTriage()))), true);
});

test("triagePasses: fails below the score threshold", () => {
  const t = parseAndValidateTriage(JSON.stringify(makeTriage({ qualify: { score: QUALIFY_PASS_SCORE - 0.1 } })));
  assert.equal(triagePasses(t), false);
});

test("triagePasses: hard flags veto even a high score", () => {
  for (const flag of [
    { subjectPresent: false },
    { singleSubject: false },
    { fullSubjectVisible: false },
    { watermarkOrText: true },
  ]) {
    const t = parseAndValidateTriage(JSON.stringify(makeTriage({ qualify: { score: 0.99, ...flag } })));
    assert.equal(triagePasses(t), false, `expected veto for ${JSON.stringify(flag)}`);
  }
});

test("correctiveFromTriage names the failed issues", () => {
  const t = parseAndValidateTriage(JSON.stringify(makeTriage({
    qualify: { score: 0.2, singleSubject: false, fullSubjectVisible: false, watermarkOrText: true },
  })));
  const c = correctiveFromTriage(t);
  assert.match(c, /ONE subject/);
  assert.match(c, /FULL subject/);
  assert.match(c, /watermark/);
});

test("friendlyQualifyError is safe with null and includes guidance", () => {
  assert.match(friendlyQualifyError(null), /clean enough/);
  const t = parseAndValidateTriage(JSON.stringify(makeTriage({ qualify: { score: 0.1, cleanBackground: false } })));
  assert.match(friendlyQualifyError(t), /background/);
});

test("isClassMismatch only fires above the confidence floor", () => {
  const mismatchHigh = parseAndValidateTriage(JSON.stringify(makeTriage({ subjectClass: "object", classConfidence: 0.95 })));
  const mismatchLow = parseAndValidateTriage(JSON.stringify(makeTriage({ subjectClass: "object", classConfidence: 0.5 })));
  assert.equal(isClassMismatch(mismatchHigh, "dog"), true);
  assert.equal(isClassMismatch(mismatchLow, "dog"), false);
  // Same class is never a mismatch.
  assert.equal(isClassMismatch(mismatchHigh, "object"), false);
});

test("classLabel maps classes to human-readable words", () => {
  assert.equal(classLabel("dog"), "animal");
  assert.equal(classLabel("human"), "person");
  assert.equal(classLabel("object"), "static object");
});

test("triageReferenceImage retries once at temperature 0 on bad JSON", async () => {
  const temps = [];
  let calls = 0;
  const generate = async ({ temperature }) => {
    temps.push(temperature);
    calls++;
    if (calls === 1) return "totally not json"; // first attempt fails to parse
    return JSON.stringify(makeTriage({ subjectClass: "human" }));
  };
  const result = await triageReferenceImage(generate, { imageBase64: "abc", userType: "human" });
  assert.equal(calls, 2);
  assert.equal(temps[0], 0.3);
  assert.equal(temps[1], 0); // deterministic retry
  assert.equal(result.subjectClass, "human");
});

test("triageReferenceImage throws if both attempts fail", async () => {
  const generate = async () => "still not json";
  await assert.rejects(() => triageReferenceImage(generate, { imageBase64: "abc", userType: "dog" }));
});

test("triageReferenceImage strips a data URL prefix before sending", async () => {
  let sawData = null;
  const generate = async ({ imageBase64 }) => {
    sawData = imageBase64;
    return JSON.stringify(makeTriage());
  };
  await triageReferenceImage(generate, { imageBase64: "data:image/png;base64,ZZZZ", userType: "dog" });
  assert.equal(sawData, "ZZZZ"); // prefix removed
});
