-- Hermes relay jobs use local UUIDs. bridge_job_id is private server-only state.
CREATE TABLE IF NOT EXISTS hermes_jobs (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  owner_key       VARCHAR(32)  NOT NULL,
  bridge_job_id   VARCHAR(255) NULL,
  job_type        ENUM('translate','knowledge','looks') NOT NULL,
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
