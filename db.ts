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
  zip: string | null;
  credits: number;
  treats: number;
  profile_complete: number;
  is_admin?: number;
  daily_streak?: number;
  last_streak_claim?: string | null;
  achievements_json?: string | null;
  profile_photo_url?: string | null;
  created_at: string;
  // Phase 8
  phone_verified?: number;
  email_verified?: number;
  bio?: string | null;
  notification_prefs?: string | null;
  profile_bonus_granted?: number;
  accepted_terms_version?: string | null;
  accepted_terms_at?: string | null;
  pawprint_tokens?: number;
  referral_code?: string | null;
  referred_by?: string | null;
}

/** Public-safe shape returned to the client. */
export interface PublicUser {
  id: number;
  fullName: string;
  email: string;
  credits: number;
  treats: number;
  city: string;
  zip?: string;
  birthdate: string;
  profileComplete: boolean;
  isAdmin: boolean;
  dailyStreak: number;
  lastStreakClaim: string | null;
  profilePhotoUrl: string | null;
  achievements: any[];
  // Phase 8
  bio?: string | null;
  phoneVerified?: boolean;
  emailVerified?: boolean;
  pawprintTokens?: number;
  referralCode?: string | null;
  profileBonusGranted?: boolean;
  acceptedTermsVersion?: string | null;
  acceptedTermsAt?: string | null;
  currentTermsVersion?: string;
  requiresTermsAcceptance?: boolean;
}

export function toPublicUser(userRow: any, currentTermsVersion?: string): PublicUser {
  let achievements = [];
  if (userRow.achievements_json) {
    try { achievements = JSON.parse(userRow.achievements_json); } catch(e) {}
  }
  
  const acceptedTermsVersion = userRow.accepted_terms_version || null;
  return {
    id: userRow.id,
    fullName: userRow.full_name || "",
    email: userRow.email || "",
    city: userRow.city || "",
    zip: userRow.zip || undefined,
    birthdate: userRow.birthdate || "",
    profileComplete: !!userRow.profile_complete,
    credits: userRow.credits,
    treats: userRow.treats || 0,
    isAdmin: !!userRow.is_admin || (!!ADMIN_KEY && userRow.phone === ADMIN_KEY),
    dailyStreak: userRow.daily_streak || 0,
    lastStreakClaim: userRow.last_streak_claim || null,
    profilePhotoUrl: userRow.profile_photo_url || null,
    achievements: achievements,
    bio: userRow.bio || null,
    phoneVerified: !!userRow.phone_verified,
    emailVerified: !!userRow.email_verified,
    pawprintTokens: userRow.pawprint_tokens || 0,
    referralCode: userRow.referral_code || null,
    profileBonusGranted: !!userRow.profile_bonus_granted,
    acceptedTermsVersion,
    acceptedTermsAt: userRow.accepted_terms_at || null,
    currentTermsVersion,
    requiresTermsAcceptance: !!currentTermsVersion && acceptedTermsVersion !== currentTermsVersion,
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
      { name: "profile_photo_url", ddl: "ADD COLUMN profile_photo_url TEXT NULL" },
      // Phase 8 columns
      { name: "zip",                ddl: "ADD COLUMN zip VARCHAR(20) NULL" },
      { name: "phone_verified",     ddl: "ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0" },
      { name: "email_verified",     ddl: "ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0" },
      { name: "bio",                ddl: "ADD COLUMN bio TEXT NULL" },
      { name: "notification_prefs", ddl: "ADD COLUMN notification_prefs JSON NULL" },
      { name: "profile_bonus_granted", ddl: "ADD COLUMN profile_bonus_granted TINYINT(1) NOT NULL DEFAULT 0" },
      { name: "accepted_terms_version", ddl: "ADD COLUMN accepted_terms_version VARCHAR(20) NULL" },
      { name: "accepted_terms_at", ddl: "ADD COLUMN accepted_terms_at TIMESTAMP NULL" },
      { name: "pawprint_tokens",    ddl: "ADD COLUMN pawprint_tokens INT NOT NULL DEFAULT 0" },
      { name: "referral_code",      ddl: "ADD COLUMN referral_code VARCHAR(32) NULL" },
      { name: "referred_by",        ddl: "ADD COLUMN referred_by VARCHAR(32) NULL" },
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
        media_type    ENUM('still','video','model') NOT NULL DEFAULT 'still',
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
        model_url     TEXT NULL,
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
        kind            ENUM('still','video','model') NOT NULL,
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
        meshy_handle VARCHAR(255) NULL,
        model_url TEXT NULL,
        sprite_sheet_url TEXT NULL,
        animation_data JSON NULL,
        animal_type VARCHAR(50) NULL,
        breed VARCHAR(120) NULL,
        generation_status ENUM('pending','generating_mesh','rigging','baking_sprites','done','failed') NOT NULL DEFAULT 'done',
        generation_error TEXT NULL,
        avatar_type VARCHAR(16) NOT NULL DEFAULT 'dog',
        generation_analysis JSON NULL,
        food_level INT NOT NULL DEFAULT 100,
        water_level INT NOT NULL DEFAULT 100,
        last_fed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_watered TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration for avatars table
    try {
      const [avatarCols] = await getPool().query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'avatars'`,
        [dbName]
      ) as any;
      const avatarColumnNames = avatarCols.map((c: any) => c.COLUMN_NAME);
      if (!avatarColumnNames.includes("meshy_handle")) {
        await getPool().query(`ALTER TABLE avatars ADD COLUMN meshy_handle VARCHAR(255) NULL AFTER image_url`);
        console.log(`✅ Migrated avatars: added column meshy_handle.`);
      }
    } catch (migErr) {
      console.warn(`⚠️ Could not migrate avatars table:`, migErr);
    }

    // Migration: add 3D columns to existing avatars table
    const [avatarCols] = await getPool().query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'avatars'`,
      [dbName]
    ) as any;
    const avatarColumnNames = avatarCols.map((c: any) => c.COLUMN_NAME);

    // --- Idempotent migrations for existing databases ---
    // CREATE TABLE IF NOT EXISTS won't alter pre-existing tables, so explicitly
    // add the 3D-model column + extend enums. Each guarded so reruns are safe.
    try {
      const [cols] = await getPool().query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'creations' AND COLUMN_NAME = 'model_url'`
      );
      if ((cols as any[]).length === 0) {
        await getPool().query(`ALTER TABLE creations ADD COLUMN model_url TEXT NULL AFTER video_url`);
        console.log("✅ Migration: added creations.model_url");
      }
      // Extend enums to include 'model' (safe to run repeatedly).
      await getPool().query(
        `ALTER TABLE creations MODIFY COLUMN media_type ENUM('still','video','model') NOT NULL DEFAULT 'still'`
      );
      await getPool().query(
        `ALTER TABLE generation_jobs MODIFY COLUMN kind ENUM('still','video','model') NOT NULL`
      );
    } catch (migErr) {
      console.warn("⚠️ Schema migration warning (model support):", migErr);
    }

    const requiredAvatarColumns: { name: string; ddl: string }[] = [
      { name: "model_url",          ddl: "ADD COLUMN model_url TEXT NULL" },
      { name: "sprite_sheet_url",   ddl: "ADD COLUMN sprite_sheet_url TEXT NULL" },
      { name: "animation_data",     ddl: "ADD COLUMN animation_data JSON NULL" },
      { name: "animal_type",        ddl: "ADD COLUMN animal_type VARCHAR(50) NULL" },
      { name: "breed",              ddl: "ADD COLUMN breed VARCHAR(120) NULL" },
      { name: "generation_status",  ddl: "ADD COLUMN generation_status ENUM('pending','generating_mesh','rigging','baking_sprites','done','failed') NOT NULL DEFAULT 'done'" },
      { name: "generation_error",   ddl: "ADD COLUMN generation_error TEXT NULL" },
      // Living-avatar behavior system (Phase 2): full needs snapshot + last-seen for offline decay.
      { name: "needs_json",         ddl: "ADD COLUMN needs_json JSON NULL" },
      { name: "last_seen",          ddl: "ADD COLUMN last_seen TIMESTAMP NULL" },
      // Rigged skeletal model + clip manifest (Phase 5).
      { name: "rigged_model_url",   ddl: "ADD COLUMN rigged_model_url LONGTEXT NULL" },
      { name: "clips_json",         ddl: "ADD COLUMN clips_json JSON NULL" },
      // Multiview turnaround view URLs ({left,back,right}) so retry/resume can
      // re-run Tripo multiview without regenerating the images.
      { name: "multiview_json",     ddl: "ADD COLUMN multiview_json JSON NULL" },
      { name: "avatar_type",        ddl: "ADD COLUMN avatar_type VARCHAR(16) NOT NULL DEFAULT 'dog'" },
      // Unified triage record (detection + qualification + anatomy) persisted at
      // generation time so the build/rig stage never re-analyzes the image.
      { name: "generation_analysis", ddl: "ADD COLUMN generation_analysis JSON NULL" },
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

    // Ensure large data URIs can be saved if object storage is not configured (MySQL TEXT is only 64KB)
    try {
      await getPool().query(`ALTER TABLE avatars MODIFY COLUMN image_url LONGTEXT NOT NULL`);
      await getPool().query(`ALTER TABLE avatars MODIFY COLUMN model_url LONGTEXT NULL`);
      await getPool().query(`ALTER TABLE avatars MODIFY COLUMN sprite_sheet_url LONGTEXT NULL`);
      await getPool().query(`ALTER TABLE avatars MODIFY COLUMN generation_error LONGTEXT NULL`);
      // Extend generation_status with the rigged-clip pipeline stages (Phase 5).
      await getPool().query(
        `ALTER TABLE avatars MODIFY COLUMN generation_status ENUM('pending','generating_mesh','rigging','retargeting','baking_clips','baking_sprites','done','failed') NOT NULL DEFAULT 'done'`
      );
    } catch (alterErr) {
      console.warn("⚠️ Could not modify avatar columns to LONGTEXT:", alterErr);
    }

    // Placed objects for the living-avatar scene / AR (Phase 3).
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS placed_objects (
        id         VARCHAR(64) PRIMARY KEY,
        avatar_id  INT NOT NULL,
        user_phone VARCHAR(32) NOT NULL,
        kind       VARCHAR(40) NOT NULL,
        pos_x      FLOAT NOT NULL DEFAULT 0,
        pos_y      FLOAT NOT NULL DEFAULT 0,
        pos_z      FLOAT NOT NULL DEFAULT 0,
        rot_y      FLOAT NOT NULL DEFAULT 0,
        scale      FLOAT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (avatar_id),
        INDEX (user_phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // --- AR multi-model cast (Phase 5) ---------
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS scene_actors (
        id               VARCHAR(64) PRIMARY KEY,
        owner_phone      VARCHAR(32) NOT NULL,
        scene_avatar_id  INT NOT NULL,
        source_avatar_id INT NOT NULL,
        transform_json   JSON NOT NULL,
        selected_clip    VARCHAR(100) NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (scene_avatar_id),
        INDEX (owner_phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // --- AR virtual-pet simulator (AR_PET_SIM_SPEC §8, milestone AR2) ---------
    // pet_profiles extends an avatar with breed-aware gameplay + persisted brain state.
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS pet_profiles (
        id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
        avatar_id           INT NOT NULL,
        breed               VARCHAR(64) NULL,
        breed_confidence    DOUBLE NULL,
        size_class          VARCHAR(16) NULL,
        build               JSON NULL,
        temperament         JSON NULL,
        personality_weights JSON NULL,
        hormones            JSON NULL,
        drives              JSON NULL,
        life_stage          ENUM('puppy','adult','senior') NOT NULL DEFAULT 'adult',
        aging_mode          ENUM('off','slow','realistic') NOT NULL DEFAULT 'off',
        mortality_enabled   TINYINT(1) NOT NULL DEFAULT 0,
        trainer_score       INT NOT NULL DEFAULT 0,
        rigged_glb_url      LONGTEXT NULL,
        lod_glb_url         LONGTEXT NULL,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_avatar (avatar_id),
        INDEX (avatar_id),
        FOREIGN KEY (avatar_id) REFERENCES avatars(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS pet_commands (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        pet_id          BIGINT NOT NULL,
        phrase          VARCHAR(120) NULL,
        metaphone_keys  JSON NULL,
        action          VARCHAR(48) NULL,
        compliance      DOUBLE NOT NULL DEFAULT 0.5,
        last_reinforced DATETIME NULL,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (pet_id),
        FOREIGN KEY (pet_id) REFERENCES pet_profiles(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS pet_buttons (
        id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
        pet_id               BIGINT NOT NULL,
        label                VARCHAR(48) NULL,
        audio_url            LONGTEXT NULL,
        linked_action        VARCHAR(48) NULL,
        association_strength DOUBLE NOT NULL DEFAULT 0,
        anchor               JSON NULL,
        created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (pet_id),
        FOREIGN KEY (pet_id) REFERENCES pet_profiles(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS semantic_scans (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_phone  VARCHAR(32) NOT NULL,
        anchor_hash VARCHAR(64) NULL,
        zones       JSON NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        INDEX (anchor_hash),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Per-user, per-day usage counter for the paid AR endpoints (H2/H7 cost caps).
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS api_usage_daily (
        user_phone  VARCHAR(32)  NOT NULL,
        endpoint    VARCHAR(32)  NOT NULL,
        day         DATE         NOT NULL,
        count       INT          NOT NULL DEFAULT 0,
        PRIMARY KEY (user_phone, endpoint, day),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

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

    // Credit ledger: one row per credit change (earn or spend), for spend tracking + history.
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_phone    VARCHAR(32) NOT NULL,
        delta         INT NOT NULL,
        reason        VARCHAR(80) NOT NULL,
        balance_after INT NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Community memory board: user-uploaded photos shown in the live inspiration loop.
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS community_memories (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_phone  VARCHAR(32) NOT NULL,
        image_url   TEXT NOT NULL,
        caption     VARCHAR(200) NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Per-user photo library: profile uploads + photos fed in from the avatar builder.
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS user_photos (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_phone  VARCHAR(32) NOT NULL,
        image_url   TEXT NOT NULL,
        source      VARCHAR(32) NOT NULL DEFAULT 'upload',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        INDEX (created_at)
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

    // Ensure large data URIs can be saved if object storage is not configured
    try {
      await getPool().query(`ALTER TABLE creations MODIFY COLUMN image_url LONGTEXT NULL`);
      await getPool().query(`ALTER TABLE creations MODIFY COLUMN video_url LONGTEXT NULL`);
    } catch (alterErr) {
      console.warn("⚠️ Could not modify creation columns to LONGTEXT:", alterErr);
    }

    console.log("✅ Users, creations, generation_jobs, pets, avatars, and photo_requests tables ready.");

    // Pawprint token ledger (Phase 8): one row per pawprint token change.
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS pawprint_history (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_phone    VARCHAR(32) NOT NULL,
        delta         INT NOT NULL,
        reason        VARCHAR(80) NOT NULL,
        balance_after INT NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        INDEX (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Referrals table (Phase 8)
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        referrer_phone  VARCHAR(32) NOT NULL,
        referred_phone  VARCHAR(32) NOT NULL,
        code            VARCHAR(32) NOT NULL,
        credited_at     TIMESTAMP NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_referred (referred_phone),
        INDEX (referrer_phone),
        INDEX (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Share rewards table (Phase 8)
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS share_rewards (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_phone    VARCHAR(32) NOT NULL,
        generation_id INT NULL,
        network       VARCHAR(32) NOT NULL,
        reward_type   ENUM('credits','pawprint') NOT NULL DEFAULT 'credits',
        granted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_share (user_phone, network),
        INDEX (user_phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Storage accounting table (Phase 8): per-user hot/cold storage tracking.
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS user_storage (
        user_phone      VARCHAR(32) NOT NULL PRIMARY KEY,
        bytes_hot       BIGINT NOT NULL DEFAULT 0,
        bytes_cold      BIGINT NOT NULL DEFAULT 0,
        cold_gb_purchased INT NOT NULL DEFAULT 0,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS voice_clone_assets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_phone VARCHAR(32) NOT NULL,
        name VARCHAR(120) NOT NULL,
        audio_url TEXT NOT NULL,
        mime_type VARCHAR(80) NOT NULL,
        bytes BIGINT NOT NULL DEFAULT 0,
        voice_consent TINYINT(1) NOT NULL DEFAULT 0,
        voice_consent_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_phone),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS pawprint_assets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_phone VARCHAR(32) NOT NULL,
        idempotency_key VARCHAR(120) NOT NULL,
        template_id VARCHAR(80) NOT NULL,
        category VARCHAR(80) NOT NULL,
        layout_id VARCHAR(80) NOT NULL,
        image_url TEXT NOT NULL,
        creation_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_pawprint_request (user_phone, idempotency_key),
        INDEX (user_phone),
        FOREIGN KEY (user_phone) REFERENCES users(phone) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Email hygiene (guarded — must never abort init): normalize to lower-case,
    // then best-effort enforce uniqueness. The UNIQUE index only applies once any
    // legacy duplicate-email rows have been removed; until then it is skipped.
    try {
      await getPool().query("UPDATE users SET email = LOWER(email) WHERE email IS NOT NULL AND email <> LOWER(email)");
    } catch (e) { /* non-fatal */ }
    try {
      await getPool().query("ALTER TABLE users ADD UNIQUE INDEX uniq_users_email (email)");
      console.log("✅ users.email is now UNIQUE.");
    } catch (e: any) {
      if (e?.code === "ER_DUP_KEYNAME") {
        // index already present — fine
      } else if (e?.code === "ER_DUP_ENTRY") {
        console.warn("⚠️ users.email UNIQUE not applied — duplicate emails still exist. Remove duplicates, then redeploy.");
      } else {
        console.warn("⚠️ Could not add users.email UNIQUE index:", e?.message || e);
      }
    }

    // Seed admin account from environment variables — no hardcoded credentials.
    // Upsert keyed on EMAIL (not phone): if an account with this email already
    // exists (under ANY phone key), update it in place instead of inserting a
    // second row. This is what prevents the duplicate-admin / can't-login bug.
    try {
      const adminKey = ADMIN_KEY;
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (adminKey && adminEmail && adminPassword) {
        const { hashPassword } = await import("./auth");
        const email = String(adminEmail).trim().toLowerCase();
        const passwordHash = hashPassword(adminPassword);

        const [existingRows]: any = await getPool().query(
          "SELECT phone FROM users WHERE LOWER(email) = ? ORDER BY id LIMIT 1",
          [email]
        );
        if (existingRows && existingRows.length) {
          await getPool().query(
            "UPDATE users SET email = ?, password_hash = ?, is_admin = 1, profile_complete = 1 WHERE phone = ?",
            [email, passwordHash, existingRows[0].phone]
          );
          console.log("✅ Admin account synced (existing row updated).");
        } else {
          await getPool().query(
            `INSERT INTO users (phone, email, password_hash, is_admin, profile_complete, credits, full_name)
             VALUES (?, ?, ?, 1, 1, 9999, 'Admin')
             ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash), is_admin = 1, profile_complete = 1`,
            [adminKey, email, passwordHash]
          );
          console.log("✅ Admin account seeded (new row).");
        }
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

/** Look up a user by email (the login gate). Email is stored lower-cased.
 *  ORDER BY id keeps the result deterministic if legacy duplicate-email rows exist. */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await getPool().query("SELECT * FROM users WHERE email = ? ORDER BY id LIMIT 1", [String(email).trim().toLowerCase()]);
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
export async function createUserByEmail(email: string, passwordHash: string, acceptedTermsVersion: string): Promise<UserRow> {
  // Guard against a race / duplicate before insert.
  const existing = await findUserByEmail(email);
  if (existing) throw new EmailTakenError();

  const userKey = generateUserKey();
  try {
    await getPool().query(
      `INSERT INTO users
         (phone, email, password_hash, credits, treats, profile_complete, accepted_terms_version, accepted_terms_at)
       VALUES (?, ?, ?, 0, 0, 0, ?, NOW())`,
      [userKey, email, passwordHash, acceptedTermsVersion]
    );
  } catch (err: any) {
    if (err && err.code === "ER_DUP_ENTRY") throw new EmailTakenError();
    throw err;
  }
  const created = await findUserByPhone(userKey);
  if (!created) throw new Error("User creation failed");
  return created;
}

/** Record that the user accepted the currently active legal terms. */
export async function acceptTermsVersion(phone: string, termsVersion: string): Promise<UserRow> {
  await getPool().query(
    `UPDATE users
        SET accepted_terms_version = ?,
            accepted_terms_at = NOW()
      WHERE phone = ?`,
    [termsVersion, phone]
  );
  const updated = await findUserByPhone(phone);
  if (!updated) throw new Error("User not found after terms update");
  return updated;
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
export async function deductCredits(phone: string, amount: number, reason: string = "spend"): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE users SET credits = credits - ? WHERE phone = ? AND credits >= ?`,
    [amount, phone, amount]
  ) as any;
  if (result.affectedRows === 1) {
    await recordCreditTxn(phone, -Math.abs(amount), reason);
  }
  return result.affectedRows === 1;
}

/**
 * Add credits to a user's account (purchases, rewards, webhooks).
 * Safe to call from Stripe webhooks.
 */
export async function addCredits(phone: string, amount: number, reason: string = "credit"): Promise<void> {
  await getPool().query(
    `UPDATE users SET credits = credits + ? WHERE phone = ?`,
    [amount, phone]
  );
  await recordCreditTxn(phone, Math.abs(amount), reason);
}

/**
 * Append a row to the credit ledger. Best-effort: a logging failure must never
 * block or reverse the actual credit change, so errors are swallowed.
 */
export async function recordCreditTxn(phone: string, delta: number, reason: string): Promise<void> {
  try {
    const balance = await getCreditBalance(phone);
    await getPool().query(
      `INSERT INTO credit_transactions (user_phone, delta, reason, balance_after) VALUES (?, ?, ?, ?)`,
      [phone, delta, reason.slice(0, 80), balance]
    );
  } catch (err) {
    console.warn("[credit ledger] failed to record transaction:", (err as any)?.message || err);
  }
}

export interface CreditTransaction {
  id: number;
  delta: number;
  reason: string;
  balance_after: number;
  created_at: string;
}

/** Recent credit transactions for a user, newest first (for spend tracking / history). */
export async function getCreditHistory(phone: string, limit: number = 20): Promise<CreditTransaction[]> {
  const [rows] = await getPool().query(
    `SELECT id, delta, reason, balance_after, created_at
       FROM credit_transactions WHERE user_phone = ? ORDER BY id DESC LIMIT ?`,
    [phone, Math.max(1, Math.min(100, limit))]
  ) as any;
  return rows as CreditTransaction[];
}

/**
 * Whether a Stripe checkout session has already granted credits. Used to keep
 * the webhook and the redirect-confirm path from double-crediting the same
 * purchase (both tag the ledger row with reason "purchase:<sessionId>").
 */
export async function wasSessionCredited(sessionId: string): Promise<boolean> {
  const [rows] = await getPool().query(
    `SELECT 1 FROM credit_transactions WHERE reason = ? LIMIT 1`,
    [`purchase:${sessionId}`]
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
}

// ============================================================================
// Community Memory Board
// ============================================================================

export interface CommunityMemory {
  id: number;
  user_phone: string;
  image_url: string;
  caption: string | null;
  created_at: string;
}

export async function addCommunityMemory(phone: string, imageUrl: string, caption: string | null): Promise<number> {
  const [r] = await getPool().query(
    `INSERT INTO community_memories (user_phone, image_url, caption) VALUES (?, ?, ?)`,
    [phone, imageUrl, caption ? caption.slice(0, 200) : null]
  ) as any;
  return r.insertId;
}

/** Recent community memories, newest first, for the live inspiration board. */
export async function getCommunityMemories(limit: number = 30): Promise<CommunityMemory[]> {
  const [rows] = await getPool().query(
    `SELECT id, user_phone, image_url, caption, created_at
       FROM community_memories ORDER BY id DESC LIMIT ?`,
    [Math.max(1, Math.min(60, limit))]
  ) as any;
  return rows as CommunityMemory[];
}

// ============================================================================
// User Photo Library (profile thumbnail + avatar-builder photo persistence)
// ============================================================================

export interface UserPhoto {
  id: number;
  image_url: string;
  source: string;
  created_at: string;
}

export async function setProfilePhoto(phone: string, url: string): Promise<void> {
  await getPool().query(`UPDATE users SET profile_photo_url = ? WHERE phone = ?`, [url, phone]);
}

export async function addUserPhoto(phone: string, url: string, source: string = "upload"): Promise<number> {
  const [r] = await getPool().query(
    `INSERT INTO user_photos (user_phone, image_url, source) VALUES (?, ?, ?)`,
    [phone, url, source.slice(0, 32)]
  ) as any;
  return r.insertId;
}

export async function getUserPhotos(phone: string, limit: number = 60): Promise<UserPhoto[]> {
  const [rows] = await getPool().query(
    `SELECT id, image_url, source, created_at FROM user_photos
      WHERE user_phone = ? ORDER BY id DESC LIMIT ?`,
    [phone, Math.max(1, Math.min(200, limit))]
  ) as any;
  return rows as UserPhoto[];
}

/** Delete a photo the user owns. Returns true if a row was removed. */
export async function deleteUserPhoto(id: number, phone: string): Promise<boolean> {
  const [r] = await getPool().query(
    `DELETE FROM user_photos WHERE id = ? AND user_phone = ?`,
    [id, phone]
  ) as any;
  return r.affectedRows === 1;
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
  media_type: 'still' | 'video' | 'model';
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
  model_url: string | null;
  sort_order: number;
  created_at: string;
  pet_name?: string | null;
  pet_breed?: string | null;
}

export async function saveCreation(data: {
  user_phone: string;
  album_id?: number | null;
  media_type: 'still' | 'video' | 'model';
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
  kind: 'still' | 'video' | 'model';
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
  kind: 'still' | 'video' | 'model';
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

/** Restore credits reserved by a failed generation. This is operational recovery,
 * separate from user refund reviews and never accepts user/AI-selected amounts. */
export async function restoreReservedGenerationCredits(phone: string, amount: number): Promise<void> {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Invalid reserved credit amount");
  await getPool().query(
    `UPDATE users SET credits = credits + ? WHERE phone = ?`,
    [amount, phone]
  );
}

/** Refund-review disbursement primitive. Callers must be the refund service's
 * deterministic auto-approve/admin paths; it is not a general route helper. */
export async function refundCredits(phone: string, amount: number): Promise<void> {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Invalid refund amount");
  await getPool().query(`UPDATE users SET credits = credits + ? WHERE phone = ?`, [amount, phone]);
}

export async function setCreationVideoUrl(creationId: number, phone: string, videoUrl: string): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE creations SET video_url = ?, media_type = 'video' WHERE id = ? AND user_phone = ?`,
    [videoUrl, creationId, phone]
  ) as any;
  return result.affectedRows === 1;
}

export async function setCreationModelUrl(creationId: number, phone: string, modelUrl: string): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE creations SET model_url = ?, media_type = 'model' WHERE id = ? AND user_phone = ?`,
    [modelUrl, creationId, phone]
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

/**
 * Atomically increment today's usage count for (user, endpoint) and return the
 * new count. Used to enforce per-user daily caps on the paid AR endpoints
 * (classify/rig/semantic_scan) — see server/paidApiGuards.ts.
 */
export async function bumpDailyUsage(phone: string, endpoint: string): Promise<number> {
  await getPool().query(
    `INSERT INTO api_usage_daily (user_phone, endpoint, day, count)
     VALUES (?, ?, CURDATE(), 1)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    [phone, endpoint]
  );
  const [rows] = await getPool().query(
    `SELECT count FROM api_usage_daily WHERE user_phone = ? AND endpoint = ? AND day = CURDATE()`,
    [phone, endpoint]
  );
  const arr = rows as unknown as { count: string | number }[];
  return arr.length ? Number(arr[0].count) : 0;
}

/** Read today's usage count for (user, endpoint) without incrementing. */
export async function getDailyUsage(phone: string, endpoint: string): Promise<number> {
  const [rows] = await getPool().query(
    `SELECT count FROM api_usage_daily WHERE user_phone = ? AND endpoint = ? AND day = CURDATE()`,
    [phone, endpoint]
  );
  const arr = rows as unknown as { count: string | number }[];
  return arr.length ? Number(arr[0].count) : 0;
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
  rigged_model_url: string | null;
  clips_json: string | null;
  multiview_json: string | null;
  sprite_sheet_url: string | null;
  animation_data: any | null;
  meshy_handle: string | null;
  animal_type: string | null;
  breed: string | null;
  generation_status: 'pending' | 'generating_mesh' | 'rigging' | 'retargeting' | 'baking_clips' | 'baking_sprites' | 'done' | 'failed';
  generation_error: string | null;
  avatar_type: 'dog' | 'human' | 'object';
  generation_analysis: any | null;
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
  meshy_handle: string | null,
  opts?: {
    animal_type?: string;
    breed?: string;
    generation_status?: string;
    avatar_type?: string;
    /** Unified triage record (detection + qualification + anatomy). */
    generation_analysis?: unknown;
  }
): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO avatars (user_phone, name, image_url, meshy_handle, animal_type, breed, generation_status, avatar_type, generation_analysis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      phone,
      name,
      image_url,
      meshy_handle,
      opts?.animal_type || null,
      opts?.breed || null,
      opts?.generation_status || 'pending',
      opts?.avatar_type || 'dog',
      opts?.generation_analysis != null ? JSON.stringify(opts.generation_analysis) : null
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
  // NOTE: Do NOT set generation_status here — the caller manages status
  // transitions via updateAvatarGenerationStatus to avoid a race condition
  // where the frontend sees a premature 'done' before clip baking finishes.
  const [result] = await getPool().query(
    `UPDATE avatars SET model_url = ?, sprite_sheet_url = ?, animation_data = ? WHERE id = ? AND user_phone = ?`,
    [modelUrl, spriteSheetUrl, JSON.stringify(animationData), id, phone]
  ) as any;
  return result.affectedRows === 1;
}

/**
 * Store the rigged skeletal model + clip manifest produced by the Blender
 * pipeline (Phase 5). Consumed by the 3D/AR scene, which prefers this over
 * the plain mesh model_url.
 */
export async function updateAvatarRiggedModel(
  id: number,
  phone: string,
  riggedModelUrl: string,
  clips: { name: string; loop: boolean; durationSec: number }[]
): Promise<boolean> {
  const [result] = (await getPool().query(
    `UPDATE avatars SET rigged_model_url = ?, clips_json = ? WHERE id = ? AND user_phone = ?`,
    [riggedModelUrl, JSON.stringify(clips || []), id, phone]
  )) as any;
  return result.affectedRows === 1;
}

export interface MultiviewSet {
  left?: string;
  back?: string;
  right?: string;
}

/** Persist the generated turnaround view URLs so retry/resume can reuse them. */
export async function updateAvatarMultiview(
  id: number,
  views: MultiviewSet
): Promise<boolean> {
  const [result] = (await getPool().query(
    `UPDATE avatars SET multiview_json = ? WHERE id = ?`,
    [JSON.stringify(views || {}), id]
  )) as any;
  return result.affectedRows === 1;
}

/** Read persisted turnaround views for an avatar, or null if none/invalid. */
export function parseMultiview(raw: unknown): MultiviewSet | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (obj && typeof obj === "object") {
      const out: MultiviewSet = {};
      for (const k of ["left", "back", "right"] as const) {
        if (typeof (obj as any)[k] === "string" && (obj as any)[k]) out[k] = (obj as any)[k];
      }
      return Object.keys(out).length ? out : null;
    }
  } catch { /* ignore */ }
  return null;
}

export async function updateAvatarGenerationStatus(
  id: number,
  status: 'pending' | 'generating_mesh' | 'rigging' | 'retargeting' | 'baking_clips' | 'baking_sprites' | 'done' | 'failed',
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

/**
 * Delete an avatar row (owner-scoped). Removes the DB record only — it does not
 * touch the GLB in object storage. Used to clear a model from the user's roster
 * (and to free a slot under the Phase 9 model cap, or clean up orphaned rows
 * whose storage files were already deleted).
 */
export async function deleteAvatar(id: number, phone: string): Promise<boolean> {
  const [result] = await getPool().query(
    `DELETE FROM avatars WHERE id = ? AND user_phone = ?`,
    [id, phone]
  ) as any;
  return result.affectedRows === 1;
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

/**
 * Living-avatar needs (Phase 2). Returns the stored needs snapshot, or an
 * initial one derived from legacy food/water columns if none has been saved.
 * The CLIENT applies offline decay from `lastSeen`, so this just returns raw state.
 */
export async function getAvatarNeeds(id: number, phone: string): Promise<any | null> {
  const [rows] = await getPool().query(
    `SELECT needs_json, food_level, water_level, last_seen, last_fed FROM avatars WHERE id = ? AND user_phone = ? LIMIT 1`,
    [id, phone]
  );
  const arr = rows as any[];
  if (!arr.length) return null;
  const row = arr[0];
  if (row.needs_json) {
    try {
      return typeof row.needs_json === "string" ? JSON.parse(row.needs_json) : row.needs_json;
    } catch {
      /* fall through to derived defaults */
    }
  }
  const seenSource = row.last_seen || row.last_fed || new Date();
  return {
    food: row.food_level ?? 80,
    water: row.water_level ?? 80,
    energy: 90,
    bladder: 20,
    bowel: 15,
    happiness: 85,
    lastSeen: new Date(seenSource).toISOString(),
  };
}

/** Persist a needs snapshot; keeps legacy food/water columns in sync for old UI. */
export async function saveAvatarNeeds(id: number, phone: string, needs: any): Promise<boolean> {
  const [result] = (await getPool().query(
    `UPDATE avatars SET needs_json = ?, last_seen = CURRENT_TIMESTAMP, food_level = ?, water_level = ? WHERE id = ? AND user_phone = ?`,
    [
      JSON.stringify(needs || {}),
      Math.round(needs?.food ?? 80),
      Math.round(needs?.water ?? 80),
      id,
      phone,
    ]
  )) as any;
  return result.affectedRows === 1;
}

// --- Placed objects (Phase 3) ---------------------------------------------

export interface PlacedObjectRow {
  id: string;
  kind: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  createdAt: string;
}

export async function getPlacedObjects(avatarId: number, phone: string): Promise<PlacedObjectRow[]> {
  const [rows] = await getPool().query(
    `SELECT id, kind, pos_x, pos_y, pos_z, rot_y, scale, created_at
       FROM placed_objects WHERE avatar_id = ? AND user_phone = ? ORDER BY created_at ASC`,
    [avatarId, phone]
  );
  return (rows as any[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    position: [r.pos_x, r.pos_y, r.pos_z],
    rotationY: r.rot_y,
    scale: r.scale,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function addPlacedObject(
  avatarId: number,
  phone: string,
  obj: { id: string; kind: string; position: [number, number, number]; rotationY: number; scale: number }
): Promise<boolean> {
  const [result] = (await getPool().query(
    `INSERT INTO placed_objects (id, avatar_id, user_phone, kind, pos_x, pos_y, pos_z, rot_y, scale)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      obj.id,
      avatarId,
      phone,
      obj.kind,
      obj.position[0],
      obj.position[1],
      obj.position[2],
      obj.rotationY,
      obj.scale,
    ]
  )) as any;
  return result.affectedRows === 1;
}

export async function deletePlacedObject(id: string, phone: string): Promise<boolean> {
  const [result] = (await getPool().query(
    `DELETE FROM placed_objects WHERE id = ? AND user_phone = ?`,
    [id, phone]
  )) as any;
  return result.affectedRows === 1;
}

export interface SceneActorRow {
  id: string;
  sourceAvatarId: number;
  transform: any;
  selectedClip: string | null;
  createdAt: string;
}

export async function getSceneActors(sceneAvatarId: number, phone: string): Promise<SceneActorRow[]> {
  const [rows] = await getPool().query(
    `SELECT id, source_avatar_id, transform_json, selected_clip, created_at
       FROM scene_actors WHERE scene_avatar_id = ? AND owner_phone = ? ORDER BY created_at ASC`,
    [sceneAvatarId, phone]
  );
  return (rows as any[]).map((r) => ({
    id: r.id,
    sourceAvatarId: r.source_avatar_id,
    transform: typeof r.transform_json === "string" ? JSON.parse(r.transform_json) : r.transform_json,
    selectedClip: r.selected_clip,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function addSceneActor(
  sceneAvatarId: number,
  phone: string,
  actor: { id: string; sourceAvatarId: number; transform: any; selectedClip?: string }
): Promise<boolean> {
  const [result] = (await getPool().query(
    `INSERT INTO scene_actors (id, owner_phone, scene_avatar_id, source_avatar_id, transform_json, selected_clip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      actor.id,
      phone,
      sceneAvatarId,
      actor.sourceAvatarId,
      JSON.stringify(actor.transform),
      actor.selectedClip || null,
    ]
  )) as any;
  return result.affectedRows === 1;
}

export async function updateSceneActor(
  actorId: string,
  phone: string,
  transform: any,
  selectedClip?: string
): Promise<boolean> {
  const [result] = (await getPool().query(
    `UPDATE scene_actors SET transform_json = ?, selected_clip = ? WHERE id = ? AND owner_phone = ?`,
    [JSON.stringify(transform), selectedClip || null, actorId, phone]
  )) as any;
  return result.affectedRows === 1;
}

export async function deleteSceneActor(id: string, phone: string): Promise<boolean> {
  const [result] = (await getPool().query(
    `DELETE FROM scene_actors WHERE id = ? AND owner_phone = ?`,
    [id, phone]
  )) as any;
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
  await recordCreditTxn(phone, 5, "daily_bonus");
  return { success: true };
}

export async function claimAchievement(phone: string, id: string): Promise<{success: boolean}> {
  try {
    const user = await findUserByPhone(phone);
    if (!user) throw new Error("User not found");
    
    let achievements: string[] = [];
    if (user.achievements_json) {
      try { achievements = JSON.parse(user.achievements_json); } catch(e) {}
    }
    
    if (achievements.includes(id)) {
      return { success: false }; // Already claimed
    }
    
    achievements.push(id);
    await getPool().query(
      `UPDATE users SET achievements_json = ?, credits = credits + 10 WHERE phone = ?`, 
      [JSON.stringify(achievements), phone]
    );
    return { success: true };
  } catch (err) {
    console.error("Achievement claim error:", err);
    throw err;
  }
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

// --- AR virtual-pet simulator (AR_PET_SIM_SPEC §8, milestone AR2) -----------
// Pets are owned transitively: pet_profiles.avatar_id -> avatars.user_phone.
// Every accessor below takes `phone` and joins avatars so a user can only reach
// their own pets (hardening H3).

export interface PetProfileRow {
  id: number;
  avatar_id: number;
  breed: string | null;
  breed_confidence: number | null;
  size_class: string | null;
  build: any;
  temperament: any;
  personality_weights: any;
  hormones: any;
  drives: any;
  life_stage: "puppy" | "adult" | "senior";
  aging_mode: "off" | "slow" | "realistic";
  mortality_enabled: number;
  trainer_score: number;
  rigged_glb_url: string | null;
  lod_glb_url: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonMaybe(v: any): any {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

/** Return the pet profile for an avatar the user owns, or null. */
export async function getPetProfileByAvatar(
  avatarId: number,
  phone: string
): Promise<PetProfileRow | null> {
  const [rows] = await getPool().query(
    `SELECT p.* FROM pet_profiles p
       JOIN avatars a ON a.id = p.avatar_id
      WHERE p.avatar_id = ? AND a.user_phone = ? LIMIT 1`,
    [avatarId, phone]
  );
  const arr = rows as unknown as PetProfileRow[];
  if (!arr.length) return null;
  const r = arr[0];
  r.build = parseJsonMaybe(r.build);
  r.temperament = parseJsonMaybe(r.temperament);
  r.personality_weights = parseJsonMaybe(r.personality_weights);
  r.hormones = parseJsonMaybe(r.hormones);
  r.drives = parseJsonMaybe(r.drives);
  return r;
}

/** Return a pet profile by its own id, ownership-checked, or null. */
export async function getPetProfileById(
  petId: number,
  phone: string
): Promise<PetProfileRow | null> {
  const [rows] = await getPool().query(
    `SELECT p.* FROM pet_profiles p
       JOIN avatars a ON a.id = p.avatar_id
      WHERE p.id = ? AND a.user_phone = ? LIMIT 1`,
    [petId, phone]
  );
  const arr = rows as unknown as PetProfileRow[];
  if (!arr.length) return null;
  const r = arr[0];
  r.build = parseJsonMaybe(r.build);
  r.temperament = parseJsonMaybe(r.temperament);
  r.personality_weights = parseJsonMaybe(r.personality_weights);
  r.hormones = parseJsonMaybe(r.hormones);
  r.drives = parseJsonMaybe(r.drives);
  return r;
}

export interface PetProfileInput {
  breed?: string | null;
  breed_confidence?: number | null;
  size_class?: string | null;
  build?: any;
  temperament?: any;
  personality_weights?: any;
  hormones?: any;
  drives?: any;
}

/**
 * Create or update the pet profile for an avatar (one profile per avatar).
 * Ownership is enforced up-front. Returns the stored row, or null if the avatar
 * isn't owned by `phone`.
 */
export async function upsertPetProfile(
  avatarId: number,
  phone: string,
  data: PetProfileInput
): Promise<PetProfileRow | null> {
  const owned = await getAvatarById(avatarId, phone);
  if (!owned) return null;
  await getPool().query(
    `INSERT INTO pet_profiles
       (avatar_id, breed, breed_confidence, size_class, build, temperament, personality_weights, hormones, drives)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       breed = VALUES(breed),
       breed_confidence = VALUES(breed_confidence),
       size_class = VALUES(size_class),
       build = VALUES(build),
       temperament = VALUES(temperament),
       personality_weights = COALESCE(VALUES(personality_weights), personality_weights),
       hormones = COALESCE(VALUES(hormones), hormones),
       drives = COALESCE(VALUES(drives), drives)`,
    [
      avatarId,
      data.breed ?? null,
      data.breed_confidence ?? null,
      data.size_class ?? null,
      data.build != null ? JSON.stringify(data.build) : null,
      data.temperament != null ? JSON.stringify(data.temperament) : null,
      data.personality_weights != null ? JSON.stringify(data.personality_weights) : null,
      data.hormones != null ? JSON.stringify(data.hormones) : null,
      data.drives != null ? JSON.stringify(data.drives) : null,
    ]
  );
  return getPetProfileByAvatar(avatarId, phone);
}

// --- AR8: progression + settings (§4.6–4.7 / §7.4) -------------------------

/** Add to a pet's trainer score; returns the new score, or null if not owned. */
export async function incrementTrainerScore(
  petId: number,
  phone: string,
  points: number
): Promise<number | null> {
  const [result] = (await getPool().query(
    `UPDATE pet_profiles p JOIN avatars a ON a.id = p.avatar_id
        SET p.trainer_score = p.trainer_score + ?
      WHERE p.id = ? AND a.user_phone = ?`,
    [Math.max(0, Math.round(points)), petId, phone]
  )) as any;
  if (result.affectedRows < 1) return null;
  const prof = await getPetProfileById(petId, phone);
  return prof ? prof.trainer_score : null;
}

/** Update aging/mortality settings (ownership-checked). */
export async function updatePetSettings(
  petId: number,
  phone: string,
  settings: { aging_mode?: string; mortality_enabled?: boolean; life_stage?: string }
): Promise<boolean> {
  const [result] = (await getPool().query(
    `UPDATE pet_profiles p JOIN avatars a ON a.id = p.avatar_id
        SET p.aging_mode = COALESCE(?, p.aging_mode),
            p.mortality_enabled = COALESCE(?, p.mortality_enabled),
            p.life_stage = COALESCE(?, p.life_stage)
      WHERE p.id = ? AND a.user_phone = ?`,
    [
      settings.aging_mode ?? null,
      settings.mortality_enabled == null ? null : settings.mortality_enabled ? 1 : 0,
      settings.life_stage ?? null,
      petId,
      phone,
    ]
  )) as any;
  return result.affectedRows >= 1;
}

// --- AR7: voice commands + spatial buttons (§7.2–7.3) ----------------------

/** List a pet's learned voice commands (ownership-checked). */
export async function getPetCommands(petId: number, phone: string): Promise<any[]> {
  const [rows] = await getPool().query(
    `SELECT c.* FROM pet_commands c
       JOIN pet_profiles p ON p.id = c.pet_id
       JOIN avatars a ON a.id = p.avatar_id
      WHERE c.pet_id = ? AND a.user_phone = ? ORDER BY c.created_at ASC`,
    [petId, phone]
  );
  return (rows as any[]).map((r) => ({
    ...r,
    metaphone_keys: typeof r.metaphone_keys === "string" ? JSON.parse(r.metaphone_keys) : r.metaphone_keys,
  }));
}

/** Add a learned command. Caller must have verified ownership of `petId`. */
export async function addPetCommand(
  petId: number,
  data: { phrase: string; metaphone_keys: string[]; action: string; compliance?: number }
): Promise<number> {
  const [result] = (await getPool().query(
    `INSERT INTO pet_commands (pet_id, phrase, metaphone_keys, action, compliance, last_reinforced)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [petId, data.phrase, JSON.stringify(data.metaphone_keys || []), data.action, data.compliance ?? 0.5]
  )) as any;
  return result.insertId;
}

/** Update a command's compliance + last_reinforced (reinforcement / forgetting sync). */
export async function setCommandCompliance(
  commandId: number,
  compliance: number
): Promise<void> {
  await getPool().query(
    `UPDATE pet_commands SET compliance = ?, last_reinforced = CURRENT_TIMESTAMP WHERE id = ?`,
    [compliance, commandId]
  );
}

/** List a pet's spatial buttons (ownership-checked). */
export async function getPetButtons(petId: number, phone: string): Promise<any[]> {
  const [rows] = await getPool().query(
    `SELECT b.* FROM pet_buttons b
       JOIN pet_profiles p ON p.id = b.pet_id
       JOIN avatars a ON a.id = p.avatar_id
      WHERE b.pet_id = ? AND a.user_phone = ? ORDER BY b.created_at ASC`,
    [petId, phone]
  );
  return (rows as any[]).map((r) => ({
    ...r,
    anchor: typeof r.anchor === "string" ? JSON.parse(r.anchor) : r.anchor,
  }));
}

/** Add a spatial button. Caller must have verified ownership of `petId`. */
export async function addPetButton(
  petId: number,
  data: { label: string; audio_url: string; linked_action?: string | null; anchor: any }
): Promise<number> {
  const [result] = (await getPool().query(
    `INSERT INTO pet_buttons (pet_id, label, audio_url, linked_action, anchor)
     VALUES (?, ?, ?, ?, ?)`,
    [petId, data.label, data.audio_url, data.linked_action ?? null, JSON.stringify(data.anchor || {})]
  )) as any;
  return result.insertId;
}

/** Cached semantic scan for an anchor (AR6, §6.4). Returns zones JSON or null. */
export async function getSemanticScan(
  userPhone: string,
  anchorHash: string
): Promise<any | null> {
  const [rows] = await getPool().query(
    `SELECT zones FROM semantic_scans WHERE user_phone = ? AND anchor_hash = ?
      ORDER BY created_at DESC LIMIT 1`,
    [userPhone, anchorHash]
  );
  const arr = rows as any[];
  if (!arr.length) return null;
  const z = arr[0].zones;
  return typeof z === "string" ? JSON.parse(z) : z;
}

/** Persist a semantic scan for an anchor (AR6). */
export async function saveSemanticScan(
  userPhone: string,
  anchorHash: string,
  zones: any
): Promise<void> {
  await getPool().query(
    `INSERT INTO semantic_scans (user_phone, anchor_hash, zones) VALUES (?, ?, ?)`,
    [userPhone, anchorHash, JSON.stringify(zones ?? {})]
  );
}

/** Persist rigged + LOD GLB URLs on a pet. Ownership-checked. (AR3) */
export async function savePetRigUrls(
  petId: number,
  phone: string,
  urls: { rigged_glb_url?: string | null; lod_glb_url?: string | null }
): Promise<boolean> {
  const [result] = (await getPool().query(
    `UPDATE pet_profiles p
       JOIN avatars a ON a.id = p.avatar_id
        SET p.rigged_glb_url = COALESCE(?, p.rigged_glb_url),
            p.lod_glb_url = COALESCE(?, p.lod_glb_url)
      WHERE p.id = ? AND a.user_phone = ?`,
    [urls.rigged_glb_url ?? null, urls.lod_glb_url ?? null, petId, phone]
  )) as any;
  return result.affectedRows >= 1;
}

/** Persist drives/hormones/weights + trainer score for a pet. Ownership-checked. */
export async function savePetState(
  petId: number,
  phone: string,
  state: {
    drives?: any;
    hormones?: any;
    personality_weights?: any;
    trainer_score?: number;
  }
): Promise<boolean> {
  const [result] = (await getPool().query(
    `UPDATE pet_profiles p
       JOIN avatars a ON a.id = p.avatar_id
        SET p.drives = COALESCE(?, p.drives),
            p.hormones = COALESCE(?, p.hormones),
            p.personality_weights = COALESCE(?, p.personality_weights),
            p.trainer_score = COALESCE(?, p.trainer_score)
      WHERE p.id = ? AND a.user_phone = ?`,
    [
      state.drives != null ? JSON.stringify(state.drives) : null,
      state.hormones != null ? JSON.stringify(state.hormones) : null,
      state.personality_weights != null ? JSON.stringify(state.personality_weights) : null,
      state.trainer_score ?? null,
      petId,
      phone,
    ]
  )) as any;
  return result.affectedRows >= 1;
}

// ============================================================================
// Phase 8: Storage accounting
// ============================================================================

const FREE_HOT_BYTES = 50 * 1024 * 1024;
const COLD_GB_COST_CR = 4;

export interface StorageUsage {
  bytesHot: number;
  bytesCold: number;
  freeLimit: number;
  coldGbPurchased: number;
  coldLimit: number;
}

/** Get the user's current storage usage, creating a row if none exists. */
export async function getStorageUsage(phone: string): Promise<StorageUsage> {
  await getPool().query(
    `INSERT IGNORE INTO user_storage (user_phone, bytes_hot, bytes_cold, cold_gb_purchased) VALUES (?, 0, 0, 0)`,
    [phone]
  );
  const [rows] = await getPool().query(
    `SELECT bytes_hot, bytes_cold, cold_gb_purchased FROM user_storage WHERE user_phone = ?`,
    [phone]
  ) as any;
  const row = rows?.[0] || { bytes_hot: 0, bytes_cold: 0, cold_gb_purchased: 0 };
  return {
    bytesHot: Number(row.bytes_hot) || 0,
    bytesCold: Number(row.bytes_cold) || 0,
    freeLimit: FREE_HOT_BYTES,
    coldGbPurchased: Number(row.cold_gb_purchased) || 0,
    coldLimit: (Number(row.cold_gb_purchased) || 0) * (1024 * 1024 * 1024),
  };
}

/** Record that N bytes were added to hot storage. Returns the updated usage. */
export async function recordStorageAddHot(phone: string, bytes: number): Promise<StorageUsage> {
  await getPool().query(
    `INSERT INTO user_storage (user_phone, bytes_hot) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE bytes_hot = bytes_hot + ?`,
    [phone, bytes, bytes]
  );
  return getStorageUsage(phone);
}

/** Record that N bytes were freed from hot storage. */
export async function recordStorageRemoveHot(phone: string, bytes: number): Promise<void> {
  await getPool().query(
    `UPDATE user_storage SET bytes_hot = GREATEST(0, bytes_hot - ?) WHERE user_phone = ?`,
    [bytes, phone]
  );
}

/** Move bytes from hot to cold tier. */
export async function recordStorageMoveToCold(phone: string, bytes: number): Promise<void> {
  await getPool().query(
    `UPDATE user_storage SET bytes_hot = GREATEST(0, bytes_hot - ?), bytes_cold = bytes_cold + ? WHERE user_phone = ?`,
    [bytes, bytes, phone]
  );
}

/** Deduct 4 credits and grant 1 GB of cold storage. Idempotent per requestId. */
export async function purchaseColdStorage(phone: string, requestId: string): Promise<{ success: boolean; error?: string }> {
  const [existing] = await getPool().query(
    `SELECT 1 FROM credit_transactions WHERE reason = ? LIMIT 1`,
    [`storage_purchase:${requestId}`]
  ) as any;
  if (Array.isArray(existing) && existing.length > 0) {
    return { success: true };
  }
  const ok = await deductCredits(phone, COLD_GB_COST_CR, `storage_purchase:${requestId}`);
  if (!ok) {
    return { success: false, error: `Insufficient credits. You need ${COLD_GB_COST_CR} credits for 1 GB of cold storage.` };
  }
  await getPool().query(
    `INSERT INTO user_storage (user_phone, cold_gb_purchased) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE cold_gb_purchased = cold_gb_purchased + 1`,
    [phone]
  );
  return { success: true };
}

// ============================================================================
// Phase 9: Voice clone assets
// ============================================================================

export interface VoiceCloneAsset {
  id: number;
  user_phone: string;
  name: string;
  audio_url: string;
  mime_type: string;
  bytes: number;
  voice_consent: number;
  voice_consent_at: string | null;
  created_at: string;
}

export async function createVoiceCloneAsset(
  phone: string,
  input: { name: string; audioUrl: string; mimeType: string; bytes: number; voiceConsent: true }
): Promise<VoiceCloneAsset> {
  const [result] = await getPool().query(
    `INSERT INTO voice_clone_assets
       (user_phone, name, audio_url, mime_type, bytes, voice_consent, voice_consent_at)
     VALUES (?, ?, ?, ?, ?, 1, NOW())`,
    [phone, input.name.slice(0, 120), input.audioUrl, input.mimeType.slice(0, 80), Math.max(0, input.bytes)]
  ) as any;
  const [rows] = await getPool().query(
    `SELECT * FROM voice_clone_assets WHERE id = ? AND user_phone = ? LIMIT 1`,
    [result.insertId, phone]
  ) as any;
  return rows[0] as VoiceCloneAsset;
}

export async function listVoiceCloneAssets(phone: string): Promise<VoiceCloneAsset[]> {
  const [rows] = await getPool().query(
    `SELECT * FROM voice_clone_assets WHERE user_phone = ? ORDER BY id DESC`,
    [phone]
  ) as any;
  return rows as VoiceCloneAsset[];
}

// ============================================================================
// Phase 8: Pawprint token primitives
// ============================================================================

/** Record a pawprint token transaction. */
async function recordPawprintTxn(phone: string, delta: number, reason: string): Promise<void> {
  try {
    const [rows] = await getPool().query(
      `SELECT pawprint_tokens FROM users WHERE phone = ?`, [phone]
    ) as any;
    const balance = rows?.[0]?.pawprint_tokens || 0;
    await getPool().query(
      `INSERT INTO pawprint_history (user_phone, delta, reason, balance_after) VALUES (?, ?, ?, ?)`,
      [phone, delta, reason.slice(0, 80), balance]
    );
  } catch (err) {
    console.warn("[pawprint ledger] failed to record:", (err as any)?.message || err);
  }
}

/** Grant pawprint tokens. Server-authoritative, fixed amounts only. */
export async function grantPawprintTokens(phone: string, amount: number, reason: string): Promise<void> {
  if (!Number.isInteger(amount) || amount === 0) throw new Error("Invalid pawprint token amount");
  if (amount < 0) {
    const [result] = await getPool().query(
      `UPDATE users SET pawprint_tokens = pawprint_tokens + ? WHERE phone = ? AND pawprint_tokens >= ?`,
      [amount, phone, Math.abs(amount)]
    ) as any;
    if (result.affectedRows !== 1) throw new Error("Insufficient pawprint tokens");
  } else {
    await getPool().query(
      `UPDATE users SET pawprint_tokens = pawprint_tokens + ? WHERE phone = ?`,
      [amount, phone]
    );
  }
  await recordPawprintTxn(phone, amount, reason);
}

/** Deduct pawprint tokens if sufficient. */
export async function spendPawprintTokens(phone: string, amount: number, reason: string): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE users SET pawprint_tokens = pawprint_tokens - ? WHERE phone = ? AND pawprint_tokens >= ?`,
    [Math.abs(amount), phone, Math.abs(amount)]
  ) as any;
  if (result.affectedRows === 1) {
    await recordPawprintTxn(phone, -Math.abs(amount), reason);
  }
  return result.affectedRows === 1;
}

/** Get pawprint token balance. */
export async function getPawprintBalance(phone: string): Promise<number> {
  const [rows] = await getPool().query(
    `SELECT pawprint_tokens FROM users WHERE phone = ?`, [phone]
  ) as any;
  return rows?.[0]?.pawprint_tokens || 0;
}

// ============================================================================
// Phase 8: Profile
// ============================================================================

export async function updateUserProfile(phone: string, fields: {
  fullName?: string;
  bio?: string | null;
  city?: string;
  zip?: string;
  notificationPrefs?: any;
}): Promise<void> {
  const parts: string[] = [];
  const values: any[] = [];
  if (fields.fullName !== undefined) { parts.push("full_name = ?"); values.push(fields.fullName); }
  if (fields.bio !== undefined) { parts.push("bio = ?"); values.push(fields.bio); }
  if (fields.city !== undefined) { parts.push("city = ?"); values.push(fields.city); }
  if (fields.zip !== undefined) { parts.push("zip = ?"); values.push(fields.zip); }
  if (fields.notificationPrefs !== undefined) { parts.push("notification_prefs = ?"); values.push(JSON.stringify(fields.notificationPrefs)); }
  if (parts.length === 0) return;
  values.push(phone);
  await getPool().query(`UPDATE users SET ${parts.join(", ")} WHERE phone = ?`, values);
}

/** Check if profile completion conditions are met and grant the 100-cr bonus. */
export async function checkAndGrantProfileBonus(phone: string): Promise<{ granted: boolean }> {
  const [rows] = await getPool().query(
    `SELECT profile_bonus_granted, email_verified, phone_verified, zip FROM users WHERE phone = ?`,
    [phone]
  ) as any;
  const row = rows?.[0];
  if (!row) return { granted: false };
  if (row.profile_bonus_granted) return { granted: false };
  if (row.zip && row.email_verified && row.phone_verified) {
    await addCredits(phone, 100, "profile_complete_bonus");
    await getPool().query(`UPDATE users SET profile_bonus_granted = 1 WHERE phone = ?`, [phone]);
    return { granted: true };
  }
  return { granted: false };
}

export async function verifyUserEmail(phone: string): Promise<void> {
  await getPool().query(`UPDATE users SET email_verified = 1 WHERE phone = ?`, [phone]);
}

export async function verifyUserPhone(phone: string): Promise<void> {
  await getPool().query(`UPDATE users SET phone_verified = 1 WHERE phone = ?`, [phone]);
}

// ============================================================================
// Phase 8: Referral
// ============================================================================

import { randomBytes } from "crypto";

export async function generateReferralCode(phone: string): Promise<string> {
  const [rows] = await getPool().query(`SELECT referral_code FROM users WHERE phone = ?`, [phone]) as any;
  if (rows?.[0]?.referral_code) return rows[0].referral_code;
  let code: string;
  let isUnique = false;
  do {
    code = randomBytes(4).toString("hex").slice(0, 8);
    const [existing] = await getPool().query(`SELECT 1 FROM users WHERE referral_code = ?`, [code]) as any;
    isUnique = !(Array.isArray(existing) && existing.length > 0);
  } while (!isUnique);
  await getPool().query(`UPDATE users SET referral_code = ? WHERE phone = ?`, [code, phone]);
  return code;
}

export async function recordReferral(referrerCode: string, referredPhone: string): Promise<void> {
  const [refs] = await getPool().query(`SELECT phone FROM users WHERE referral_code = ?`, [referrerCode]) as any;
  if (!refs?.[0]) return;
  const referrerPhone = refs[0].phone;
  if (referrerPhone === referredPhone) return;
  try {
    await getPool().query(
      `INSERT INTO referrals (referrer_phone, referred_phone, code) VALUES (?, ?, ?)`,
      [referrerPhone, referredPhone, referrerCode]
    );
  } catch { /* duplicate */ }
}

export async function creditReferralIfComplete(referredPhone: string): Promise<void> {
  const [rows] = await getPool().query(
    `SELECT r.id, r.referrer_phone, r.credited_at
       FROM referrals r JOIN users u ON u.phone = r.referred_phone
      WHERE r.referred_phone = ? AND u.profile_complete = 1 AND r.credited_at IS NULL
      LIMIT 1`,
    [referredPhone]
  ) as any;
  const ref = rows?.[0];
  if (!ref) return;
  await addCredits(ref.referrer_phone, 30, "referral_bonus");
  await grantPawprintTokens(ref.referrer_phone, 1, "referral_bonus");
  await getPool().query(`UPDATE referrals SET credited_at = NOW() WHERE id = ?`, [ref.id]);
}

// ============================================================================
// Phase 8: Pawprint templates
// ============================================================================

export interface PawprintTemplate {
  category: string; layoutId: string; name: string; tone: string;
  sampleCopy: string[];
  fieldSchema: { key: string; type: "text" | "image" | "name" | "message"; label: string; maxLength?: number }[];
  imagePromptTemplate: string;
}

const PAWPRINT_CATEGORIES = [
  "grieving_loss", "new_puppy", "veterinarian", "holiday_birthday",
  "environment", "postcard_travel", "get_well", "miss_you", "pet_business",
];

const PAWPRINT_TEMPLATES: PawprintTemplate[] = [
  { category: "grieving_loss", layoutId: "portrait_card", name: "Portrait Card", tone: "gentle", sampleCopy: ["Forever in our hearts.", "Until we meet again at the Rainbow Bridge."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "petName", type: "name", label: "Pet Name" }], imagePromptTemplate: "A soft watercolor-style memorial portrait of a pet, gentle warm lighting" },
  { category: "grieving_loss", layoutId: "landscape_postcard", name: "Landscape Postcard", tone: "gentle", sampleCopy: ["You left pawprints on our hearts.", "Run free, sweet friend."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "message", type: "message", label: "Your Message", maxLength: 200 }], imagePromptTemplate: "A peaceful meadow scene with a rainbow, soft golden hour" },
  { category: "grieving_loss", layoutId: "photo_top", name: "Photo Top", tone: "warm", sampleCopy: ["Remembering the good times.", "A life well loved."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "petName", type: "name", label: "Pet Name" }], imagePromptTemplate: "A warm-toned photo frame with a sleeping pet, surrounded by soft flowers" },
  { category: "grieving_loss", layoutId: "framed_quote", name: "Framed Quote", tone: "gentle", sampleCopy: ["\"Dogs' lives are too short. Their only fault, really.\" — Agnes Sligh Turnbull", "Gone but never forgotten."], fieldSchema: [{ key: "petName", type: "name", label: "Pet Name" }, { key: "message", type: "message", label: "Your Quote", maxLength: 300 }], imagePromptTemplate: "An elegant framed calligraphy quote with subtle pawprint watermark" },
  { category: "new_puppy", layoutId: "portrait_card", name: "Portrait Card", tone: "excited", sampleCopy: ["Welcome home, little one!", "Our newest family member."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Puppy Photo" }, { key: "petName", type: "name", label: "Puppy Name" }], imagePromptTemplate: "A cute puppy portrait with bright playful colors, confetti" },
  { category: "new_puppy", layoutId: "landscape_postcard", name: "Landscape Postcard", tone: "excited", sampleCopy: ["Pawsitively thrilled to meet you!", "A new chapter begins."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Puppy Photo" }, { key: "message", type: "message", label: "Your Message", maxLength: 200 }], imagePromptTemplate: "A puppy playing in a sunny garden, vibrant colors" },
  { category: "new_puppy", layoutId: "photo_top", name: "Photo Top", tone: "playful", sampleCopy: ["Life just got cuter!", "New best friend alert!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Puppy Photo" }], imagePromptTemplate: "A puppy with a big smile, surrounded by toys and treats" },
  { category: "new_puppy", layoutId: "framed_quote", name: "Framed Quote", tone: "warm", sampleCopy: ["\"A puppy is the only thing that loves you more than you love yourself.\"", "Small paws, big love."], fieldSchema: [{ key: "petName", type: "name", label: "Puppy Name" }, { key: "message", type: "message", label: "Your Message", maxLength: 200 }], imagePromptTemplate: "A decorative border with puppy pawprints and hearts, warm pastel background" },
  { category: "veterinarian", layoutId: "portrait_card", name: "Portrait Card", tone: "grateful", sampleCopy: ["Thanks for taking such good care of our fur baby!", "You're pawsome!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "petName", type: "name", label: "Pet Name" }], imagePromptTemplate: "A professional warm-toned thank you card with a pet portrait" },
  { category: "veterinarian", layoutId: "landscape_postcard", name: "Landscape Postcard", tone: "grateful", sampleCopy: ["Our furry friend says thank you!", "Grateful for your care."], fieldSchema: [{ key: "message", type: "message", label: "Your Message", maxLength: 300 }], imagePromptTemplate: "A cozy vet clinic with a happy pet on an exam table" },
  { category: "veterinarian", layoutId: "photo_top", name: "Photo Top", tone: "cheerful", sampleCopy: ["Healthy and happy, thanks to you!", "Best vet ever!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }], imagePromptTemplate: "A cheerful pet at the vet, bright clinic lighting" },
  { category: "veterinarian", layoutId: "framed_quote", name: "Framed Quote", tone: "warm", sampleCopy: ["\"The vet is the true hero of every pet's story.\"", "Thank you for your gentle hands."], fieldSchema: [{ key: "petName", type: "name", label: "Pet Name" }, { key: "message", type: "message", label: "Your Message", maxLength: 200 }], imagePromptTemplate: "A stethoscope heart shape with pawprints, clean medical aesthetic" },
  { category: "holiday_birthday", layoutId: "portrait_card", name: "Portrait Card", tone: "festive", sampleCopy: ["Happy Birthday, fur baby!", "Wishing you a tail-wagging celebration!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "petName", type: "name", label: "Pet Name" }], imagePromptTemplate: "A birthday celebration scene with party hats and balloons" },
  { category: "holiday_birthday", layoutId: "landscape_postcard", name: "Landscape Postcard", tone: "festive", sampleCopy: ["Merry Christmas from our pack to yours!", "Happy Howl-oween!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "message", type: "message", label: "Your Holiday Message", maxLength: 200 }], imagePromptTemplate: "Seasonal holiday background with pets and decorations" },
  { category: "environment", layoutId: "portrait_card", name: "Portrait Card", tone: "eco_conscious", sampleCopy: ["Love nature, love pets.", "Green paws for a greener planet."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }], imagePromptTemplate: "A pet in a lush natural setting, eco-friendly aesthetic" },
  { category: "postcard_travel", layoutId: "landscape_postcard", name: "Landscape Postcard", tone: "adventurous", sampleCopy: ["Wish you were here!", "Paws on the go!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "petName", type: "name", label: "Pet Name" }, { key: "message", type: "message", label: "Travel Message", maxLength: 200 }], imagePromptTemplate: "A scenic travel destination with a happy pet exploring" },
  { category: "get_well", layoutId: "portrait_card", name: "Portrait Card", tone: "caring", sampleCopy: ["Get well soon, sweet one!", "Sending healing vibes!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "petName", type: "name", label: "Pet Name" }], imagePromptTemplate: "A comforting scene with soft blankets and gentle healing light" },
  { category: "miss_you", layoutId: "portrait_card", name: "Portrait Card", tone: "nostalgic", sampleCopy: ["Missing you from my paws to my heart.", "Wish you were here!"], fieldSchema: [{ key: "petPhoto", type: "image", label: "Pet Photo" }, { key: "message", type: "message", label: "Your Message", maxLength: 200 }], imagePromptTemplate: "A nostalgic sunset with a silhouette of a pet looking into the distance" },
  { category: "pet_business", layoutId: "portrait_card", name: "Portrait Card", tone: "professional", sampleCopy: ["Trust us with your fur babies!", "Pawsitively the best care in town."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Business Logo" }, { key: "message", type: "message", label: "Business Message", maxLength: 300 }], imagePromptTemplate: "Professional pet business branding, clean modern aesthetic" },
  { category: "pet_business", layoutId: "landscape_postcard", name: "Landscape Postcard", tone: "friendly", sampleCopy: ["Your pet's home away from home.", "Pet-sitting with love."], fieldSchema: [{ key: "petPhoto", type: "image", label: "Business Photo" }, { key: "message", type: "message", label: "Offer Details", maxLength: 300 }], imagePromptTemplate: "A welcoming pet care facility with happy animals" },
];

export function getPawprintCategories(): string[] { return PAWPRINT_CATEGORIES; }

export function getPawprintTemplatesSync(category?: string): PawprintTemplate[] {
  if (category) return PAWPRINT_TEMPLATES.filter(t => t.category === category);
  return PAWPRINT_TEMPLATES;
}
