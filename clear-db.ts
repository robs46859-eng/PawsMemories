import 'dotenv/config';
import { closePool, getPool } from './db';

const CONFIRMATION = "DELETE_ONE_USER_GENERATIONS";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("clear-db.ts is disabled when NODE_ENV=production.");
  }
  if (process.env.ALLOW_DESTRUCTIVE_DB_CLEAR !== CONFIRMATION) {
    throw new Error(`Set ALLOW_DESTRUCTIVE_DB_CLEAR=${CONFIRMATION} to continue.`);
  }
  const userPhone = process.env.DB_CLEAR_USER_PHONE?.trim();
  const backupRef = process.env.DB_CLEAR_BACKUP_REF?.trim();
  if (!userPhone) throw new Error("DB_CLEAR_USER_PHONE is required; global deletion is not supported.");
  if (!backupRef) throw new Error("DB_CLEAR_BACKUP_REF is required before deleting data.");

  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM photo_requests WHERE user_phone = ?", [userPhone]);
    await connection.query("DELETE FROM creations WHERE user_phone = ?", [userPhone]);
    await connection.query("DELETE FROM avatars WHERE user_phone = ?", [userPhone]);
    await connection.commit();
    console.log(`Deleted generation records for one user. Backup: ${backupRef}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await closePool();
  }
}
main().catch(async (error) => {
  console.error(error);
  await closePool().catch(() => {});
  process.exit(1);
});
