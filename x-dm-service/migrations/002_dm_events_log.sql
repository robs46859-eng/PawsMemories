-- Migration 002: dm_events_log
-- Deduplicated DM event log (§5.7 of X_DM_REFINEMENT_SPEC.md)
CREATE TABLE IF NOT EXISTS dm_events_log (
  event_id VARCHAR(64) PRIMARY KEY,
  dm_conversation_id VARCHAR(64),
  sender_id VARCHAR(32),
  event_type VARCHAR(32),
  text TEXT,
  media_keys JSON,
  raw JSON,
  received_via ENUM('webhook','poll'),
  created_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;