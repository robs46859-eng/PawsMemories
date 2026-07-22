import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import {
  assertPrivateStorageConfig,
  deletePrivateObject,
  putPrivateObject,
} from "../../storage.private";
import type { BimModel } from "../../src/bim/model";
import { addLineage, registerAsset } from "../assets/service";
import { hardDeleteUnpublishedAsset } from "../assets/repository";
import {
  BIM_BUILD_CONTRACT_VERSION,
  canonicalBimJson,
  hashBimContract,
  hashBimModel,
  type BimBuildCommand,
  type BimWorkerResultEnvelope,
} from "./contracts";
import { DurableBimRepository } from "./durableRepository";
import { DurableBimService, DurableBimServiceError } from "./durableService";
import type {
  DurableBimArtifactRegistrarPort,
  DurableBimArtifactRegistration,
  DurableBimArtifactRole,
  DurableBimCreditOutcome,
  DurableBimCreditPort,
  DurableBimPostBuildVerifierPort,
  DurableBimVerificationRecord,
  DurableBimWorkerExecution,
  DurableBimWorkerPort,
} from "./durableTypes";
import { buildBimPostBuildVerification } from "./verification";

const MAX_IFC_BYTES = 50 * 1024 * 1024;
const MAX_GLB_BYTES = 250 * 1024 * 1024;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_WORKER_RESPONSE_BYTES = 420 * 1024 * 1024;
const DEFAULT_WORKER_TIMEOUT_MS = 180_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PreBuildReport = Parameters<typeof buildBimPostBuildVerification>[1];

export interface AcceptedBimModelResolver {
  resolve(command: BimBuildCommand): Promise<BimModel>;
}

interface EncodedArtifact {
  base64: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
}

interface IfcWorkerEvidence {
  provider: "render-ifc-export";
  ifc: EncodedArtifact;
  semanticGlb: EncodedArtifact;
  semanticSidecar: EncodedArtifact;
  validationReport: EncodedArtifact;
  sidecar: Record<string, unknown>;
  exportReport: Record<string, unknown>;
}

interface StoredArtifact {
  objectKey: string;
  assetId: number;
  assetUuid: string;
  assetVersionId: number;
  versionNumber: number;
  role: DurableBimArtifactRole;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
}

export interface DurableBimArtifactPersistence {
  put(objectKey: string, bytes: Buffer, mimeType: string): Promise<{ objectKey: string; sha256: string; sizeBytes: number }>;
  removeObject(objectKey: string): Promise<void>;
  register(input: {
    ownerId: string;
    assetType: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    objectKey: string;
    metadata: Record<string, unknown>;
  }): Promise<{ assetId: number; assetUuid: string; assetVersionId: number; versionNumber: number }>;
  removeAsset(assetId: number): Promise<void>;
  addDerivative(parent: { assetUuid: string; versionNumber: number }, child: { assetUuid: string; versionNumber: number }): Promise<void>;
}

export class DurableBimProductionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "DurableBimProductionError";
  }
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedPositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function strictBase64(value: unknown, role: string, maxBytes: number): Buffer {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new DurableBimProductionError(`${role} is missing or exceeds its encoded size limit`, "BIM_ARTIFACT_BOUNDS");
  }
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new DurableBimProductionError(`${role} is not canonical base64`, "BIM_ARTIFACT_ENCODING");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64") !== value) {
    throw new DurableBimProductionError(`${role} bytes are invalid or outside the allowed range`, "BIM_ARTIFACT_BOUNDS");
  }
  return bytes;
}

function validateIfc(bytes: Buffer): void {
  const head = bytes.subarray(0, 256).toString("ascii").toUpperCase();
  const tail = bytes.subarray(Math.max(0, bytes.length - 256)).toString("ascii").toUpperCase();
  if (!head.includes("ISO-10303-21;") || !head.includes("HEADER;") || !tail.includes("END-ISO-10303-21;")) {
    throw new DurableBimProductionError("Worker output is not a complete IFC STEP file", "BIM_IFC_SIGNATURE");
  }
}

function validateGlb(bytes: Buffer): void {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "glTF"
    || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
    || bytes.readUInt32LE(16) !== 0x4e4f534a) {
    throw new DurableBimProductionError("Worker output is not a complete GLB v2 file", "BIM_GLB_SIGNATURE");
  }
}

function decodeJsonArtifact(artifact: EncodedArtifact, role: string): Record<string, unknown> {
  const bytes = verifyEncodedArtifact(artifact, role, MAX_JSON_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DurableBimProductionError(`${role} is not valid JSON`, "BIM_JSON_SIGNATURE");
  }
  if (!isRecord(parsed)) throw new DurableBimProductionError(`${role} must be a JSON object`, "BIM_JSON_SIGNATURE");
  return parsed;
}

function verifyEncodedArtifact(artifact: EncodedArtifact, role: string, maxBytes: number): Buffer {
  const bytes = strictBase64(artifact.base64, role, maxBytes);
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.sha256 !== sha256(bytes) || artifact.sizeBytes !== bytes.length) {
    throw new DurableBimProductionError(`${role} hash or byte count does not match its bytes`, "BIM_ARTIFACT_HASH");
  }
  return bytes;
}

function encodedArtifact(bytes: Buffer, mimeType: string): EncodedArtifact {
  return { base64: bytes.toString("base64"), sha256: sha256(bytes), sizeBytes: bytes.length, mimeType };
}

function evidenceFrom(result: BimWorkerResultEnvelope): IfcWorkerEvidence {
  const evidence = result.evidence;
  if (!isRecord(evidence) || evidence.provider !== "render-ifc-export") {
    throw new DurableBimProductionError("Worker evidence uses an unsupported provider contract", "BIM_WORKER_EVIDENCE");
  }
  for (const key of ["ifc", "semanticGlb", "semanticSidecar", "validationReport"] as const) {
    if (!isRecord(evidence[key])) throw new DurableBimProductionError(`Worker evidence is missing ${key}`, "BIM_WORKER_EVIDENCE");
  }
  if (!isRecord(evidence.sidecar) || !isRecord(evidence.exportReport)) {
    throw new DurableBimProductionError("Worker evidence is missing semantic reports", "BIM_WORKER_EVIDENCE");
  }
  return evidence as unknown as IfcWorkerEvidence;
}

async function readBoundedResponse(response: Response, limit: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > limit) throw new DurableBimProductionError("BIM worker response exceeds the allowed size", "BIM_WORKER_RESPONSE_BOUNDS");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new DurableBimProductionError("BIM worker response exceeds the allowed size", "BIM_WORKER_RESPONSE_BOUNDS");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export class RenderDurableBimWorker implements DurableBimWorkerPort {
  private readonly baseUrl: string;

  constructor(private readonly options: {
    baseUrl: string;
    sharedSecret: string;
    modelResolver: AcceptedBimModelResolver;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    maxResponseBytes?: number;
  }) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "").replace(/\/render$/, "");
    let parsed: URL;
    try {
      parsed = new URL(this.baseUrl);
    } catch {
      throw new DurableBimProductionError("BLENDER_WORKER_URL is invalid", "BIM_WORKER_CONFIG");
    }
    if (parsed.protocol !== "https:") {
      throw new DurableBimProductionError("BLENDER_WORKER_URL must use HTTPS", "BIM_WORKER_CONFIG");
    }
    if (!options.sharedSecret) throw new DurableBimProductionError("WORKER_SHARED_SECRET is required", "BIM_WORKER_CONFIG");
  }

  async build(command: BimBuildCommand): Promise<DurableBimWorkerExecution> {
    if (command.mode === "shell") {
      throw new DurableBimServiceError(
        "No authenticated production Shell worker is configured; refusing to fabricate a GLB",
        "SHELL_WORKER_UNSUPPORTED",
        false,
      );
    }
    const model = await this.options.modelResolver.resolve(command);
    if (hashBimModel(model) !== command.modelHash) {
      throw new DurableBimServiceError("Resolved BIM model does not match the accepted model hash", "MODEL_HASH_MISMATCH", false);
    }

    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs
      ?? boundedPositiveInt(process.env.BIM_WORKER_TIMEOUT_MS, DEFAULT_WORKER_TIMEOUT_MS, 1_000, 600_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let body: Buffer;
    try {
      response = await (this.options.fetchImpl || fetch)(`${this.baseUrl}/ifc/export`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-secret": this.options.sharedSecret,
        },
        body: JSON.stringify({
          model,
          contract: {
            contractVersion: command.contractVersion,
            jobUuid: command.jobUuid,
            attemptUuid: command.attemptUuid,
            modelHash: command.modelHash,
            calibrationHash: command.calibrationHash,
            preBuildReportHash: command.preBuildReportHash,
          },
        }),
        redirect: "error",
        signal: controller.signal,
      });
      body = await readBoundedResponse(response, this.options.maxResponseBytes || MAX_WORKER_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof DurableBimProductionError) throw error;
      const message = error instanceof Error ? error.message : "unknown transport failure";
      throw new DurableBimServiceError(`BIM worker request failed: ${message}`, "BIM_WORKER_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new DurableBimServiceError("BIM worker returned malformed JSON", "BIM_WORKER_RESPONSE", false);
    }
    if (!response.ok || !isRecord(payload) || payload.success !== true) {
      const detail = isRecord(payload) && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new DurableBimServiceError(`BIM worker rejected the export: ${detail}`, "BIM_WORKER_REJECTED", response.status >= 500);
    }
    const ifcBytes = strictBase64(payload.ifc_base64, "IFC output", MAX_IFC_BYTES);
    const glbBytes = strictBase64(payload.glb_base64, "semantic GLB output", MAX_GLB_BYTES);
    validateIfc(ifcBytes);
    validateGlb(glbBytes);
    if (!isRecord(payload.sidecar) || !isRecord(payload.exportReport)) {
      throw new DurableBimServiceError("BIM worker omitted IFC semantic evidence", "BIM_WORKER_EVIDENCE", false);
    }
    const sidecarBytes = Buffer.from(canonicalBimJson(payload.sidecar));
    const validationBytes = Buffer.from(canonicalBimJson({
      contractVersion: BIM_BUILD_CONTRACT_VERSION,
      command: {
        jobUuid: command.jobUuid,
        attemptUuid: command.attemptUuid,
        modelHash: command.modelHash,
        calibrationHash: command.calibrationHash,
        preBuildReportHash: command.preBuildReportHash,
      },
      exportReport: payload.exportReport,
      conversionReport: payload.sidecar,
    }));
    const evidence: IfcWorkerEvidence = {
      provider: "render-ifc-export",
      ifc: encodedArtifact(ifcBytes, "application/x-step"),
      semanticGlb: encodedArtifact(glbBytes, "model/gltf-binary"),
      semanticSidecar: encodedArtifact(sidecarBytes, "application/json"),
      validationReport: encodedArtifact(validationBytes, "application/json"),
      sidecar: payload.sidecar,
      exportReport: payload.exportReport,
    };
    return {
      result: {
        contractVersion: BIM_BUILD_CONTRACT_VERSION,
        jobUuid: command.jobUuid,
        attemptUuid: command.attemptUuid,
        mode: "ifc",
        preBuildReportHash: command.preBuildReportHash,
        modelHash: command.modelHash,
        calibrationHash: command.calibrationHash,
        outputSha256: evidence.ifc.sha256,
        evidence,
      },
    };
  }
}

function artifactDefinitions(evidence: IfcWorkerEvidence): Array<{
  role: DurableBimArtifactRole;
  artifact: EncodedArtifact;
  maxBytes: number;
  extension: string;
  assetType: string;
}> {
  return [
    { role: "ifc", artifact: evidence.ifc, maxBytes: MAX_IFC_BYTES, extension: "ifc", assetType: "model_ifc" },
    { role: "semantic_glb", artifact: evidence.semanticGlb, maxBytes: MAX_GLB_BYTES, extension: "glb", assetType: "model_glb" },
    { role: "semantic_sidecar", artifact: evidence.semanticSidecar, maxBytes: MAX_JSON_BYTES, extension: "json", assetType: "provider_manifest" },
    { role: "validation_report", artifact: evidence.validationReport, maxBytes: MAX_JSON_BYTES, extension: "json", assetType: "validation_report" },
  ];
}

export class CanonicalDurableBimArtifactRegistrar implements DurableBimArtifactRegistrarPort {
  constructor(private readonly persistence: DurableBimArtifactPersistence) {}

  async register(input: { command: BimBuildCommand; result: BimWorkerResultEnvelope }): Promise<DurableBimArtifactRegistration[]> {
    if (input.command.mode === "shell") {
      throw new DurableBimProductionError("Shell artifact registration requires a real Shell worker result", "SHELL_WORKER_UNSUPPORTED");
    }
    const evidence = evidenceFrom(input.result);
    const definitions = artifactDefinitions(evidence);
    const verified = definitions.map((definition) => {
      const bytes = verifyEncodedArtifact(definition.artifact, definition.role, definition.maxBytes);
      if (definition.role === "ifc") validateIfc(bytes);
      else if (definition.role === "semantic_glb") validateGlb(bytes);
      else decodeJsonArtifact(definition.artifact, definition.role);
      return { ...definition, bytes };
    });
    if (evidence.ifc.sha256 !== input.result.outputSha256) {
      throw new DurableBimProductionError("Primary IFC hash does not match the worker envelope", "BIM_ARTIFACT_HASH");
    }

    const created: StoredArtifact[] = [];
    const uploadedKeys: string[] = [];
    try {
      for (const definition of verified) {
        const objectKey = `models/${input.command.jobUuid}/bim-${input.command.attemptUuid}/${definition.role}-${crypto.randomUUID()}.${definition.extension}`;
        const stored = await this.persistence.put(objectKey, definition.bytes, definition.artifact.mimeType);
        uploadedKeys.push(stored.objectKey);
        if (stored.objectKey !== objectKey || stored.sha256 !== definition.artifact.sha256 || stored.sizeBytes !== definition.bytes.length) {
          throw new DurableBimProductionError(`Stored ${definition.role} identity does not match verified bytes`, "BIM_STORAGE_INTEGRITY");
        }
        const registration = await this.persistence.register({
          ownerId: input.command.ownerKey,
          assetType: definition.assetType,
          mimeType: definition.artifact.mimeType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          objectKey,
          metadata: {
            phase: 9,
            contractVersion: BIM_BUILD_CONTRACT_VERSION,
            role: definition.role,
            jobUuid: input.command.jobUuid,
            attemptUuid: input.command.attemptUuid,
            modelHash: input.command.modelHash,
            calibrationHash: input.command.calibrationHash,
            preBuildReportHash: input.command.preBuildReportHash,
          },
        });
        created.push({ ...registration, objectKey, role: definition.role, sha256: stored.sha256, sizeBytes: stored.sizeBytes, mimeType: definition.artifact.mimeType });
      }
      const primary = created[0];
      for (const child of created.slice(1)) {
        await this.persistence.addDerivative(primary, child);
      }
      return created.map((artifact) => ({
        role: artifact.role,
        assetId: artifact.assetId,
        assetVersionId: artifact.assetVersionId,
        assetUuid: artifact.assetUuid,
        versionNumber: artifact.versionNumber,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        mimeType: artifact.mimeType,
      }));
    } catch (error) {
      for (const artifact of created.reverse()) {
        await this.persistence.removeAsset(artifact.assetId).catch(() => undefined);
      }
      for (const objectKey of [...new Set(uploadedKeys)].reverse()) {
        await this.persistence.removeObject(objectKey).catch(() => undefined);
      }
      throw error;
    }
  }
}

export interface PreBuildReportResolver {
  resolve(command: BimBuildCommand): Promise<PreBuildReport>;
}

export class SqlPreBuildReportResolver implements PreBuildReportResolver {
  constructor(private readonly pool: mysql.Pool) {}

  async resolve(command: BimBuildCommand): Promise<PreBuildReport> {
    const [rows]: any = await this.pool.query(
      `SELECT report_json FROM bim_verification_reports_v2
       WHERE stage = 'prebuild' AND report_hash = ? AND model_hash = ? AND calibration_hash = ? LIMIT 2`,
      [command.preBuildReportHash, command.modelHash, command.calibrationHash],
    );
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new DurableBimProductionError("Authoritative pre-build report was not found uniquely", "BIM_PREBUILD_NOT_FOUND");
    }
    const raw = typeof rows[0].report_json === "string" ? JSON.parse(rows[0].report_json) : rows[0].report_json;
    if (!isRecord(raw) || hashBimContract(raw) !== command.preBuildReportHash || raw.passed !== true
      || raw.modelHash !== command.modelHash || raw.calibrationHash !== command.calibrationHash) {
      throw new DurableBimProductionError("Persisted pre-build report failed its hash binding", "BIM_PREBUILD_INTEGRITY");
    }
    return { ...raw, reportHash: command.preBuildReportHash } as unknown as PreBuildReport;
  }
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function finiteNumberArray(value: unknown, length: number): number[] | undefined {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item))
    ? value as number[]
    : undefined;
}

function placementMatrix(element: Record<string, unknown>): number[] | undefined {
  const direct = finiteNumberArray(element.placementMatrix, 16);
  if (direct) return direct;
  const placement = finiteNumberArray(element.placement, 3);
  if (!placement) return undefined;
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, placement[0], placement[1], placement[2], 1];
}

function psetSourceId(element: Record<string, unknown>): string | undefined {
  const properties = isRecord(element.properties) ? element.properties : {};
  const pset = isRecord(properties.Pset_Pawsome3D) ? properties.Pset_Pawsome3D : {};
  return typeof pset.Pawsome3DId === "string" && pset.Pawsome3DId ? pset.Pawsome3DId : undefined;
}

export class DurableBimPostBuildVerifier implements DurableBimPostBuildVerifierPort {
  constructor(private readonly preBuildResolver: PreBuildReportResolver) {}

  async verify(input: { command: BimBuildCommand; result: BimWorkerResultEnvelope }): Promise<DurableBimVerificationRecord> {
    if (input.command.mode === "shell") {
      throw new DurableBimProductionError("Shell verification requires a real Shell worker result", "SHELL_WORKER_UNSUPPORTED");
    }
    const evidence = evidenceFrom(input.result);
    const ifcBytes = verifyEncodedArtifact(evidence.ifc, "ifc", MAX_IFC_BYTES);
    const glbBytes = verifyEncodedArtifact(evidence.semanticGlb, "semantic_glb", MAX_GLB_BYTES);
    validateIfc(ifcBytes);
    validateGlb(glbBytes);
    const sidecarFromBytes = decodeJsonArtifact(evidence.semanticSidecar, "semantic_sidecar");
    decodeJsonArtifact(evidence.validationReport, "validation_report");
    if (canonicalBimJson(sidecarFromBytes) !== canonicalBimJson(evidence.sidecar)) {
      throw new DurableBimProductionError("Semantic sidecar bytes do not match worker evidence", "BIM_WORKER_EVIDENCE");
    }
    const preBuild = await this.preBuildResolver.resolve(input.command);
    const sidecar = evidence.sidecar;
    const exportReport = evidence.exportReport;
    const boundsRecord = isRecord(sidecar.glbBounds) ? sidecar.glbBounds : {};
    const min = finiteNumberArray(boundsRecord.min, 3);
    const max = finiteNumberArray(boundsRecord.max, 3);
    const dimensions = finiteNumberArray(boundsRecord.dimensions, 3);
    const semanticElements = recordArray(sidecar.elements).flatMap((element) => {
      const sourceElementId = psetSourceId(element);
      const matrix = placementMatrix(element);
      if (!sourceElementId || !matrix || typeof element.globalId !== "string" || typeof element.class !== "string") return [];
      return [{
        sourceElementId,
        globalId: element.globalId,
        ifcClass: element.class,
        hasPropertySet: true,
        placementMatrix: matrix,
      }];
    });
    const spatialElementIds = semanticElements.map((element) => element.sourceElementId);
    const report = buildBimPostBuildVerification("ifc", preBuild, {
      format: "ifc4-bim",
      outputSha256: sha256(ifcBytes),
      preBuildReportHash: input.command.preBuildReportHash,
      modelHash: input.command.modelHash,
      calibrationHash: input.command.calibrationHash,
      axisConvention: sidecar.axisConvention === "z-up-model" ? "z-up-model" : sidecar.axisConvention === "y-up-glb" ? "y-up-glb" : undefined,
      bounds: min && max ? { min: min as [number, number, number], max: max as [number, number, number] } : null,
      dimensionsMeters: dimensions ? { width: dimensions[0], depth: dimensions[1], height: dimensions[2] } : undefined,
      geometryValid: true,
      schema: typeof sidecar.schema === "string" && sidecar.schema === exportReport.schema ? sidecar.schema : undefined,
      sourceUnit: typeof sidecar.sourceUnit === "string" ? sidecar.sourceUnit : undefined,
      metersPerUnit: typeof sidecar.metersPerUnit === "number" ? sidecar.metersPerUnit : undefined,
      elementCount: typeof sidecar.elementCount === "number" ? sidecar.elementCount : undefined,
      globalIdCount: typeof sidecar.globalIdCount === "number" ? sidecar.globalIdCount : undefined,
      uniqueGlobalIdCount: typeof sidecar.uniqueGlobalIdCount === "number" ? sidecar.uniqueGlobalIdCount : undefined,
      relationshipCount: typeof sidecar.relationshipCount === "number" ? sidecar.relationshipCount : undefined,
      voidRelationshipCount: typeof sidecar.voidRelationshipCount === "number" ? sidecar.voidRelationshipCount : undefined,
      fillingRelationshipCount: typeof sidecar.fillingRelationshipCount === "number" ? sidecar.fillingRelationshipCount : undefined,
      propertySetElementCount: typeof sidecar.propertySetElementCount === "number" ? sidecar.propertySetElementCount : undefined,
      storeyCount: typeof sidecar.storeyCount === "number" ? sidecar.storeyCount : undefined,
      coordinateReference: typeof sidecar.coordinateReference === "string" ? sidecar.coordinateReference : undefined,
      placementsFinite: sidecar.placementsFinite === true,
      roundTripPassed: exportReport.roundTripPassed === true,
      proxyCount: typeof sidecar.proxyCount === "number" ? sidecar.proxyCount : undefined,
      semanticElements,
      spatialElementIds,
      openingRelationships: recordArray(sidecar.openingRelationships) as Array<{ openingSourceId: string; hostSourceId: string }>,
      fillingRelationships: recordArray(sidecar.fillingRelationships) as Array<{ fillingSourceId: string; openingSourceId: string }>,
    });
    return {
      reportHash: report.reportHash,
      modelHash: report.modelHash,
      calibrationHash: report.calibrationHash,
      overallPass: report.passed,
      reportJson: Object.fromEntries(Object.entries(report).filter(([key]) => key !== "reportHash")),
    };
  }
}

function creditEvidence(input: Record<string, unknown>): string {
  return hashBimContract({ contractVersion: BIM_BUILD_CONTRACT_VERSION, ledger: "credit_transactions", ...input });
}

export class MysqlDurableBimCreditAdapter implements DurableBimCreditPort {
  constructor(private readonly pool: mysql.Pool) {}

  async quote(input: { ownerId: string; mode: "shell" | "ifc"; expectedCredits: number }): Promise<{ amountCredits: number; evidenceHash: string }> {
    return {
      amountCredits: input.expectedCredits,
      evidenceHash: creditEvidence({ operation: "quote", ownerId: input.ownerId, mode: input.mode, amountCredits: input.expectedCredits }),
    };
  }

  debit(input: { ownerId: string; amountCredits: number; idempotencyKey: string; jobUuid: string }): Promise<DurableBimCreditOutcome> {
    return this.mutate({ ...input, operation: "debit", delta: -input.amountCredits });
  }

  refund(input: { ownerId: string; amountCredits: number; idempotencyKey: string; jobUuid: string }): Promise<DurableBimCreditOutcome> {
    return this.mutate({ ...input, operation: "refund", delta: input.amountCredits });
  }

  async reconcile(input: {
    ownerId: string;
    amountCredits: number;
    idempotencyKey: string;
    jobUuid: string;
    eventType: "debit" | "refund";
  }): Promise<DurableBimCreditOutcome> {
    const expectedDelta = input.eventType === "debit" ? -input.amountCredits : input.amountCredits;
    return this.confirmLedger(input.ownerId, input.idempotencyKey, input.jobUuid, input.eventType, expectedDelta);
  }

  private async mutate(input: {
    ownerId: string;
    amountCredits: number;
    idempotencyKey: string;
    jobUuid: string;
    operation: "debit" | "refund";
    delta: number;
  }): Promise<DurableBimCreditOutcome> {
    if (!Number.isSafeInteger(input.amountCredits) || input.amountCredits <= 0 || !input.idempotencyKey) {
      return { state: "failed", evidenceHash: creditEvidence({ ...input, disposition: "invalid_request" }) };
    }
    const existing = await this.confirmLedger(input.ownerId, input.idempotencyKey, input.jobUuid, input.operation, input.delta);
    if (existing.state === "committed") return existing;
    if (input.operation === "refund") {
      const debit = await this.confirmLedger(input.ownerId, `bim:v2:${input.jobUuid}:debit`, input.jobUuid, "debit", -input.amountCredits);
      if (debit.state !== "committed") {
        return { state: "unknown", evidenceHash: creditEvidence({ ...input, disposition: "original_debit_unconfirmed" }) };
      }
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [duplicateRows]: any = await connection.query(
        "SELECT user_phone, delta, reason, balance_after FROM credit_transactions WHERE idempotency_key = ? LIMIT 1 FOR UPDATE",
        [input.idempotencyKey],
      );
      if (duplicateRows.length) {
        await connection.commit();
        return this.classifyLedgerRow(duplicateRows[0], input.ownerId, input.idempotencyKey, input.jobUuid, input.operation, input.delta);
      }
      const [users]: any = await connection.query("SELECT credits FROM users WHERE phone = ? LIMIT 1 FOR UPDATE", [input.ownerId]);
      if (!users.length) {
        await connection.rollback();
        return { state: "failed", evidenceHash: creditEvidence({ ...input, disposition: "owner_not_found" }) };
      }
      const current = Number(users[0].credits);
      const next = current + input.delta;
      if (!Number.isSafeInteger(current) || !Number.isSafeInteger(next) || next < 0) {
        await connection.rollback();
        return { state: "failed", evidenceHash: creditEvidence({ ...input, disposition: "insufficient_or_invalid_balance" }) };
      }
      const reason = `bim_v2_${input.operation}:${input.jobUuid}`;
      await connection.query("UPDATE users SET credits = ? WHERE phone = ?", [next, input.ownerId]);
      await connection.query(
        `INSERT INTO credit_transactions (user_phone, delta, reason, balance_after, idempotency_key)
         VALUES (?, ?, ?, ?, ?)`,
        [input.ownerId, input.delta, reason, next, input.idempotencyKey],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      const candidate = error as { code?: string; errno?: number };
      if (candidate.code !== "ER_DUP_ENTRY" && candidate.errno !== 1062) {
        return { state: "unknown", evidenceHash: creditEvidence({ ...input, disposition: "transaction_unknown" }) };
      }
    } finally {
      connection.release();
    }
    return this.confirmLedger(input.ownerId, input.idempotencyKey, input.jobUuid, input.operation, input.delta);
  }

  private async confirmLedger(
    ownerId: string,
    idempotencyKey: string,
    jobUuid: string,
    operation: "debit" | "refund",
    expectedDelta: number,
  ): Promise<DurableBimCreditOutcome> {
    try {
      const [rows]: any = await this.pool.query(
        "SELECT user_phone, delta, reason, balance_after FROM credit_transactions WHERE idempotency_key = ? LIMIT 2",
        [idempotencyKey],
      );
      if (!Array.isArray(rows) || rows.length !== 1) {
        return { state: "unknown", evidenceHash: creditEvidence({ ownerId, idempotencyKey, jobUuid, operation, expectedDelta, disposition: "ledger_absent_or_ambiguous" }) };
      }
      return this.classifyLedgerRow(rows[0], ownerId, idempotencyKey, jobUuid, operation, expectedDelta);
    } catch {
      return { state: "unknown", evidenceHash: creditEvidence({ ownerId, idempotencyKey, jobUuid, operation, expectedDelta, disposition: "ledger_read_failed" }) };
    }
  }

  private classifyLedgerRow(
    row: Record<string, unknown>,
    ownerId: string,
    idempotencyKey: string,
    jobUuid: string,
    operation: "debit" | "refund",
    expectedDelta: number,
  ): DurableBimCreditOutcome {
    const expectedReason = `bim_v2_${operation}:${jobUuid}`;
    const matches = row.user_phone === ownerId && Number(row.delta) === expectedDelta && row.reason === expectedReason
      && Number.isSafeInteger(Number(row.balance_after)) && Number(row.balance_after) >= 0;
    return {
      state: matches ? "committed" : "unknown",
      evidenceHash: creditEvidence({
        ownerId,
        idempotencyKey,
        jobUuid,
        operation,
        expectedDelta,
        disposition: matches ? "ledger_confirmed" : "ledger_identity_conflict",
        ledgerOwner: String(row.user_phone || ""),
        ledgerDelta: Number(row.delta),
        ledgerReason: String(row.reason || ""),
        balanceAfter: Number(row.balance_after),
      }),
    };
  }
}

function productionPersistence(pool: mysql.Pool): DurableBimArtifactPersistence {
  return {
    put: putPrivateObject,
    removeObject: deletePrivateObject,
    register: async (input) => {
      const registered = await registerAsset({
        ownerId: input.ownerId,
        assetType: input.assetType,
        visibility: "private",
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        bucket: "private",
        objectKey: input.objectKey,
        metadata: input.metadata,
        sourceProvider: "ifcopenshell",
        license: "proprietary",
        commercialUseEligible: false,
      }, { authorization: { internal: true }, pool });
      return {
        assetId: registered.asset.id,
        assetUuid: registered.asset.asset_uuid,
        assetVersionId: registered.version.id,
        versionNumber: registered.version.version_number,
      };
    },
    removeAsset: (assetId) => hardDeleteUnpublishedAsset(pool, assetId),
    addDerivative: (parent, child) => addLineage({
      parentAssetUuid: parent.assetUuid,
      parentVersionNumber: parent.versionNumber,
      childAssetUuid: child.assetUuid,
      childVersionNumber: child.versionNumber,
      relationType: "derivative",
    }, { internal: true }, pool),
  };
}

export function createDurableBimProductionService(options: {
  modelResolver: AcceptedBimModelResolver;
  pool?: mysql.Pool;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}): DurableBimService {
  const env = options.env || process.env;
  if (!env.BLENDER_WORKER_URL || !env.WORKER_SHARED_SECRET) {
    throw new DurableBimProductionError("BLENDER_WORKER_URL and WORKER_SHARED_SECRET are required", "BIM_WORKER_CONFIG");
  }
  assertPrivateStorageConfig(env);
  if (!options.modelResolver) {
    throw new DurableBimProductionError("An authoritative accepted-model resolver is required", "BIM_MODEL_RESOLVER_REQUIRED");
  }
  const pool = options.pool || getPool();
  return new DurableBimService({
    repository: new DurableBimRepository(pool),
    worker: new RenderDurableBimWorker({
      baseUrl: env.BLENDER_WORKER_URL,
      sharedSecret: env.WORKER_SHARED_SECRET,
      modelResolver: options.modelResolver,
      fetchImpl: options.fetchImpl,
    }),
    artifactRegistrar: new CanonicalDurableBimArtifactRegistrar(productionPersistence(pool)),
    postBuildVerifier: new DurableBimPostBuildVerifier(new SqlPreBuildReportResolver(pool)),
    credits: new MysqlDurableBimCreditAdapter(pool),
  });
}
