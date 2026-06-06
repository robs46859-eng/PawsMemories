import { getPool } from "./db";

async function main() {
  try {
    const [rows] = await getPool().query("SELECT id, phone, full_name, is_admin FROM users") as any;
    console.log("Users in DB:");
    console.table(rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
