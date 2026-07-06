-- Migration 005: x_oauth_tokens
-- Persisted OAuth 2.0 tokens for the bot account (§4.1 of X_DM_REFINEMENT_SPEC.md)
-- Tokens are auto-refreshed and always updated in DB before env is written.
CREATE TABLE IF NOT EXISTS x_oauth_tokens (
  id INT PRIMARY KEY DEFAULT 1,
  user_id VARCHAR(32) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at DATETIME NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT single_bot_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;