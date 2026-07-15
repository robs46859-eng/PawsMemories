-- Hermes relay jobs use local UUIDs. bridge_job_id is private server-only state.
CREATE TABLE IF NOT EXISTS hermes_jobs (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  owner_key       VARCHAR(32)  NOT NULL,
  bridge_job_id   VARCHAR(255) NULL,
  job_type        ENUM('translate','knowledge') NOT NULL,
  request_json    JSON         NULL,
  status          VARCHAR(32)  NOT NULL,
  result_json     JSON         NULL,
  error           VARCHAR(255) NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_hermes_bridge_job (bridge_job_id),
  INDEX idx_hermes_owner_created (owner_key, created_at),
  INDEX idx_hermes_status (status),
  CONSTRAINT fk_hermes_owner FOREIGN KEY (owner_key) REFERENCES users(phone) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hermes_rate_limits (
  scope         VARCHAR(16)  NOT NULL,
  dimension     ENUM('user','ip') NOT NULL,
  key_hash      CHAR(64)     NOT NULL,
  window_start  BIGINT       NOT NULL,
  count         INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (scope, dimension, key_hash, window_start),
  INDEX idx_hermes_rate_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
