require('dotenv').config();
const mysql = require('mysql2/promise');
async function run() {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const [rows] = await pool.query("SELECT id, name, media_type, video_url, image_url FROM creations ORDER BY id DESC LIMIT 5");
  console.log(rows);
  process.exit(0);
}
run().catch(console.error);
