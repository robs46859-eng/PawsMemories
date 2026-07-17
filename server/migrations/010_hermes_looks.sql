ALTER TABLE hermes_jobs
  MODIFY COLUMN job_type ENUM('translate','knowledge','looks') NOT NULL;
