import type { BimBuildCommand, BimWorkerResultEnvelope } from "./contracts";

export type DurableBimJobState =
  | "queued"
  | "claimed"
  | "processing"
  | "validating"
  | "ready"
  | "accepted"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export type DurableBimAttemptState = Exclude<DurableBimJobState, "accepted">;
export type DurableBimCreditState = "pending" | "committed" | "failed" | "unknown";
export type DurableBimArtifactRole =
  | "shell_glb"
  | "ifc"
  | "semantic_glb"
  | "semantic_sidecar"
  | "validation_report";

export interface DurableBimArtifactRegistration {
  role: DurableBimArtifactRole;
  assetId: number;
  assetVersionId: number;
  assetUuid: string;
  versionNumber: number;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
}

export interface DurableBimArtifactPublic {
  role: DurableBimArtifactRole;
  assetUuid: string;
  versionNumber: number;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
}

export interface DurableBimVerificationRecord {
  reportHash: string;
  modelHash: string;
  calibrationHash: string;
  overallPass: boolean;
  reportJson: Record<string, unknown>;
}

export interface DurableBimPostBuildRecord extends DurableBimVerificationRecord {
  outputManifestHash: string;
}

export interface DurableBimJobRecord {
  id: number;
  jobUuid: string;
  ownerId: string;
  mode: "shell" | "ifc";
  state: DurableBimJobState;
  idempotencyKey: string;
  modelHash: string;
  calibrationHash: string;
  proposalHash: string;
  acceptedProposalHash: string;
  preBuildReportHash: string;
  quotedCredits: number;
  retryCount: number;
  failureCode: string | null;
  currentAttempt: {
    id: number;
    attemptUuid: string;
    attemptNumber: number;
    state: DurableBimAttemptState;
    command: BimBuildCommand;
    commandHash: string;
    providerTaskId: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
  };
  preBuildReport: DurableBimVerificationRecord;
  postBuildReport: DurableBimVerificationRecord | null;
  artifacts: DurableBimArtifactRegistration[];
  creditEvents: Array<{
    eventUuid: string;
    eventType: "quote" | "debit" | "refund" | "reconciliation";
    amountCredits: number;
    idempotencyKey: string;
    state: DurableBimCreditState;
    evidenceHash: string;
  }>;
  acceptance: {
    outputManifestHash: string;
    acceptedAt: string;
  } | null;
}

export interface DurableBimJobPublic {
  jobUuid: string;
  mode: "shell" | "ifc";
  state: DurableBimJobState;
  attempt: {
    attemptUuid: string;
    attemptNumber: number;
    state: DurableBimAttemptState;
    leaseExpiresAt: string | null;
  };
  hashes: {
    model: string;
    calibration: string;
    proposal: string;
    preBuildReport: string;
    postBuildReport: string | null;
    outputManifest: string | null;
  };
  verification: {
    preBuildPassed: boolean;
    postBuildPassed: boolean | null;
  };
  artifacts: DurableBimArtifactPublic[];
  billing: {
    quotedCredits: number;
    debitState: DurableBimCreditState | "not_requested";
    refundState: DurableBimCreditState | "not_requested";
    refunded: boolean;
  };
  retryCount: number;
  failureCode: string | null;
  acceptedAt: string | null;
}

export interface DurableBimWorkerExecution {
  providerTaskId?: string;
  result: BimWorkerResultEnvelope;
}

export interface DurableBimWorkerPort {
  build(command: BimBuildCommand, context?: {
    onProviderTaskId(providerTaskId: string): Promise<void>;
  }): Promise<DurableBimWorkerExecution>;
  cancel?(providerTaskId: string): Promise<void>;
}

export interface DurableBimArtifactRegistrarPort {
  register(input: {
    command: BimBuildCommand;
    result: BimWorkerResultEnvelope;
  }): Promise<DurableBimArtifactRegistration[]>;
}

export interface DurableBimPostBuildVerifierPort {
  verify(input: {
    command: BimBuildCommand;
    result: BimWorkerResultEnvelope;
  }): Promise<DurableBimVerificationRecord>;
}

export interface DurableBimCreditOutcome {
  state: Exclude<DurableBimCreditState, "pending">;
  evidenceHash: string;
}

export interface DurableBimCreditPort {
  quote(input: { ownerId: string; mode: "shell" | "ifc"; expectedCredits: number }): Promise<{ amountCredits: number; evidenceHash: string }>;
  debit(input: { ownerId: string; amountCredits: number; idempotencyKey: string; jobUuid: string }): Promise<DurableBimCreditOutcome>;
  refund(input: { ownerId: string; amountCredits: number; idempotencyKey: string; jobUuid: string }): Promise<DurableBimCreditOutcome>;
  reconcile(input: {
    ownerId: string;
    amountCredits: number;
    idempotencyKey: string;
    jobUuid: string;
    eventType: "debit" | "refund";
  }): Promise<DurableBimCreditOutcome>;
}
