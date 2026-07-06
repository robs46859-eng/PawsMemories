-- Migration 003: dm_turns
-- Turn-level conversation history (§5.7 of X_DM_REFINEMENT_SPEC.md)
CREATE TABLE IF NOT EXISTS dm_turns (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT REFERENCES dm_sessions(id),
  role ENUM('user','assistant','system'),
  content TEXT,
  render_url TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;