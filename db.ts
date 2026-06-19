import mysql from "mysql2/promise";
import { generateUserKey } from "./auth";

/** Internal row key for the seeded admin account (not a phone number). */
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_PHONE || "";

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
  credits: number;
  treats: number;
  profile_complete: number; // 0 | 1
  is_admin?: number; // 0 | 1
  daily_streak?: number;
  last_streak_claim?: string | null;
  achievements_json?: string | null;
  created_at: string;
}

/** Public-safe shape returned to the client. */
export interface PublicUser {
  id: number;
  fullName: string;
  email: string;
  credits: number;
  treats: number;
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
    fullName: userRow.full_name || "",
    email: userRow.email || "",
    city: userRow.city || "",
    birthdate: userRow.birthdate || "",
    profileComplete: !!userRow.profile_complete,
    credits: userRow.credits,
    treats: userRow.treats || 0,
    isAdmin: !!userRow.is_admin || (!!ADMIN_KEY && userRow.phone === ADMIN_KEY),
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
        credits INT NOT NULL DEFAULT 0,
        treats INT NOT NULL DEFAULT 0,
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

    // Robust migration: ensure every expected column exists on legacy tables.
    // (Older deploys created `users` without some of these — e.g. is_admin —
    //  and CREATE TABLE IF NOT EXISTS never alters an existing table.)
    const requiredColumns: { name: string; ddl: string }[] = [
      { name: "email",             ddl: "ADD COLUMN email VARCHAR(190) NULL" },
      { name: "password_hash",     ddl: "ADD COLUMN password_hash VARCHAR(255) NULL" },
      { name: "birthdate",         ddl: "ADD COLUMN birthdate DATE NULL" },
      { name: "city",              ddl: "ADD COLUMN city VARCHAR(120) NULL" },
      { name: "credits",           ddl: "ADD COLUMN credits INT NOT NULL DEFAULT 0" },
      { name: "treats",            ddl: "ADD COLUMN treats INT NOT NULL DEFAULT 0" },
      { name: "profile_complete",  ddl: "ADD COLUMN profile_complete TINYINT(1) NOT NULL DEFAULT 0" },
      { name: "is_admin",          ddl: "ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0" },
      { name: "daily_streak",      ddl: "ADD COLUMN daily_streak INT NOT NULL DEFAULT 0" },
      { name: "last_streak_claim", ddl: "ADD COLUMN last_streak_claim DATE NULL" },
      { name: "achievements_json", ddl: "ADD COLUMN achievements_json TEXT NULL" },
    ];
    for (const col of requiredColumns) {
      if (!columnNames.includes(col.name)) {
        try {
          await getPool().query(`ALTER TABLE users ${col.ddl}`);
          console.log(`✅ Migrated users: added column ${col.name}.`);
        } catch (colErr) {
          console.warn(`⚠️ Could not add column ${col.name}:`, colErr);
        }
      }
    }

    // Email is now the login gate, so it must be unique. Add the index if it
    // isn't already present. (MySQL allows multiple NULL emails under a UNIQUE
    // index, so this is safe even if some legacy rows have no email.)
    try {
      const [idx] = await getPool().query(
        `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'uniq_email'`,
        [dbName]
      ) as any;
      if (!idx[0] || Number(idx[0].c) === 0) {
        await getPool().query(`ALTER TABLE users ADD UNIQUE INDEX uniq_email (email)`);
        console.log("✅ Added unique index on users.email.");
      }
    } catch (idxErr) {
      console.warn("⚠️ Could not add unique email index (duplicate emails may exist):", idxErr);
    }

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS albums (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_phone VARCHAR(32) NOT NULL,
        name VARCHAR(120) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

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
        pet_name      VARCHAR(120) NULL,
        pet_breed     VARCHAR(120) NULL,
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

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS avatars (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_phone VARCHAR(32) NOT NULL,
        name VARCHAR(120) NOT NULL,
        image_url TEXT NOT NULL,
        model_url TEXT NULL,
        sprite_sheet_url TEXT NULL,
        animation_data JSON NULL,
        animal_type VARCHAR(50) NULL,
        breed VARCHAR(120) NULL,
        generation_status ENUM('pending','generating_mesh','rigging','baking_sprites','done','failed') NOT NULL DEFAULT 'done',
        generation_error TEXT NULL,
        food_level INT NOT NULL DEFAULT 100,
        water_level INT NOT NULL DEFAULT 100,
        last_fed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_watered TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration: add 3D columns to existing avatars table
    const [avatarCols] = await getPool().query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'avatars'`,
      [dbName]
    ) as any;
    const avatarColumnNames = avatarCols.map((c: any) => c.COLUMN_NAME);

    const requiredAvatarColumns: { name: string; ddl: string }[] = [
      { name: "model_url",          ddl: "ADD COLUMN model_url TEXT NULL" },
      { name: "sprite_sheet_url",   ddl: "ADD COLUMN sprite_sheet_url TEXT NULL" },
      { name: "animation_data",     ddl: "ADD COLUMN animation_data JSON NULL" },
      { name: "animal_type",        ddl: "ADD COLUMN animal_type VARCHAR(50) NULL" },
      { name: "breed",              ddl: "ADD COLUMN breed VARCHAR(120) NULL" },
      { name: "generation_status",  ddl: "ADD COLUMN generation_status ENUM('pending','generating_mesh','rigging','baking_sprites','done','failed') NOT NULL DEFAULT 'done'" },
      { name: "generation_error",   ddl: "ADD COLUMN generation_error TEXT NULL" },
    ];
    for (const col of requiredAvatarColumns) {
      if (!avatarColumnNames.includes(col.name)) {
        try {
          await getPool().query(`ALTER TABLE avatars ${col.ddl}`);
          console.log(`✅ Migrated avatars: added column ${col.name}.`);
        } catch (colErr) {
          console.warn(`⚠️ Could not add column ${col.name} to avatars:`, colErr);
        }
      }
    }

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS photo_requests (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        user_phone        VARCHAR(32) NOT NULL,
        request_type      ENUM('photo_standard','photo_premium','video_standard','video_premium') NOT NULL,
        comment           TEXT NOT NULL,
        photo_url         TEXT NULL,
        result_url        TEXT NULL,
        creation_id       INT NULL,
        status            ENUM('pending','fulfilled','rejected') NOT NULL DEFAULT 'pending',
        stripe_session_id VARCHAR(255) NULL,
        paid              TINYINT(1) NOT NULL DEFAULT 0,
        amount_paid       DECIMAL(6,2) NULL,
        admin_notes       TEXT NULL,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_phone),
        INDEX (status),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration check for creations table
    const [creationsCols] = await getPool().query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'creations'`,
      [dbName]
    ) as any;
    const creationsColumnNames = creationsCols.map((c: any) => c.COLUMN_NAME);

    const requiredCreationsColumns: { name: string; ddl: string }[] = [
      { name: "pet_name",  ddl: "ADD COLUMN pet_name VARCHAR(120) NULL" },
      { name: "pet_breed", ddl: "ADD COLUMN pet_breed VARCHAR(120) NULL" },
    ];
    for (const col of requiredCreationsColumns) {
      if (!creationsColumnNames.includes(col.name)) {
        try {
          await getPool().query(`ALTER TABLE creations ${col.ddl}`);
          console.log(`✅ Migrated creations: added column ${col.name}.`);
        } catch (colErr) {
          console.warn(`⚠️ Could not add column ${col.name} to creations:`, colErr);
        }
      }
    }

    console.log("✅ Users, creations, generation_jobs, pets, avatars, and photo_requests tables ready.");

    // Seed admin account from environment variables — no hardcoded credentials.
    // Admins log in through the normal email + password login screen.
    try {
      const adminKey = ADMIN_KEY;
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (adminKey && adminEmail && adminPassword) {
        const { hashPassword } = await import("./auth");
        const passwordHash = hashPassword(adminPassword);
        await getPool().query(
          `INSERT INTO users (phone, email, password_hash, is_admin, profile_complete, credits, full_name)
           VALUES (?, ?, ?, 1, 1, 9999, 'Admin')
           ON DUPLICATE KEY UPDATE
             email = VALUES(email),
             password_hash = VALUES(password_hash),
             is_admin = 1,
             profile_complete = 1`,
          [adminKey, adminEmail, passwordHash]
        );
        console.log("✅ Admin account upserted from env vars.");
      }
    } catch (seedErr) {
      console.warn("⚠️ Admin seed skipped:", seedErr);
    }
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
}

/** Look up a user by their opaque internal key (stored in users.phone). */
export async function findUserByPhone(phone: string): Promise<UserRow | null> {
  const [rows] = await getPool().query("SELECT * FROM users WHERE phone = ? LIMIT 1", [phone]);
  const arr = rows as unknown as UserRow[];
  return arr.length ? arr[0] : null;
}

/** Look up a user by email (the login gate). Email is stored lower-cased. */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await getPool().query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  const arr = rows as unknown as UserRow[];
  return arr.length ? arr[0] : null;
}

/** Raised when a sign-up uses an email that already has an account. */
export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists. Please log in instead.");
    this.name = "EmailTakenError";
  }
}

/**
 * Create a fresh (profile-incomplete) account gated by email + password.
 * A synthetic internal key is generated for the users.phone column so the
 * existing foreign-key relationships keep working. The 50 free credits are NOT
 * granted here — they are granted when the user completes their profile.
 */
export async function createUserByEmail(email: string, passwordHash: string): Promise<UserRow> {
  // Guard against a race / duplicate before insert.
  const existing = await findUserByEmail(email);
  if (existing) throw new EmailTakenError();

  const userKey = generateUserKey();
  try {
    await getPool().query(
      "INSERT INTO users (phone, email, password_hash, credits, treats, profile_complete) VALUES (?, ?, ?, 0, 0, 0)",
      [userKey, email, passwordHash]
    );
  } catch (err: any) {
    if (err && err.code === "ER_DUP_ENTRY") throw new EmailTakenError();
    throw err;
  }
  const created = await findUserByPhone(userKey);
  if (!created) throw new Error("User creation failed");
  return created;
}

/**
 * Save the required profile details and mark the profile complete.
 * Email + password were already set at sign-up, so they are not touched here.
 * Grants the 50 free credits only the first time the profile is completed.
 */
export async function completeUserProfile(
  phone: string,
  fullName: string,
  birthdate: string,
  city: string
): Promise<UserRow> {
  await getPool().query(
    `UPDATE users
       SET full_name = ?,
           birthdate = ?,
           city = ?,
           credits = CASE WHEN profile_complete = 0 THEN credits + 50 ELSE credits END,
           profile_complete = 1
     WHERE phone = ?`,
    [fullName, birthdate, city, phone]
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
// Albums Helpers
// ============================================================================

export interface AlbumRow {
  id: number;
  user_phone: string;
  name: string;
  created_at: string;
  itemCount?: number; // Aggregated count of creations inside the album
}

export async function createAlbum(phone: string, name: string): Promise<AlbumRow> {
  const [result] = await getPool().query(
    "INSERT INTO albums (user_phone, name) VALUES (?, ?)",
    [phone, name]
  ) as any;
  return {
    id: result.insertId,
    user_phone: phone,
    name,
    created_at: new Date().toISOString(),
    itemCount: 0
  };
}

export async function getAlbums(phone: string): Promise<AlbumRow[]> {
  const [rows] = await getPool().query(`
    SELECT a.*, COUNT(c.id) as itemCount,
      (SELECT image_url FROM creations
       WHERE album_id = a.id
       ORDER BY sort_order ASC, created_at ASC LIMIT 1) as cover_url
    FROM albums a
    LEFT JOIN creations c ON a.id = c.album_id
    WHERE a.user_phone = ?
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `, [phone]) as any;
  return rows;
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
  pet_name?: string | null;
  pet_breed?: string | null;
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
  pet_name?: string | null;
  pet_breed?: string | null;
}): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO creations (
      user_phone, album_id, media_type, style, backdrop_kind, preset_name,
      sv_lat, sv_lng, sv_heading, sv_pitch, sv_fov, place_label, image_url, video_url, sort_order, pet_name, pet_breed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      data.pet_name || null,
      data.pet_breed || null,
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
    `SELECT COUNT(*) as count FROM generation_jobs WHERE user_phone = ? AND kind = 'video' AND status NOT IN ('failed') AND DATE(created_at) = CURDATE()`,
    [phone]
  );
  const arr = rows as unknown as { count: string | number }[];
  return Number(arr[0].count);
}

export async function isUserAdmin(phone: string): Promise<boolean> {
  // Bypass for the seeded admin account (matched by internal row key).
  if (ADMIN_KEY && phone === ADMIN_KEY) return true;

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

// ============================================================================
// Avatars Helpers
// ============================================================================

export interface AvatarRow {
  id: number;
  user_phone: string;
  name: string;
  image_url: string;
  model_url: string | null;
  sprite_sheet_url: string | null;
  animation_data: any | null;
  animal_type: string | null;
  breed: string | null;
  generation_status: 'pending' | 'generating_mesh' | 'rigging' | 'baking_sprites' | 'done' | 'failed';
  generation_error: string | null;
  food_level: number;
  water_level: number;
  last_fed: string;
  last_watered: string;
  created_at: string;
}

export async function createAvatar(
  phone: string,
  name: string,
  image_url: string,
  opts?: {
    animal_type?: string;
    breed?: string;
    generation_status?: string;
  }
): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO avatars (user_phone, name, image_url, animal_type, breed, generation_status) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      phone,
      name,
      image_url,
      opts?.animal_type || null,
      opts?.breed || null,
      opts?.generation_status || 'done',
    ]
  ) as any;
  return result.insertId;
}

export async function updateAvatarModel(
  id: number,
  phone: string,
  modelUrl: string,
  spriteSheetUrl: string,
  animationData: any
): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE avatars SET model_url = ?, sprite_sheet_url = ?, animation_data = ?, generation_status = 'done' WHERE id = ? AND user_phone = ?`,
    [modelUrl, spriteSheetUrl, JSON.stringify(animationData), id, phone]
  ) as any;
  return result.affectedRows === 1;
}

export async function updateAvatarGenerationStatus(
  id: number,
  status: 'pending' | 'generating_mesh' | 'rigging' | 'baking_sprites' | 'done' | 'failed',
  error?: string | null
): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE avatars SET generation_status = ?, generation_error = ? WHERE id = ?`,
    [status, error || null, id]
  ) as any;
  return result.affectedRows === 1;
}

export async function getAvatarById(id: number, phone: string): Promise<AvatarRow | null> {
  const [rows] = await getPool().query(
    `SELECT * FROM avatars WHERE id = ? AND user_phone = ? LIMIT 1`,
    [id, phone]
  );
  const arr = rows as unknown as AvatarRow[];
  return arr.length ? arr[0] : null;
}

export async function getAvatars(phone: string): Promise<AvatarRow[]> {
  const [rows] = await getPool().query(`SELECT * FROM avatars WHERE user_phone = ? ORDER BY created_at ASC`, [phone]);
  return rows as unknown as AvatarRow[];
}

export async function feedAvatar(id: number, phone: string): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE avatars SET food_level = 100, last_fed = CURRENT_TIMESTAMP WHERE id = ? AND user_phone = ?`,
    [id, phone]
  ) as any;
  return result.affectedRows === 1;
}

export async function waterAvatar(id: number, phone: string): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE avatars SET water_level = 100, last_watered = CURRENT_TIMESTAMP WHERE id = ? AND user_phone = ?`,
    [id, phone]
  ) as any;
  return result.affectedRows === 1;
}

export async function giveTreatToAvatar(id: number, phone: string): Promise<boolean> {
  // Deduct 1 treat from user, if successful, feed the avatar by +20 (cap at 100)
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [updateUser] = await connection.query(
      `UPDATE users SET treats = treats - 1 WHERE phone = ? AND treats >= 1`,
      [phone]
    ) as any;
    
    if (updateUser.affectedRows === 0) {
      await connection.rollback();
      return false; // Not enough treats
    }
    
    await connection.query(
      `UPDATE avatars SET food_level = LEAST(food_level + 20, 100) WHERE id = ? AND user_phone = ?`,
      [id, phone]
    );
    
    await connection.commit();
    return true;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Daily Streak with Treats
export async function claimDailyStreak(phone: string): Promise<{success: boolean}> {
  const user = await findUserByPhone(phone);
  if (!user) return { success: false };

  const today = new Date().toISOString().split('T')[0];
  if (user.last_streak_claim && user.last_streak_claim.startsWith(today)) {
    return { success: false }; // Already claimed today
  }

  // Determine if it's contiguous (yesterday)
  let newStreak = 1;
  if (user.last_streak_claim) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (user.last_streak_claim.startsWith(yesterdayStr)) {
      newStreak = (user.daily_streak || 0) + 1;
    }
  }

  // Reward: 5 credits and 1 treat
  await getPool().query(
    `UPDATE users 
     SET daily_streak = ?, 
         last_streak_claim = ?, 
         credits = credits + 5,
         treats = treats + 1
     WHERE phone = ?`,
    [newStreak, today, phone]
  );
  return { success: true };
}

// ============================================================================
// Photo Requests Helpers
// ============================================================================

export interface PhotoRequestRow {
  id: number;
  user_phone: string;
  request_type: 'photo_standard' | 'photo_premium' | 'video_standard' | 'video_premium';
  comment: string;
  photo_url: string | null;
  result_url: string | null;
  creation_id: number | null;
  status: 'pending' | 'fulfilled' | 'rejected';
  stripe_session_id: string | null;
  paid: number; // 0 | 1
  amount_paid: number | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (admin view only)
  user_full_name?: string | null;
  user_email?: string | null;
}

export async function createPhotoRequest(data: {
  user_phone: string;
  request_type: 'photo_standard' | 'photo_premium' | 'video_standard' | 'video_premium';
  comment: string;
  photo_url?: string | null;
  stripe_session_id?: string | null;
  amount_paid?: number | null;
}): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO photo_requests (user_phone, request_type, comment, photo_url, stripe_session_id, amount_paid, status, paid)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)`,
    [
      data.user_phone,
      data.request_type,
      data.comment,
      data.photo_url || null,
      data.stripe_session_id || null,
      data.amount_paid || null,
    ]
  ) as any;
  return result.insertId;
}

export async function getPhotoRequests(phone: string): Promise<PhotoRequestRow[]> {
  const [rows] = await getPool().query(
    `SELECT * FROM photo_requests WHERE user_phone = ? ORDER BY created_at DESC`,
    [phone]
  );
  return rows as unknown as PhotoRequestRow[];
}

export async function getAllPhotoRequests(): Promise<PhotoRequestRow[]> {
  const [rows] = await getPool().query(
    `SELECT pr.*, u.full_name as user_full_name, u.email as user_email
     FROM photo_requests pr
     LEFT JOIN users u ON u.phone = pr.user_phone
     ORDER BY pr.created_at DESC`
  );
  return rows as unknown as PhotoRequestRow[];
}

export async function getPhotoRequest(id: number): Promise<PhotoRequestRow | null> {
  const [rows] = await getPool().query(
    `SELECT pr.*, u.full_name as user_full_name, u.email as user_email
     FROM photo_requests pr
     LEFT JOIN users u ON u.phone = pr.user_phone
     WHERE pr.id = ? LIMIT 1`,
    [id]
  );
  const arr = rows as unknown as PhotoRequestRow[];
  return arr.length ? arr[0] : null;
}

export async function markPhotoRequestPaid(
  stripeSessionId: string,
  amountPaid: number
): Promise<PhotoRequestRow | null> {
  await getPool().query(
    `UPDATE photo_requests SET paid = 1, amount_paid = ? WHERE stripe_session_id = ? AND paid = 0`,
    [amountPaid, stripeSessionId]
  );
  return getPhotoRequestByStripeSession(stripeSessionId);
}

export async function fulfillPhotoRequest(
  id: number,
  creationId: number,
  resultUrl: string
): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE photo_requests SET status = 'fulfilled', creation_id = ?, result_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [creationId, resultUrl, id]
  ) as any;
  return result.affectedRows === 1;
}

export async function rejectPhotoRequest(
  id: number,
  adminNotes?: string | null
): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE photo_requests SET status = 'rejected', admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [adminNotes || null, id]
  ) as any;
  return result.affectedRows === 1;
}

export async function getPhotoRequestByStripeSession(sessionId: string): Promise<PhotoRequestRow | null> {
  const [rows] = await getPool().query(
    `SELECT * FROM photo_requests WHERE stripe_session_id = ? LIMIT 1`,
    [sessionId]
  );
  const arr = rows as unknown as PhotoRequestRow[];
  return arr.length ? arr[0] : null;
}
