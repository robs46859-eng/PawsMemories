-- Migration 004: aesthetic_keywords
-- Trending aesthetic keyword library (§6.2 of X_DM_REFINEMENT_SPEC.md)
CREATE TABLE IF NOT EXISTS aesthetic_keywords (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  keyword VARCHAR(120) UNIQUE,
  category ENUM('material','style','lighting','palette','mood','technique'),
  prompt_fragment TEXT,
  score DOUBLE DEFAULT 0,
  velocity DOUBLE DEFAULT 0,
  sample_tweet_ids JSON,
  first_seen DATE,
  last_seen DATE,
  status ENUM('active','curated','banned') DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;