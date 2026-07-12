-- Migration 004: AI-advisory refund reviews.
CREATE TABLE IF NOT EXISTS refund_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_phone VARCHAR(32) NOT NULL,
  creation_id BIGINT NULL,
  avatar_id BIGINT NULL,
  cost_credits INT NOT NULL,
  match_score INT NULL,
  ai_verdict JSON NULL,
  reason_code ENUM('a_style','b_anatomy','c_uncanny','d_prompt','e_other') NULL,
  feedback_text TEXT NULL,
  outcome ENUM('pending','free_retry','manual_review','approved','denied') NOT NULL DEFAULT 'pending',
  recommended_credits INT NOT NULL DEFAULT 0,
  refunded INT NOT NULL DEFAULT 0,
  approved_by VARCHAR(32) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  UNIQUE KEY uniq_creation (user_phone, creation_id),
  INDEX idx_refund_rate (user_phone, refunded, approved_by, resolved_at),
  INDEX idx_refund_queue (outcome, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS generator_adjustments (
  style_key VARCHAR(120) NOT NULL PRIMARY KEY,
  reason_counts JSON NOT NULL,
  average_match_score DECIMAL(5,2) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
