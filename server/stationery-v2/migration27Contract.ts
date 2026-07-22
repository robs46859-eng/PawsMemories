export interface MigrationColumnRequirement {
  name: string;
  sqlType: string;
  nullable: boolean;
  purpose: string;
}

export interface MigrationTableRequirement {
  table: string;
  immutableAfter?: string;
  columns: MigrationColumnRequirement[];
  uniqueKeys: string[][];
  indexes: string[][];
  foreignKeys: string[];
}

/** Exact SQL persistence contract expected from migration 27. */
export const STATIONERY_V2_MIGRATION_27_REQUIREMENTS: MigrationTableRequirement[] = [
  {
    table: "stationery_payment_evidence",
    immutableAfter: "provider confirmation",
    columns: [
      { name: "id", sqlType: "BIGINT AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "payment_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public payment evidence identity." },
      { name: "owner_id", sqlType: "VARCHAR(190)", nullable: false, purpose: "Authenticated payment owner." },
      { name: "state", sqlType: "ENUM('pending','paid','failed','refunded')", nullable: false, purpose: "Provider-confirmed payment state." },
      { name: "amount_minor", sqlType: "BIGINT UNSIGNED", nullable: false, purpose: "Paid amount in minor currency units." },
      { name: "currency", sqlType: "CHAR(3) ASCII", nullable: false, purpose: "ISO currency code." },
      { name: "provider", sqlType: "VARCHAR(32)", nullable: false, purpose: "Payment provider namespace." },
      { name: "provider_payment_ref", sqlType: "VARCHAR(255)", nullable: false, purpose: "Provider replay identity." },
      { name: "confirmed_at", sqlType: "DATETIME(3)", nullable: true, purpose: "Provider confirmation timestamp." },
      { name: "evidence_hash", sqlType: "CHAR(64) ASCII", nullable: false, purpose: "Canonical payment evidence hash." },
      { name: "created_at", sqlType: "DATETIME(3)", nullable: false, purpose: "First receipt timestamp." },
      { name: "updated_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Last provider transition." },
    ],
    uniqueKeys: [["payment_uuid"], ["provider", "provider_payment_ref"]],
    indexes: [["owner_id", "state"]],
    foreignKeys: [],
  },
  {
    table: "stationery_template_versions",
    immutableAfter: "insert",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key; never returned by the API." },
      { name: "template_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public template identity." },
      { name: "version_number", sqlType: "INT UNSIGNED", nullable: false, purpose: "Public immutable version." },
      { name: "spec_json", sqlType: "JSON", nullable: false, purpose: "Strict TemplateVersionSpec snapshot." },
      { name: "spec_hash", sqlType: "CHAR(64) ASCII", nullable: false, purpose: "Canonical SHA-256 of spec_json." },
      { name: "status", sqlType: "ENUM('active','retired')", nullable: false, purpose: "Catalog visibility without mutating the version payload." },
      { name: "created_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Creation timestamp." },
    ],
    uniqueKeys: [["template_uuid", "version_number"]],
    indexes: [["status", "created_at"]],
    foreignKeys: [],
  },
  {
    table: "stationery_render_jobs",
    immutableAfter: "state becomes ready",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "job_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public render-job identity." },
      { name: "owner_id", sqlType: "VARCHAR(64)", nullable: false, purpose: "Authenticated owner key." },
      { name: "template_version_id", sqlType: "BIGINT UNSIGNED", nullable: false, purpose: "Frozen template version." },
      { name: "preset_id", sqlType: "VARCHAR(64)", nullable: false, purpose: "Frozen output preset." },
      { name: "client_idempotency_key", sqlType: "VARCHAR(190)", nullable: false, purpose: "Caller replay identity." },
      { name: "request_hash", sqlType: "CHAR(64) ASCII", nullable: false, purpose: "Canonical request conflict detector." },
      { name: "request_json", sqlType: "JSON", nullable: false, purpose: "Strict frozen create request." },
      { name: "validation_report_json", sqlType: "JSON", nullable: false, purpose: "Measured pre-render validation evidence." },
      { name: "state", sqlType: "ENUM('queued','dispatch_failed','rendering','ready','failed')", nullable: false, purpose: "Durable job state." },
      { name: "render_manifest_json", sqlType: "JSON", nullable: true, purpose: "Immutable sealed render manifest." },
      { name: "render_manifest_hash", sqlType: "CHAR(64) ASCII", nullable: true, purpose: "Manifest lookup and integrity value." },
      { name: "output_asset_uuid", sqlType: "CHAR(36) ASCII", nullable: true, purpose: "Public output asset identity." },
      { name: "output_version_number", sqlType: "INT UNSIGNED", nullable: true, purpose: "Public output version." },
      { name: "output_asset_id", sqlType: "BIGINT UNSIGNED", nullable: true, purpose: "Internal canonical asset foreign key; never returned by the API." },
      { name: "output_asset_version_id", sqlType: "BIGINT UNSIGNED", nullable: true, purpose: "Internal canonical asset-version foreign key; never returned by the API." },
      { name: "failure_code", sqlType: "VARCHAR(120)", nullable: true, purpose: "Bounded machine-readable failure." },
      { name: "created_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Creation timestamp." },
      { name: "updated_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Last state transition." },
    ],
    uniqueKeys: [["job_uuid"], ["owner_id", "client_idempotency_key"]],
    indexes: [["owner_id", "created_at"], ["state", "updated_at"]],
    foreignKeys: ["template_version_id -> stationery_template_versions.id", "output_asset_id -> assets.id", "(output_asset_id, output_asset_version_id) -> asset_versions(asset_id, id)"],
  },
  {
    table: "stationery_render_outbox",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "render_job_id", sqlType: "BIGINT UNSIGNED", nullable: false, purpose: "Job to dispatch." },
      { name: "dispatch_key", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Stable worker idempotency identity." },
      { name: "payload_json", sqlType: "JSON", nullable: false, purpose: "Strict RenderDispatch snapshot." },
      { name: "state", sqlType: "ENUM('pending','dispatched','failed')", nullable: false, purpose: "Durable dispatch state." },
      { name: "attempt_count", sqlType: "INT UNSIGNED", nullable: false, purpose: "Bounded retry accounting." },
      { name: "available_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Next eligible dispatch time." },
      { name: "created_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Creation timestamp." },
      { name: "updated_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Last dispatch attempt." },
    ],
    uniqueKeys: [["render_job_id"], ["dispatch_key"]],
    indexes: [["state", "available_at"]],
    foreignKeys: ["render_job_id -> stationery_render_jobs.id"],
  },
  {
    table: "stationery_print_manifests",
    immutableAfter: "insert",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "local_order_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public local order identity." },
      { name: "owner_id", sqlType: "VARCHAR(64)", nullable: false, purpose: "Authenticated owner key." },
      { name: "render_job_id", sqlType: "BIGINT UNSIGNED", nullable: false, purpose: "Verified ready render." },
      { name: "client_idempotency_key", sqlType: "VARCHAR(190)", nullable: false, purpose: "Caller replay identity." },
      { name: "request_hash", sqlType: "CHAR(64) ASCII", nullable: false, purpose: "Canonical request conflict detector." },
      { name: "manifest_json", sqlType: "JSON", nullable: false, purpose: "Immutable SealedPrintManifest." },
      { name: "manifest_hash", sqlType: "CHAR(64) ASCII", nullable: false, purpose: "Canonical frozen print identity." },
      { name: "payment_evidence_json", sqlType: "JSON", nullable: false, purpose: "Frozen paid-payment evidence." },
      { name: "created_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Freeze timestamp." },
    ],
    uniqueKeys: [["local_order_uuid"], ["owner_id", "client_idempotency_key"], ["manifest_hash"]],
    indexes: [["owner_id", "created_at"]],
    foreignKeys: ["render_job_id -> stationery_render_jobs.id"],
  },
  {
    table: "stationery_fulfillment_orders",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "local_order_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public order identity." },
      { name: "print_manifest_id", sqlType: "BIGINT UNSIGNED", nullable: false, purpose: "Immutable print manifest." },
      { name: "provider", sqlType: "ENUM('printful','slant3d')", nullable: false, purpose: "Provider identity." },
      { name: "provider_idempotency_key", sqlType: "VARCHAR(190)", nullable: false, purpose: "Stable provider submission key." },
      { name: "payment_state", sqlType: "ENUM('unpaid','paid','refunded')", nullable: false, purpose: "Durable payment gate." },
      { name: "state", sqlType: "VARCHAR(40)", nullable: false, purpose: "Validated ProviderOrderState." },
      { name: "provider_order_id", sqlType: "VARCHAR(200)", nullable: true, purpose: "Provider acknowledgment identity." },
      { name: "applied_event_ids_json", sqlType: "JSON", nullable: false, purpose: "Bounded audit mirror; uniqueness is enforced in event table." },
      { name: "state_changed_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Ordering/reconciliation evidence." },
      { name: "updated_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Optimistic transition token." },
    ],
    uniqueKeys: [["local_order_uuid"], ["provider", "provider_idempotency_key"]],
    indexes: [["state", "updated_at"], ["provider", "provider_order_id"]],
    foreignKeys: ["local_order_uuid -> stationery_print_manifests.local_order_uuid", "print_manifest_id -> stationery_print_manifests.id"],
  },
  {
    table: "stationery_provider_event_claims",
    immutableAfter: "insert",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "provider", sqlType: "ENUM('printful','slant3d')", nullable: false, purpose: "Provider namespace." },
      { name: "provider_event_id", sqlType: "VARCHAR(200)", nullable: false, purpose: "Permanent replay identity claimed inside the order transaction." },
      { name: "local_order_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Prevents a replay identity from being rebound to another order." },
      { name: "claimed_at", sqlType: "DATETIME(3)", nullable: false, purpose: "First receipt timestamp." },
    ],
    uniqueKeys: [["provider", "provider_event_id"], ["provider", "provider_event_id", "local_order_uuid"]],
    indexes: [["claimed_at"]],
    foreignKeys: ["local_order_uuid -> stationery_fulfillment_orders.local_order_uuid"],
  },
  {
    table: "stationery_provider_events",
    immutableAfter: "insert",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "provider", sqlType: "ENUM('printful','slant3d')", nullable: false, purpose: "Provider namespace." },
      { name: "provider_event_id", sqlType: "VARCHAR(200)", nullable: false, purpose: "Permanent replay identity." },
      { name: "local_order_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public order identity." },
      { name: "event_json", sqlType: "JSON", nullable: false, purpose: "Strict ProviderEvent evidence." },
      { name: "disposition", sqlType: "VARCHAR(40)", nullable: false, purpose: "Applied/duplicate/stale/reconciliation outcome." },
      { name: "reason", sqlType: "VARCHAR(300)", nullable: false, purpose: "Bounded audit explanation." },
      { name: "occurred_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Provider event time." },
      { name: "recorded_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Local receipt time." },
    ],
    uniqueKeys: [["provider", "provider_event_id"]],
    indexes: [["local_order_uuid", "recorded_at"]],
    foreignKeys: ["local_order_uuid -> stationery_fulfillment_orders.local_order_uuid", "(provider, provider_event_id, local_order_uuid) -> stationery_provider_event_claims(provider, provider_event_id, local_order_uuid)"],
  },
  {
    table: "stationery_reconciliation_runs",
    immutableAfter: "insert",
    columns: [
      { name: "id", sqlType: "BIGINT UNSIGNED AUTO_INCREMENT", nullable: false, purpose: "Internal primary key." },
      { name: "reconciliation_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public audit identity." },
      { name: "local_order_uuid", sqlType: "CHAR(36) ASCII", nullable: false, purpose: "Public order identity." },
      { name: "requested_by_owner_id", sqlType: "VARCHAR(64)", nullable: false, purpose: "Authenticated actor." },
      { name: "reason", sqlType: "VARCHAR(300)", nullable: false, purpose: "Requested reconciliation reason." },
      { name: "observation_json", sqlType: "JSON", nullable: true, purpose: "Provider observation or null when unavailable." },
      { name: "decision_json", sqlType: "JSON", nullable: false, purpose: "Strict ReconciliationDecision." },
      { name: "created_at", sqlType: "DATETIME(3)", nullable: false, purpose: "Audit timestamp." },
    ],
    uniqueKeys: [["reconciliation_uuid"]],
    indexes: [["local_order_uuid", "created_at"]],
    foreignKeys: ["local_order_uuid -> stationery_fulfillment_orders.local_order_uuid"],
  },
];
