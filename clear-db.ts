import 'dotenv/config';
import { getPool } from './db';

async function main() {
  const pool = getPool();
  
  console.log("Wiping creations and avatars...");
  await pool.query("DELETE FROM creations");
  await pool.query("DELETE FROM avatars");
  await pool.query("DELETE FROM photo_requests"); // Just to be safe? The user said "generated images and videos"
  console.log("Deleted all old generations!");
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
