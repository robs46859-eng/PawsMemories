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
  credits: number;
  profile_complete: number; // 0 | 1
  created_at: string;
}

/** Public-safe shape returned to the client. */
export interface PublicUser {
  phone: string;
  fullName: string;
  email: string;
  credits: number;
  profileComplete: boolean;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    phone: u.phone,
    fullName: u.full_name || "",
    email: u.email || "",
    credits: u.credits,
    profileComplete: u.profile_complete === 1,
  };
}

/** Create the users table if it does not exist. Safe to call on every boot. */
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
        credits INT NOT NULL DEFAULT 0,
        profile_complete TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("✅ Users table ready.");
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
export async function completeUserProfile(phone: string, fullName: string, email: string): Promise<UserRow> {
  await getPool().query(
    `UPDATE users
       SET full_name = ?,
           email = ?,
           credits = CASE WHEN profile_complete = 0 THEN credits + 50 ELSE credits END,
           profile_complete = 1
     WHERE phone = ?`,
    [fullName, email, phone]
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
