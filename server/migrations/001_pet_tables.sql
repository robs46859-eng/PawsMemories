-- AR_PET_SIM_SPEC §8 — pet data model (main app MySQL DB).
-- TODO(AR2): apply via the existing migration runner; verify FK to `avatars`.

CREATE TABLE pet_profiles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  avatar_id BIGINT NOT NULL,             -- FK existing avatars
  breed VARCHAR(64), breed_confidence DOUBLE, size_class VARCHAR(16),
  build JSON, temperament JSON,          -- §3.2 outputs
  personality_weights JSON,              -- w_a per action (§4.5)
  hormones JSON, drives JSON,            -- persisted state
  life_stage ENUM('puppy','adult','senior') DEFAULT 'adult',
  aging_mode ENUM('off','slow','realistic') DEFAULT 'off',
  mortality_enabled TINYINT DEFAULT 0,
  trainer_score INT DEFAULT 0,
  rigged_glb_url TEXT, lod_glb_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE pet_commands (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pet_id BIGINT, phrase VARCHAR(120), metaphone_keys JSON,
  action VARCHAR(48), compliance DOUBLE DEFAULT 0.5,
  last_reinforced DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pet_buttons (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pet_id BIGINT, label VARCHAR(48), audio_url TEXT,
  linked_action VARCHAR(48), association_strength DOUBLE DEFAULT 0,
  anchor JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE semantic_scans (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT, anchor_hash VARCHAR(64), zones JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
