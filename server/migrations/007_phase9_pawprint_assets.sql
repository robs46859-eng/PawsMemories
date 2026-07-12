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
