import dotenv from "dotenv";
dotenv.config();
import { getPool } from "./db";
async function run() {
  try {
    const [rows] = await getPool().query("SELECT id, email, password_hash, is_admin FROM users LIMIT 5");
    console.log(rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
