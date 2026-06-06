import mysql from "mysql2/promise";

/**
 * MySQL-backed user store for Paws & Memories.
 * Connection settings come from environment variables:
 *   DB_HOST, DB_PORT (optional, default 3306), DB_NAME, DB_USER, DB_PASSWORD
 */

let pool: mysql.Pool | null = null;

export function dbConfigured(): boolean {
  return !!(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
}

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || "",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

export interface UserRow {
  id: number;
  phone: string;
  full_name: string | null;
  email: string | null;
  password_hash: string | null;
  birthdate: string | null;
  city: string | null;
  phone_verified: number; // 0 | 1
  credits: number;
  profile_complete: number; // 0 | 1
  is_admin?: number; // 0 | 1
  created_at: string;
}

/** Public-safe shape returned to the client. */
export interface PublicUser {
  id: number;
  phone: string;
  fullName: string;
  email: string;
  credits: number;
  city: string;
  birthdate: string;
  profileComplete: boolean;
  isAdmin: boolean;
  dailyStreak: number;
  lastStreakClaim: string | null;
  achievements: any[];
}

export function toPublicUser(userRow: any): PublicUser {
  let achievements = [];
  if (userRow.achievements_json) {
    try { achievements = JSON.parse(userRow.achievements_json); } catch(e) {}
  }
  
  return {
    id: userRow.id,
    phone: userRow.phone,
    fullName: userRow.full_name || "",
    email: userRow.email || "",
    city: userRow.city || "",
    birthdate: userRow.birthdate || "",
    profileComplete: !!userRow.profile_complete,
    credits: userRow.credits,
    isAdmin: !!userRow.is_admin,
    dailyStreak: userRow.daily_streak || 0,
    lastStreakClaim: userRow.last_streak_claim || null,
    achievements: achievements
  };
}

/** Create the users, creations, and generation_jobs tables if they do not exist. Safe to call on every boot. */
export async function initDb(): Promise<void> {
  if (!dbConfigured()) {
    console.warn("⚠️ Database env vars missing (DB_HOST/DB_NAME/DB_USER). User accounts disabled until configured.");
    return;
  }
  try {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(32) NOT NULL UNIQUE,
        full_name VARCHAR(120) NULL,
        email VARCHAR(190) NULL,
        password_hash VARCHAR(255) NULL,
        birthdate DATE NULL,
        city VARCHAR(120) NULL,
        phone_verified TINYINT(1) NOT NULL DEFAULT 0,
        credits INT NOT NULL DEFAULT 0,
        profile_complete TINYINT(1) NOT NULL DEFAULT 0,
        is_admin TINYINT(1) NOT NULL DEFAULT 0,
        daily_streak INT NOT NULL DEFAULT 0,
        last_streak_claim DATE NULL,
        achievements_json TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration for existing tables
    const dbName = process.env.DB_NAME;
    const [cols] = await getPool().query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [dbName]
    ) as any;
    const columnNames = cols.map((c: any) => c.COLUMN_NAME);

    if (!columnNames.includes("password_hash")) {
      await getPool().query(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL`);
      await getPool().query(`ALTER TABLE users ADD COLUMN birthdate DATE NULL`);
      await getPool().query(`ALTER TABLE users ADD COLUMN city VARCHAR(120) NULL`);
      await getPool().query(`ALTER TABLE users ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0`);
    }

    if (!columnNames.includes("daily_streak")) {
      await getPool().query(`ALTER TABLE users ADD COLUMN daily_streak INT NOT NULL DEFAULT 0`);
      await getPool().query(`ALTER TABLE users ADD COLUMN last_streak_claim DATE NULL`);
      await getPool().query(`ALTER TABLE users ADD COLUMN achievements_json TEXT NULL`);
    }
    
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS creations (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_phone    VARCHAR(32) NOT NULL,
        album_id      INT NULL,
        media_type    ENUM('still','video') NOT NULL DEFAULT 'still',
        style         VARCHAR(32) NOT NULL,
        backdrop_kind ENUM('preset','streetview') NOT NULL DEFAULT 'preset',
        preset_name   VARCHAR(32) NULL,
        sv_lat        DECIMAL(10,7) NULL,
        sv_lng        DECIMAL(10,7) NULL,
        sv_heading    SMALLINT NULL,
        sv_pitch      SMALLINT NULL,
        sv_fov        SMALLINT NULL,
        place_label   VARCHAR(190) NULL,
        image_url     TEXT NULL,
        video_url     TEXT NULL,
        sort_order    INT NOT NULL DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone), 
        INDEX (album_id),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_phone      VARCHAR(32) NOT NULL,
        creation_id     INT NULL,
        kind            ENUM('still','video') NOT NULL,
        status          ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
        operation_name  VARCHAR(255) NULL,
        credits_reserved INT NOT NULL DEFAULT 0,
        error           VARCHAR(512) NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_phone), 
        INDEX (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS pets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_phone VARCHAR(32) NOT NULL,
        name VARCHAR(120) NOT NULL,
        kind ENUM('dog','cat','other') NOT NULL DEFAULT 'dog',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("✅ Users, creations, generation_jobs, and pets tables ready.");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
}

export async function findUserByPhone(phone: string): Promise<UserRow | null> {
  const [rows] = await getPool().query("SELECT * FROM users WHERE phone = ? LIMIT 1", [phone]);
  const arr = rows as unknown as UserRow[];
  return arr.length ? arr[0] : null;
}

/** Find an existing user by phone or create a fresh (profile-incomplete) record. */
export async function findOrCreateUser(phone: string): Promise<UserRow> {
  const existing = await findUserByPhone(phone);
  if (existing) return existing;
  await getPool().query(
    "INSERT INTO users (phone, credits, profile_complete) VALUES (?, 0, 0)",
    [phone]
  );
  const created = await findUserByPhone(phone);
  if (!created) throw new Error("User creation failed");
  return created;
}

/**
 * Save name + email and mark the profile complete.
 * Grants the 50 free credits only the first time the profile is completed.
 */
export async function completeUserProfile(
  phone: string,
  fullName: string,
  email: string,
  passwordHash: string,
  birthdate: string,
  city: string
): Promise<UserRow> {
  await getPool().query(
    `UPDATE users
       SET full_name = ?,
           email = ?,
           password_hash = ?,
           birthdate = ?,
           city = ?,
           credits = CASE WHEN profile_complete = 0 THEN credits + 50 ELSE credits END,
           profile_complete = 1
     WHERE phone = ?`,
    [fullName, email, passwordHash, birthdate, city, phone]
  );
  const updated = await findUserByPhone(phone);
  if (!updated) throw new Error("User not found after profile update");
  return updated;
}

/** Read the current credit balance for a phone number from the DB. */
export async function getCreditBalance(phone: string): Promise<number> {
  const user = await findUserByPhone(phone);
  return user ? user.credits : 0;
}

/**
 * Atomically deduct credits only if the user has enough.
 * Returns true if the deduction succeeded, false if insufficient balance.
 */
export async function deductCredits(phone: string, amount: number): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE users SET credits = credits - ? WHERE phone = ? AND credits >= ?`,
    [amount, phone, amount]
  ) as any;
  return result.affectedRows === 1;
}

/**
 * Add credits to a user's account (purchases, rewards, webhooks).
 * Safe to call from Stripe webhooks.
 */
export async function addCredits(phone: string, amount: number): Promise<void> {
  await getPool().query(
    `UPDATE users SET credits = credits + ? WHERE phone = ?`,
    [amount, phone]
  );
}

// ============================================================================
// Creations (Album Items) Helpers
// ============================================================================

export interface CreationRow {
  id: number;
  user_phone: string;
  album_id: number | null;
  media_type: 'still' | 'video';
  style: string;
  backdrop_kind: 'preset' | 'streetview';
  preset_name: string | null;
  sv_lat: number | null;
  sv_lng: number | null;
  sv_heading: number | null;
  sv_pitch: number | null;
  sv_fov: number | null;
  place_label: string | null;
  image_url: string | null;
  video_url: string | null;
  sort_order: number;
  created_at: string;
}

export async function saveCreation(data: {
  user_phone: string;
  album_id?: number | null;
  media_type: 'still' | 'video';
  style: string;
  backdrop_kind: 'preset' | 'streetview';
  preset_name?: string | null;
  sv_lat?: number | null;
  sv_lng?: number | null;
  sv_heading?: number | null;
  sv_pitch?: number | null;
  sv_fov?: number | null;
  place_label?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  sort_order?: number;
}): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO creations (
      user_phone, album_id, media_type, style, backdrop_kind, preset_name,
      sv_lat, sv_lng, sv_heading, sv_pitch, sv_fov, place_label, image_url, video_url, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.user_phone,
      data.album_id || null,
      data.media_type,
      data.style,
      data.backdrop_kind,
      data.preset_name || null,
      data.sv_lat || null,
      data.sv_lng || null,
      data.sv_heading || null,
      data.sv_pitch || null,
      data.sv_fov || null,
      data.place_label || null,
      data.image_url || null,
      data.video_url || null,
      data.sort_order || 0,
    ]
  ) as any;
  return result.insertId;
}

export async function getCreations(phone: string): Promise<CreationRow[]> {
  const [rows] = await getPool().query(
    `SELECT * FROM creations WHERE user_phone = ? ORDER BY sort_order ASC, created_at DESC`,
    [phone]
  );
  return rows as unknown as CreationRow[];
}

export async function getAllCreations(): Promise<CreationRow[]> {
  const [rows] = await getPool().query(
    `SELECT * FROM creations ORDER BY created_at DESC`
  );
  return rows as unknown as CreationRow[];
}

export async function updateCreation(
  id: number,
  phone: string,
  updates: Partial<{
    media_type: 'still' | 'video';
    style: string;
    backdrop_kind: 'preset' | 'streetview';
    preset_name: string | null;
    sv_lat: number | null;
    sv_lng: number | null;
    sv_heading: number | null;
    sv_pitch: number | null;
    sv_fov: number | null;
    place_label: string | null;
    image_url: string | null;
    video_url: string | null;
    sort_order: number;
  }>
): Promise<boolean> {
  const setClauses: string[] = [];
  const values: any[] = [];

  Object.entries(updates).forEach(([key, value]) => {
    setClauses.push(`${key} = ?`);
    values.push(value);
  });

  if (setClauses.length === 0) return true;

  values.push(id, phone);
  const [result] = await getPool().query(
    `UPDATE creations SET ${setClauses.join(', ')} WHERE id = ? AND user_phone = ?`,
    values
  ) as any;

  return result.affectedRows === 1;
}

// ============================================================================
// Generation Jobs Helpers
// ============================================================================

export interface JobRow {
  id: number;
  user_phone: string;
  creation_id: number | null;
  kind: 'still' | 'video';
  status: 'queued' | 'running' | 'done' | 'failed';
  operation_name: string | null;
  credits_reserved: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export async function createJob(data: {
  user_phone: string;
  creation_id?: number | null;
  kind: 'still' | 'video';
  credits_reserved: number;
  operation_name?: string | null;
}): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO generation_jobs (user_phone, creation_id, kind, credits_reserved, operation_name, status)
     VALUES (?, ?, ?, ?, ?, 'queued')`,
    [data.user_phone, data.creation_id || null, data.kind, data.credits_reserved, data.operation_name || null]
  ) as any;
  return result.insertId;
}

export async function updateJobStatus(
  jobId: number,
  status: 'queued' | 'running' | 'done' | 'failed',
  error?: string | null,
  operationName?: string | null
): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE generation_jobs SET status = ?, error = ?, operation_name = COALESCE(?, operation_name) WHERE id = ?`,
    [status, error || null, operationName || null, jobId]
  ) as any;
  return result.affectedRows === 1;
}

export async function getJob(jobId: number, phone: string): Promise<JobRow | null> {
  const [rows] = await getPool().query(
    `SELECT * FROM generation_jobs WHERE id = ? AND user_phone = ? LIMIT 1`,
    [jobId, phone]
  );
  const arr = rows as unknown as JobRow[];
  return arr.length ? arr[0] : null;
}

export async function getRunningJobs(): Promise<JobRow[]> {
  const [rows] = await getPool().query(
    `SELECT * FROM generation_jobs WHERE status IN ('queued', 'running') ORDER BY created_at ASC`
  );
  return rows as unknown as JobRow[];
}

export async function refundCredits(phone: string, amount: number): Promise<void> {
  await getPool().query(
    `UPDATE users SET credits = credits + ? WHERE phone = ?`,
    [amount, phone]
  );
}

export async function setCreationVideoUrl(creationId: number, phone: string, videoUrl: string): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE creations SET video_url = ?, media_type = 'video' WHERE id = ? AND user_phone = ?`,
    [videoUrl, creationId, phone]
  ) as any;
  return result.affectedRows === 1;
}

export async function getDailyVideoCount(phone: string): Promise<number> {
  const [rows] = await getPool().query(
    `SELECT COUNT(*) as count FROM generation_jobs WHERE user_phone = ? AND kind = 'video' AND DATE(created_at) = CURDATE()`,
    [phone]
  );
  const arr = rows as unknown as { count: string | number }[];
  return Number(arr[0].count);
}

export async function isUserAdmin(phone: string): Promise<boolean> {
  const [rows] = await getPool().query("SELECT is_admin FROM users WHERE phone = ? LIMIT 1", [phone]);
  const arr = rows as unknown as { is_admin: number }[];
  return arr.length ? arr[0].is_admin === 1 : false;
}

// ============================================================================
// Pets Helpers
// ============================================================================

export interface PetRow {
  id: number;
  user_phone: string;
  name: string;
  kind: 'dog' | 'cat' | 'other';
  created_at: string;
}

export async function addPet(phone: string, name: string, kind: 'dog' | 'cat' | 'other'): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO pets (user_phone, name, kind) VALUES (?, ?, ?)`,
    [phone, name, kind]
  ) as any;
  return result.insertId;
}

export async function getPets(phone: string): Promise<PetRow[]> {
  const [rows] = await getPool().query(`SELECT * FROM pets WHERE user_phone = ? ORDER BY created_at ASC`, [phone]);
  return rows as unknown as PetRow[];
}

export async function updatePet(id: number, phone: string, name: string, kind: 'dog' | 'cat' | 'other'): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE pets SET name = ?, kind = ? WHERE id = ? AND user_phone = ?`,
    [name, kind, id, phone]
  ) as any;
  return result.affectedRows === 1;
}

export async function deletePet(id: number, phone: string): Promise<boolean> {
  const [result] = await getPool().query(`DELETE FROM pets WHERE id = ? AND user_phone = ?`, [id, phone]) as any;
  return result.affectedRows === 1;
}
