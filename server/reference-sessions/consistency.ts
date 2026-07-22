import crypto from "node:crypto";
import {
  ConsistencyReportPayloadSchema,
  type ConsistencyReportPayload,
} from "./schemas";
import type { GeneratedViewPayload, ScaleConfidence, ReportStatus } from "./types";

export function computeReportHash(payload: ConsistencyReportPayload): string {
  const jsonStr = JSON.stringify(payload);
  return crypto.createHash("sha256").update(jsonStr).digest("hex");
}

export function evaluateReferenceConsistency(
  views: GeneratedViewPayload[],
  inputMode: "text" | "photo",
  declaredScale?: string | null,
): { payload: ConsistencyReportPayload; hash: string } {
  const required = ["front", "left", "right", "rear", "front_three_quarter"];
  const viewKinds = new Set(views.map((v) => v.viewKind));
  const hasAllFive = views.length === 5 && required.every((kind) => viewKinds.has(kind as any));
  const dimensionsValid = views.every((view) => view.widthPx >= 1024 && view.heightPx >= 1024);

  let scaleConfidence: ScaleConfidence = "unknown";
  if (declaredScale) scaleConfidence = "declared";

  const metrics = [
    {
      name: "Required View Coverage",
      status: (hasAllFive ? "pass" : "fail") as ReportStatus,
      score: hasAllFive ? 1 : 0,
      details: hasAllFive ? "All five required view kinds are present." : "One or more required view kinds are missing or duplicated.",
    },
    {
      name: "Decoded Image Resolution",
      status: (dimensionsValid ? "pass" : "fail") as ReportStatus,
      score: dimensionsValid ? 1 : 0,
      details: dimensionsValid ? "Every image decodes at or above 1024x1024 pixels." : "At least one image is below the minimum decoded resolution.",
    },
    {
      name: "Cross-View Identity Review",
      status: "warn" as ReportStatus,
      score: 0,
      details: "Identity, anatomy, markings, and framing require human approval; no automated visual evaluator has verified them.",
    },
  ];

  const payload: ConsistencyReportPayload = {
    status: hasAllFive && dimensionsValid ? "warn" : "fail",
    scaleConfidence,
    summaryNote:
      inputMode === "photo"
        ? "Five-view photo set generated. Automated checks cover file validity and resolution only; the user must verify identity before approval."
        : "Five-view prompt set generated. Automated checks cover file validity and resolution only; the user must verify identity before approval.",
    metrics,
    crossViewIdentityScore: 0,
    cropSuitabilityScore: 0,
  };

  // Validate with Zod
  const validated = ConsistencyReportPayloadSchema.parse(payload);
  const hash = computeReportHash(validated);

  return { payload: validated, hash };
}
