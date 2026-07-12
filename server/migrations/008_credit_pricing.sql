-- The app's idempotent initDb migration also adds this column automatically.
-- Legacy Pawprint-token balances are converted through addCredits at boot.
SET @retry_count_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'avatars'
     AND COLUMN_NAME = 'retry_count'
);
SET @retry_count_sql = IF(
  @retry_count_exists = 0,
  'ALTER TABLE avatars ADD COLUMN retry_count INT NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE retry_count_statement FROM @retry_count_sql;
EXECUTE retry_count_statement;
DEALLOCATE PREPARE retry_count_statement;
