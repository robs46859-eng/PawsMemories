-- Soft-hide for avatars.
--
-- ⚠️  REFERENCE ONLY — nothing executes this file automatically.
-- The main app has no migration runner (the one in x-dm-service/src/migrate.ts
-- belongs to that separate service). Schema changes here are applied by the
-- idempotent `requiredAvatarColumns` list in db.ts, which runs at boot and adds
-- the column only if INFORMATION_SCHEMA says it is missing. `hidden_at` is
-- already in that list, so deploying the code applies the change — do not run
-- this by hand as well.
--
-- The only "delete" a user had was `DELETE FROM avatars`, which destroyed the
-- row. That is wrong for two reasons: the GLB stays in object storage (so the
-- bytes are still billed but now unreferenced and unreclaimable), and a user
-- who clears a model to free a slot has no way back if they change their mind.
--
-- Hiding sets a timestamp instead. The row, its rig, its pet profile and its
-- marketplace listings all survive; it simply stops appearing in the roster and
-- stops counting against the model cap.

ALTER TABLE avatars
  ADD COLUMN hidden_at TIMESTAMP NULL DEFAULT NULL;

-- Roster queries all filter on (user_phone, hidden_at IS NULL).
CREATE INDEX idx_avatars_user_hidden ON avatars (user_phone, hidden_at);
