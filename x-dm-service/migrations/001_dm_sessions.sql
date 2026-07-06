-- Migration 001: dm_sessions
-- Conversation state machine (§5.7 of X_DM_REFINEMENT_SPEC.md)
CREATE TABLE IF NOT EXISTS dm_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  dm_conversation_id VARCHAR(64) UNIQUE NOT NULL,
  x_user_id VARCHAR(32) NOT NULL,
  x_username VARCHAR(64),
  app_user_id BIGINT NULL,
  state ENUM('IDLE','DRAFTING','REFINING','FINALIZING') DEFAULT 'IDLE',
  base_prompt TEXT,
  effective_prompt TEXT,
  tripo_task_id VARCHAR(128),
  current_render_url TEXT,
  current_model_url TEXT,
  revision INT DEFAULT 0,
  credits_charged INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;