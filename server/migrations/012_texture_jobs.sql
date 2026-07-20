-- 012_texture_jobs.sql
-- UV_TEXTURE_GENERATION_PLAN.md UV6-minimal: job records for texture re-bakes
-- (UV8, likeness repair from the user's approved multiview reference images).
--
-- The result is a NEW GLB registered alongside the avatar — rebaked_model_url
-- lives here, never overwriting avatars.model_url (plan rule: the original is
-- always recoverable).
--
-- Mirrored by guarded idempotent DDL in db.ts (initDb).

CREATE TABLE IF NOT EXISTS texture_jobs (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  user_phone        VARCHAR(32)  NOT NULL,
  avatar_id         INT          NOT NULL,
  job_type          ENUM('rebake') NOT NULL DEFAULT 'rebake',
  status            ENUM('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
  source_model_url  TEXT         NOT NULL,
  result_model_url  TEXT         NULL,
  stats_json        JSON         NULL,
  error             VARCHAR(400) NULL,
  idempotency_key   VARCHAR(128) NOT NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_texture_idem (user_phone, idempotency_key),
  INDEX idx_texture_user (user_phone, created_at),
  INDEX idx_texture_avatar (avatar_id),
  CONSTRAINT fk_texture_user FOREIGN KEY (user_phone)
    REFERENCES users(phone) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
