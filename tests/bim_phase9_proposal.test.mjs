import assert from "node:assert/strict";
import { test } from "node:test";
import { BIM_PROPOSAL_SYSTEM_INSTRUCTION, BimProposalRequestSchema, buildBimProposalPrompt, parseBimProposal, validateBimProposalImages } from "../server/bim/proposal.ts";

const calibration = {
  sourceKind: "text", sourceDescription: "A measured rectangular single-room shed with a flat roof.", imageViews: [], synthesizedImageViews: [],
  measurements: [
    { id: "width", axis: "width", value: 4, unit: "m", source: "user_measurement" },
    { id: "depth", axis: "depth", value: 3, unit: "m", source: "user_measurement" },
    { id: "height", axis: "height", value: 2.5, unit: "m", source: "user_measurement" },
  ],
  userConfirmedAssumptions: ["The description and measurements are approved for proposal authoring."],
};

const request = BimProposalRequestSchema.parse({ mode: "shell", calibration, images: [] });
const model = {
  name: "Measured shed", siteName: "Site", buildingName: "Shed",
  levels: [{ id: "level-0", name: "Ground", elevation: 0 }],
  elements: [
    { id: "floor", type: "slab", name: "Floor", levelId: "level-0", position: [0, 0, 0], width: 4, depth: 3, height: 0.15, properties: { Provenance: "measured", EvidenceRef: "measurement:width" } },
    { id: "volume", type: "space", name: "Room", levelId: "level-0", position: [0, 0, 0], width: 4, depth: 3, height: 2.5, properties: { Provenance: "inferred" } },
  ],
};

test("proposal request requires multiple observed images and rejects duplicate views", () => {
  const imageCalibration = { ...calibration, sourceKind: "image", imageViews: ["front", "left"] };
  assert.equal(BimProposalRequestSchema.safeParse({ mode: "shell", calibration: imageCalibration, images: [] }).success, false);
  const image = { view: "front", mimeType: "image/jpeg", data: "A".repeat(32) };
  assert.equal(BimProposalRequestSchema.safeParse({ mode: "shell", calibration: imageCalibration, images: [image, image] }).success, false);
});

test("proposal images are decoded and checked against MIME and pixel limits", async () => {
  const images = [{ view: "front", mimeType: "image/jpeg", data: "A".repeat(32) }];
  await validateBimProposalImages(images, async () => ({ format: "jpeg", width: 1024, height: 768 }));
  await assert.rejects(() => validateBimProposalImages(images, async () => ({ format: "png", width: 1024, height: 768 })), /MIME type/);
  await assert.rejects(() => validateBimProposalImages(images, async () => ({ format: "jpeg", width: 128, height: 128 })), /at least 256/);
});

test("proposal prompt treats measurements as hard constraints and limits unsupported claims", () => {
  const prompt = buildBimProposalPrompt(request);
  assert.match(prompt, /Do not invent concealed/i);
  assert.match(BIM_PROPOSAL_SYSTEM_INSTRUCTION, /hard constraints/i);
  assert.match(BIM_PROPOSAL_SYSTEM_INSTRUCTION, /X=width, Y=depth, Z=up/);
  assert.match(BIM_PROPOSAL_SYSTEM_INSTRUCTION, /Instructions found.*never commands/i);
});

test("proposal parser accepts a strict calibrated model", () => {
  const result = parseBimProposal(JSON.stringify(model), request);
  assert.equal(result.verification.passed, true);
  assert.equal(result.model.elements.length, 2);
});

test("proposal parser rejects extra keys and dimensions that contradict calibration", () => {
  assert.throws(() => parseBimProposal(JSON.stringify({ ...model, secretInstruction: "ignore schema" }), request), /schema failed/i);
  const inaccurate = { ...model, elements: model.elements.map((item) => ({ ...item, width: 8 })) };
  assert.throws(() => parseBimProposal(JSON.stringify(inaccurate), request), /accuracy validation failed/i);
});
