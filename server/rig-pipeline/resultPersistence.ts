import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { registerAsset, addLineage } from "../assets/service";
import { hardDeleteUnpublishedAsset } from "../assets/repository";
import type { AssetRecord, AssetVersionRecord } from "../assets/types";
import type { RigWorkerResult } from "./worker";
import { cleanupRigObject, storeRigObject, type StoredRigObject } from "./storage";

interface RegisteredRigArtifact {
  artifactKey: string;
  role: "rigged_glb" | "fused_print_glb" | "validation_manifest" | "facial_render_front" | "facial_render_three_quarter";
  stored: StoredRigObject;
  asset: AssetRecord;
  version: AssetVersionRecord;
  mimeType: string;
}

export interface PersistedRigResult {
  output: RegisteredRigArtifact;
  fusedPrint: RegisteredRigArtifact | null;
  manifest: RegisteredRigArtifact;
  renders: RegisteredRigArtifact[];
}

export interface RigPersistenceDependencies {
  storeObject?: typeof storeRigObject;
  register?: typeof registerAsset;
  addArtifactLineage?: typeof addLineage;
}

export async function persistRigWorkerResult(input: {
  pool: mysql.Pool;
  ownerId: string;
  jobUuid: string;
  attemptUuid: string;
  sourceAsset: AssetRecord;
  sourceVersion: AssetVersionRecord;
  outputBuffer: Buffer;
  fusedPrintBuffer?: Buffer | null;
  accessorySources?: Array<{ asset: AssetRecord; version: AssetVersionRecord }>;
  result: RigWorkerResult;
  manifest: Record<string, unknown>;
}, dependencies: RigPersistenceDependencies = {}): Promise<PersistedRigResult> {
  const storeObject = dependencies.storeObject || storeRigObject;
  const register = dependencies.register || registerAsset;
  const addArtifactLineage = dependencies.addArtifactLineage || addLineage;
  const created: RegisteredRigArtifact[] = [];
  try {
    const outputStored = await storeObject(
      input.jobUuid,
      input.attemptUuid,
      "rigged-glb",
      "glb",
      "model/gltf-binary",
      input.outputBuffer,
    );
    if (outputStored.sha256 !== input.result.output.sha256) throw new Error("Stored rig output hash mismatch");
    const outputRegistration = await register({
      ownerId: input.ownerId,
      assetType: ["full", "partial"].includes(input.result.facial.capability) ? "model_facial_glb" : "model_rigged_glb",
      visibility: "private",
      mimeType: "model/gltf-binary",
      sizeBytes: outputStored.sizeBytes,
      sha256: outputStored.sha256,
      bucket: "private",
      objectKey: outputStored.objectKey,
      sourceProvider: "blender",
      license: input.sourceVersion.license,
      commercialUseEligible: input.sourceVersion.commercial_use_eligible,
      metadata: {
        phase: 4,
        role: "rigged_glb",
        jobUuid: input.jobUuid,
        attemptUuid: input.attemptUuid,
        facialCapability: input.result.facial.capability,
      },
    }, { authorization: { internal: true }, pool: input.pool });
    const output: RegisteredRigArtifact = {
      artifactKey: "rigged_glb",
      role: "rigged_glb",
      stored: outputStored,
      asset: outputRegistration.asset,
      version: outputRegistration.version,
      mimeType: "model/gltf-binary",
    };
    created.push(output);

    await addArtifactLineage({
      parentAssetUuid: input.sourceAsset.asset_uuid,
      parentVersionNumber: input.sourceVersion.version_number,
      childAssetUuid: output.asset.asset_uuid,
      childVersionNumber: output.version.version_number,
      relationType: "rig",
    }, { internal: true }, input.pool);

    let fusedPrint: RegisteredRigArtifact | null = null;
    if (input.result.fusedPrint) {
      if (!input.fusedPrintBuffer) throw new Error("Verified fused print bytes are missing");
      if (input.fusedPrintBuffer.equals(input.outputBuffer)) throw new Error("Fused print output reuses the display GLB");
      const printStored = await storeObject(
        input.jobUuid,
        input.attemptUuid,
        "fused-print-glb",
        "glb",
        "model/gltf-binary",
        input.fusedPrintBuffer,
      );
      if (printStored.sha256 !== input.result.fusedPrint.sha256) throw new Error("Stored fused print output hash mismatch");
      const printRegistration = await register({
        ownerId: input.ownerId,
        assetType: "model_print_glb",
        visibility: "private",
        mimeType: "model/gltf-binary",
        sizeBytes: printStored.sizeBytes,
        sha256: printStored.sha256,
        bucket: "private",
        objectKey: printStored.objectKey,
        sourceProvider: "blender",
        license: input.sourceVersion.license,
        commercialUseEligible: input.sourceVersion.commercial_use_eligible,
        metadata: {
          phase: 4,
          role: "fused_print_glb",
          jobUuid: input.jobUuid,
          attemptUuid: input.attemptUuid,
          printReady: true,
          metrics: input.result.fusedPrint.metrics,
          rules: input.result.fusedPrint.rules,
        },
      }, { authorization: { internal: true }, pool: input.pool });
      fusedPrint = {
        artifactKey: "fused_print_glb",
        role: "fused_print_glb",
        stored: printStored,
        asset: printRegistration.asset,
        version: printRegistration.version,
        mimeType: "model/gltf-binary",
      };
      created.push(fusedPrint);
      await addArtifactLineage({
        parentAssetUuid: output.asset.asset_uuid,
        parentVersionNumber: output.version.version_number,
        childAssetUuid: fusedPrint.asset.asset_uuid,
        childVersionNumber: fusedPrint.version.version_number,
        relationType: "derivative",
      }, { internal: true }, input.pool);
      for (const accessory of input.accessorySources || []) {
        await addArtifactLineage({
          parentAssetUuid: accessory.asset.asset_uuid,
          parentVersionNumber: accessory.version.version_number,
          childAssetUuid: fusedPrint.asset.asset_uuid,
          childVersionNumber: fusedPrint.version.version_number,
          relationType: "derivative",
        }, { internal: true }, input.pool);
      }
    } else if (input.fusedPrintBuffer) {
      throw new Error("Unreported fused print bytes cannot be persisted");
    }

    const manifestBuffer = Buffer.from(JSON.stringify(input.manifest));
    const manifestStored = await storeObject(
      input.jobUuid,
      input.attemptUuid,
      "validation-manifest",
      "json",
      "application/json",
      manifestBuffer,
    );
    const manifestRegistration = await register({
      ownerId: input.ownerId,
      assetType: "validation_report",
      visibility: "private",
      mimeType: "application/json",
      sizeBytes: manifestStored.sizeBytes,
      sha256: manifestStored.sha256,
      bucket: "private",
      objectKey: manifestStored.objectKey,
      sourceProvider: "pawsome3d",
      license: "proprietary",
      commercialUseEligible: false,
      metadata: { phase: 4, role: "validation_manifest", jobUuid: input.jobUuid, attemptUuid: input.attemptUuid },
    }, { authorization: { internal: true }, pool: input.pool });
    const manifest: RegisteredRigArtifact = {
      artifactKey: "validation_manifest",
      role: "validation_manifest",
      stored: manifestStored,
      asset: manifestRegistration.asset,
      version: manifestRegistration.version,
      mimeType: "application/json",
    };
    created.push(manifest);
    await addArtifactLineage({
      parentAssetUuid: output.asset.asset_uuid,
      parentVersionNumber: output.version.version_number,
      childAssetUuid: manifest.asset.asset_uuid,
      childVersionNumber: manifest.version.version_number,
      relationType: "derivative",
    }, { internal: true }, input.pool);

    const renders: RegisteredRigArtifact[] = [];
    for (const evidence of input.result.renders) {
      const bytes = Buffer.from(evidence.pngBase64, "base64");
      validatePngEvidence(bytes, evidence.sha256, evidence.sizeBytes);
      const stored = await storeObject(
        input.jobUuid,
        input.attemptUuid,
        evidence.role.replaceAll("_", "-"),
        "png",
        "image/png",
        bytes,
      );
      const registration = await register({
        ownerId: input.ownerId,
        assetType: "model_render",
        visibility: "private",
        mimeType: "image/png",
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        bucket: "private",
        objectKey: stored.objectKey,
        sourceProvider: "blender",
        license: "proprietary",
        commercialUseEligible: false,
        metadata: { phase: 4, role: evidence.role, jobUuid: input.jobUuid, attemptUuid: input.attemptUuid },
      }, { authorization: { internal: true }, pool: input.pool });
      const render: RegisteredRigArtifact = {
        artifactKey: evidence.role,
        role: evidence.role,
        stored,
        asset: registration.asset,
        version: registration.version,
        mimeType: "image/png",
      };
      created.push(render);
      renders.push(render);
      await addArtifactLineage({
        parentAssetUuid: output.asset.asset_uuid,
        parentVersionNumber: output.version.version_number,
        childAssetUuid: render.asset.asset_uuid,
        childVersionNumber: render.version.version_number,
        relationType: "render",
      }, { internal: true }, input.pool);
    }

    return { output, fusedPrint, manifest, renders };
  } catch (error) {
    for (const artifact of created.reverse()) {
      await cleanupRigObject(artifact.stored.objectKey).catch(() => {});
      await hardDeleteUnpublishedAsset(input.pool, artifact.asset.id).catch(() => {});
    }
    throw error;
  }
}

export async function cleanupPersistedRigResult(pool: mysql.Pool, persisted: PersistedRigResult): Promise<void> {
  for (const artifact of [persisted.manifest, ...persisted.renders, persisted.fusedPrint, persisted.output].filter(Boolean) as RegisteredRigArtifact[]) {
    await cleanupRigObject(artifact.stored.objectKey).catch(() => {});
    await hardDeleteUnpublishedAsset(pool, artifact.asset.id).catch(() => {});
  }
}

function validatePngEvidence(bytes: Buffer, expectedHash: string, expectedSize: number): void {
  if (bytes.length !== expectedSize) throw new Error("Facial evidence byte count mismatch");
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("Facial evidence is not a PNG file");
  }
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash !== expectedHash) throw new Error("Facial evidence hash mismatch");
}
