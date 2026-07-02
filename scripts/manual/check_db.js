require('dotenv').config();
const { getPool } = require('./db');

async function run() {
  const [rows] = await getPool().query("SELECT id, name, media_type, video_url, image_url FROM creations ORDER BY id DESC LIMIT 5");
  console.log(rows);
  process.exit(0);
}
run().catch(console.error);
