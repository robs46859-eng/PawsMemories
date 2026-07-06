-- Migration 006: x_kv_store
-- Key-value persistence for webhook_id, subscription_ids, last_seen_event_id, etc.
CREATE TABLE IF NOT EXISTS x_kv_store (
  `key` VARCHAR(128) PRIMARY KEY,
  `value` TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;