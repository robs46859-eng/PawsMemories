import type mysql from "mysql2/promise";
import { getPool } from "../../db";
import { getDistinctStorageAccountingByOwner } from "./repository";
import type { StorageUsageSummary } from "./types";

export async function calculateOwnerStorageUsage(
  ownerId: string,
  pool: mysql.Pool = getPool(),
): Promise<StorageUsageSummary> {
  return getDistinctStorageAccountingByOwner(pool, ownerId);
}
