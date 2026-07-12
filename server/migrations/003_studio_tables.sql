-- Migration 003: Studio AI Animation Pipeline tables
-- Run after 001_pet_tables.sql and 002_snapgen_tables.sql

CREATE TABLE IF NOT EXISTS studio_productions (
    production_id     VARCHAR(36)   NOT NULL PRIMARY KEY,
    user_id           VARCHAR(36)   NOT NULL,
    pet_id            VARCHAR(36),

    -- Input params
    original_script   TEXT          NOT NULL,
    target_duration_ms INT          NOT NULL DEFAULT 30000,
    style             VARCHAR(32)   NOT NULL DEFAULT 'cinematic',
    voice_model       VARCHAR(64),
    aspect_ratio      VARCHAR(8)    NOT NULL DEFAULT '16:9',
    output_resolution VARCHAR(8)    NOT NULL DEFAULT '1080p',

    -- Status tracking
    status            VARCHAR(32)   NOT NULL DEFAULT 'draft'
                        COMMENT 'draft|directing|assembling|preview_rendering|awaiting_approval|revision|final_rendering|done|failed',
    preview_url       TEXT,
    render_urls       JSON,

    -- Billing
    credits_cost      INT           NOT NULL DEFAULT 0,

    -- Metadata
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS studio_versions (
    version_id        VARCHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
    production_id     VARCHAR(36)   NOT NULL,
    tag               VARCHAR(32)   NOT NULL
                        COMMENT 'original|director_v1|director_v2|director_v3|editor_assembly|user_revision|final_master',
    data              LONGTEXT      NOT NULL COMMENT 'JSON blob — manifest, EDL, render result, etc.',
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_production (production_id, tag),
    INDEX idx_created (created_at),
    CONSTRAINT fk_version_production
        FOREIGN KEY (production_id) REFERENCES studio_productions(production_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS studio_feedback (
    feedback_id       VARCHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
    production_id     VARCHAR(36)   NOT NULL,
    version_id        VARCHAR(36),
    user_id           VARCHAR(36)   NOT NULL,
    scope             VARCHAR(16)   NOT NULL DEFAULT 'global'
                        COMMENT 'global|scene|cue',
    scene_id          VARCHAR(64),
    cue_id            VARCHAR(64),
    rating            TINYINT       COMMENT '1-5 star rating',
    comment           TEXT,
    style_note        TEXT          COMMENT 'Free-text style instruction for regeneration',
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_production (production_id),
    INDEX idx_version (version_id),
    CONSTRAINT fk_feedback_production
        FOREIGN KEY (production_id) REFERENCES studio_productions(production_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
