import {
  HermesBridgeJobIdSchema,
  HermesCreateRequestSchemas,
  HermesJobStatusSchema,
  HermesJobTypeSchema,
  HermesJsonValueSchema,
  HermesLocalJobIdSchema,
  HermesOwnerKeySchema,
  HermesStoredErrorSchema,
  type HermesJobType,
  type HermesJsonValue,
} from "./schemas";

export interface HermesJobRecord {
  id: string;
  owner: string;
  bridgeJobId: string | null;
  type: HermesJobType;
  status: string;
  requestPayload: Record<string, HermesJsonValue> | null;
  result: HermesJsonValue | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HermesStore {
  createJob(input: {
    id: string;
    owner: string;
    type: HermesJobType;
    status: string;
    requestPayload: Record<string, HermesJsonValue>;
  }): Promise<void>;
  setBridgeJob(input: {
    id: string;
    owner: string;
    bridgeJobId: string;
    status: string;
  }): Promise<void>;
  getJob(id: string, owner: string): Promise<HermesJobRecord | null>;
  updateJob(input: {
    id: string;
    owner: string;
    status: string;
    result: HermesJsonValue | null;
    error: string | null;
  }): Promise<void>;
}

export const HERMES_JOBS_DDL = `
  CREATE TABLE IF NOT EXISTS hermes_jobs (
    id              CHAR(36)     NOT NULL PRIMARY KEY,
    owner_key       VARCHAR(32)  NOT NULL,
    bridge_job_id   VARCHAR(255) NULL,
    job_type        ENUM('translate','knowledge') NOT NULL,
    request_json    JSON         NULL,
    status          VARCHAR(32)  NOT NULL,
    result_json     JSON         NULL,
    error           VARCHAR(255) NULL,
    created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_hermes_bridge_job (bridge_job_id),
    INDEX idx_hermes_owner_created (owner_key, created_at),
    INDEX idx_hermes_status (status),
    CONSTRAINT fk_hermes_owner FOREIGN KEY (owner_key) REFERENCES users(phone) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

interface SqlExecutor {
  query(sql: string, values?: unknown[]): Promise<any>;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Hermes job timestamp.");
  return date.toISOString();
}

function resultFrom(raw: unknown): HermesJsonValue | null {
  if (raw == null) return null;
  let value = raw;
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Invalid Hermes result JSON.");
    }
  }
  return HermesJsonValueSchema.parse(value);
}

function requestFrom(raw: unknown, type: HermesJobType): Record<string, HermesJsonValue> | null {
  const value = resultFrom(raw);
  if (value == null) return null;
  return HermesCreateRequestSchemas[type].shape.payload.parse(value) as Record<string, HermesJsonValue>;
}

function recordFrom(row: any): HermesJobRecord {
  const type = HermesJobTypeSchema.parse(row.job_type);
  return {
    id: HermesLocalJobIdSchema.parse(row.id),
    owner: HermesOwnerKeySchema.parse(row.owner_key),
    bridgeJobId: row.bridge_job_id == null
      ? null
      : HermesBridgeJobIdSchema.parse(row.bridge_job_id),
    type,
    status: HermesJobStatusSchema.parse(row.status),
    requestPayload: requestFrom(row.request_json, type),
    result: resultFrom(row.result_json),
    error: row.error == null ? null : HermesStoredErrorSchema.parse(row.error),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export class MySqlHermesStore implements HermesStore {
  constructor(private readonly db: SqlExecutor) {}

  async ensureSchema(): Promise<void> {
    await this.db.query(HERMES_JOBS_DDL);
    try {
      await this.db.query(
        "ALTER TABLE hermes_jobs ADD COLUMN request_json JSON NULL AFTER job_type",
      );
    } catch (error: any) {
      if (Number(error?.errno) !== 1060 && error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }

  async createJob(input: {
    id: string;
    owner: string;
    type: HermesJobType;
    status: string;
    requestPayload: Record<string, HermesJsonValue>;
  }): Promise<void> {
    const id = HermesLocalJobIdSchema.parse(input.id);
    const owner = HermesOwnerKeySchema.parse(input.owner);
    const type = HermesJobTypeSchema.parse(input.type);
    const status = HermesJobStatusSchema.parse(input.status);
    const requestPayload = HermesCreateRequestSchemas[type].shape.payload.parse(input.requestPayload);
    await this.db.query(
      `INSERT INTO hermes_jobs (id, owner_key, job_type, request_json, status)
       VALUES (?, ?, ?, ?, ?)`,
      [id, owner, type, JSON.stringify(requestPayload), status],
    );
  }

  async setBridgeJob(input: {
    id: string;
    owner: string;
    bridgeJobId: string;
    status: string;
  }): Promise<void> {
    const values = [
      HermesBridgeJobIdSchema.parse(input.bridgeJobId),
      HermesJobStatusSchema.parse(input.status),
      HermesLocalJobIdSchema.parse(input.id),
      HermesOwnerKeySchema.parse(input.owner),
    ];
    const [result]: any = await this.db.query(
      `UPDATE hermes_jobs
          SET bridge_job_id = ?, status = ?, request_json = NULL, error = NULL
        WHERE id = ? AND owner_key = ?
          AND (bridge_job_id IS NULL OR bridge_job_id = ?)`,
      [...values, values[0]],
    );
    if (Number(result?.affectedRows) > 1) throw new Error("Hermes job update failed.");
  }

  async getJob(id: string, owner: string): Promise<HermesJobRecord | null> {
    const [rows]: any = await this.db.query(
      `SELECT id, owner_key, bridge_job_id, job_type, status,
              CAST(request_json AS CHAR) AS request_json,
              CAST(result_json AS CHAR) AS result_json, error,
              created_at, updated_at
         FROM hermes_jobs
        WHERE id = ? AND owner_key = ?
        LIMIT 1`,
      [HermesLocalJobIdSchema.parse(id), HermesOwnerKeySchema.parse(owner)],
    );
    return Array.isArray(rows) && rows.length > 0 ? recordFrom(rows[0]) : null;
  }

  async updateJob(input: {
    id: string;
    owner: string;
    status: string;
    result: HermesJsonValue | null;
    error: string | null;
  }): Promise<void> {
    const resultJson = input.result == null
      ? null
      : JSON.stringify(HermesJsonValueSchema.parse(input.result));
    const error = input.error == null ? null : HermesStoredErrorSchema.parse(input.error);
    const [result]: any = await this.db.query(
      `UPDATE hermes_jobs
          SET status = ?, result_json = ?, error = ?
        WHERE id = ? AND owner_key = ?
          AND status NOT IN ('completed', 'failed')`,
      [
        HermesJobStatusSchema.parse(input.status),
        resultJson,
        error,
        HermesLocalJobIdSchema.parse(input.id),
        HermesOwnerKeySchema.parse(input.owner),
      ],
    );
    if (Number(result?.affectedRows) > 1) throw new Error("Hermes job update failed.");
  }
}
